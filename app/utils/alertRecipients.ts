// アルコール検知メールの受け取り手を宛先画面 (recipients.vue) で扱うためのロジック。
// グループ (notify の recipient group) は画面に出さず、最初にチェックを付けたときに自動で作る。

// ippoan/alc-measurements-worker の crates/measurements/src/alert.rs:36 `ALERT_GROUP` と同じ文字列。
// 一字違うと誰にも届かない。
export const ALERT_GROUP_NAME = 'アルコール検知'

export type ApiFetch = <T>(path: string, options?: { method?: string; body?: string }) => Promise<T>

export interface NotifyGroup {
  id: string
  name: string
}

export interface GroupMember {
  recipient_id: string
}

export type EmailStatus = 'verified' | 'pending' | 'not_registered'

export interface EmailStatusResponse {
  configured: boolean
  items: { recipient_id: string; email_status: EmailStatus }[]
}

/** groups から警告グループを名前で探す。 */
export function findAlertGroup(groups: NotifyGroup[]): NotifyGroup | null {
  return groups.find((g) => g.name === ALERT_GROUP_NAME) ?? null
}

/** 警告グループのメンバー (recipient_id の集合)。グループが無ければ空。 */
export async function loadAlertMembers(apiFetch: ApiFetch): Promise<Set<string>> {
  const group = findAlertGroup(await apiFetch<NotifyGroup[]>('/notify/groups'))
  if (!group) return new Set()
  const members = await apiFetch<GroupMember[]>(`/notify/groups/${group.id}/members`)
  return new Set(members.map((m) => m.recipient_id))
}

/**
 * 警告グループの id を返す。無ければ作る。
 * 作成が (一意制約違反などで) どんな失敗をしても、引き直して名前で探す。それでも無ければ失敗を投げる。
 */
export async function ensureAlertGroup(apiFetch: ApiFetch): Promise<string> {
  const existing = findAlertGroup(await apiFetch<NotifyGroup[]>('/notify/groups'))
  if (existing) return existing.id
  try {
    const created = await apiFetch<NotifyGroup>('/notify/groups', {
      method: 'POST',
      body: JSON.stringify({ name: ALERT_GROUP_NAME }),
    })
    if (created?.id) return created.id
  } catch {
    // 同時作成などで失敗しても、下で引き直して確かめる
  }
  const refetched = findAlertGroup(await apiFetch<NotifyGroup[]>('/notify/groups'))
  if (!refetched) throw new Error('通知グループを作れませんでした。もう一度お試しください')
  return refetched.id
}

/** チェックを付ける (グループが無ければ作る)。 */
export async function addAlertMember(apiFetch: ApiFetch, recipientId: string): Promise<void> {
  const groupId = await ensureAlertGroup(apiFetch)
  await apiFetch(`/notify/groups/${groupId}/members`, {
    method: 'POST',
    body: JSON.stringify({ recipient_ids: [recipientId] }),
  })
}

/** チェックを外す。グループが無ければ外すものも無い。 */
export async function removeAlertMember(apiFetch: ApiFetch, recipientId: string): Promise<void> {
  const group = findAlertGroup(await apiFetch<NotifyGroup[]>('/notify/groups'))
  if (!group) return
  await apiFetch(`/notify/groups/${group.id}/members/${recipientId}`, { method: 'DELETE' })
}

/** 送り先の状態。configured:false なら状態は出さない (空 Map)。 */
export async function loadEmailStatuses(apiFetch: ApiFetch): Promise<Map<string, EmailStatus>> {
  const res = await apiFetch<EmailStatusResponse>('/notify/recipients/email-status')
  const map = new Map<string, EmailStatus>()
  if (!res.configured) return map
  for (const item of res.items) map.set(item.recipient_id, item.email_status)
  return map
}

export function emailStatusLabel(status: EmailStatus | undefined): string {
  switch (status) {
    case 'verified':
      return '確認済み'
    case 'pending':
      return '確認待ち'
    case 'not_registered':
      return '未登録'
    default:
      return '-'
  }
}

export function emailStatusClass(status: EmailStatus | undefined): string {
  switch (status) {
    case 'verified':
      return 'text-green-600'
    case 'pending':
      return 'text-amber-600'
    case 'not_registered':
      return 'text-red-600'
    default:
      return 'text-gray-400'
  }
}

/** 状態の補足 (1 行)。 */
export function emailStatusNote(status: EmailStatus | undefined): string {
  if (status === 'pending') return '確認メールのリンクを押すまで届きません'
  if (status === 'not_registered') return '送り先の登録は管理者がメールを保存したときに行われます'
  return ''
}

/** 確認メールの再送ボタンを出す状態か。 */
export function canResend(status: EmailStatus | undefined): boolean {
  return status === 'pending' || status === 'not_registered'
}

export interface ResendResult {
  ok: boolean
  message: string
}

const RESEND_GENERIC_ERROR = '確認メールを送れませんでした。しばらくしてからお試しください'

/** 確認メールを再送し、結果を 1 行の文言にして返す。投げない。 */
export async function resendVerification(apiFetch: ApiFetch, recipientId: string): Promise<ResendResult> {
  try {
    const res = await apiFetch<{ status?: string }>(`/notify/recipients/${recipientId}/resend-verification`, {
      method: 'POST',
    })
    if (res?.status === 'created' || res?.status === 'resent') {
      return { ok: true, message: '確認メールを送りました' }
    }
    return { ok: false, message: RESEND_GENERIC_ERROR }
  } catch (e: any) {
    const code = e?.data?.error ?? e?.response?._data?.error
    if (e?.status === 409 || code === 'already_verified') return { ok: true, message: '確認済みです' }
    if (e?.status === 403 || code === 'forbidden') return { ok: false, message: '管理者だけが再送できます' }
    return { ok: false, message: RESEND_GENERIC_ERROR }
  }
}

export type AlertTestResult = { ok: true; sent: number; failed: number } | { ok: false; message: string }

const ALERT_TEST_GENERIC_ERROR = 'テスト送信に失敗しました'

/** アルコール検知メールのテストを受け取り手全員に送る。投げない。 */
export async function sendAlertTest(apiFetch: ApiFetch): Promise<AlertTestResult> {
  try {
    const res = await apiFetch<{ sent?: number; failed?: number }>('/measurements/alert-test', { method: 'POST' })
    if (typeof res?.sent !== 'number') return { ok: false, message: ALERT_TEST_GENERIC_ERROR }
    return { ok: true, sent: res.sent, failed: res.failed ?? 0 }
  } catch (e: any) {
    const code = e?.data?.error ?? e?.response?._data?.error
    if (e?.status === 403 || code === 'forbidden') return { ok: false, message: '管理者だけが送れます' }
    if (e?.status === 409 || code === 'no_recipients') {
      return { ok: false, message: 'アルコール検知メールの受け取り手がいません' }
    }
    if (e?.status === 503 || code === 'mail_unavailable') return { ok: false, message: 'メールを送れない状態です' }
    return { ok: false, message: ALERT_TEST_GENERIC_ERROR }
  }
}

/** テスト送信の結果を 1 行の文言にする。 */
export function alertTestMessage(result: AlertTestResult): string {
  if (!result.ok) return result.message
  return result.failed > 0
    ? `${result.sent} 件送信しました (失敗 ${result.failed} 件)`
    : `${result.sent} 件送信しました`
}

/** メールの無い宛先はチェックできない。理由 (title) を返す。チェックできるなら空。 */
export function alertCheckDisabledReason(email: string | null): string {
  return email ? '' : 'メールが未登録のため選べません'
}

export interface AlertMemberStore {
  /** 受け取り手を読み直す。 */
  load(): Promise<void>
  /** チェックを付ける / 外す。終わったら読み直す。 */
  toggle(recipientId: string, checked: boolean): Promise<void>
}

/** 受け取り手の state を持つ。members が変わるたび onMembers、失敗したら onError を呼ぶ。 */
export function createAlertMemberStore(
  apiFetch: ApiFetch,
  onMembers: (members: Set<string>) => void,
  onError: (message: string) => void,
): AlertMemberStore {
  // 読み込みは重なりうる (開いた直後の読み込み中にチェックを触る等)。最後に始めたものだけを反映し、古い結果で上書きしない。
  let latest = 0
  async function load() {
    const mine = ++latest
    try {
      const members = await loadAlertMembers(apiFetch)
      if (mine === latest) onMembers(members)
    } catch (e: any) {
      if (mine !== latest) return
      onMembers(new Set())
      onError('アルコール検知メールの受け取り手を読み込めませんでした: ' + (e.message || String(e)))
    }
  }
  async function toggle(recipientId: string, checked: boolean) {
    try {
      if (checked) await addAlertMember(apiFetch, recipientId)
      else await removeAlertMember(apiFetch, recipientId)
    } catch (e: any) {
      onError('アルコール検知メールの設定に失敗しました: ' + (e.message || String(e)))
    }
    await load()
  }
  return { load, toggle }
}
