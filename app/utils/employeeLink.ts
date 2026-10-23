// 宛先 (notify_recipients) と社員マスタ (employees) の結び付け。宛先の画面 (recipients.vue) のロジック。
// 血圧を測った本人へ LINE WORKS で結果を送るため、宛先がどの社員かを持つ (alc-notify-worker の employee_id)。
// 結び付けの書き込み・社員の一覧・氏名での自動結合はどれも管理者だけが使える口。

import type { ApiFetch } from './alertRecipients'

export interface Employee {
  id: string
  name: string
  /** 社員コード。無い人は null。 */
  code: string | null
}

/** 氏名での自動結合の候補 (宛先 ↔ 社員)。 */
export interface LinkCandidate {
  recipient_id: string
  recipient_name: string
  employee_id: string
  employee_name: string
  employee_code: string | null
}

export type LinkSkipReason =
  | 'already_linked'
  | 'no_match'
  | 'multiple_employees'
  | 'employee_already_linked'
  | 'multiple_recipients'

/** 結べなかった宛先とその理由。 */
export interface LinkSkipped {
  recipient_id: string
  recipient_name: string
  reason: LinkSkipReason | string
}

export interface LinkPlan {
  dry_run: boolean
  candidates: LinkCandidate[]
  skipped: LinkSkipped[]
  /** 確定で結んだ数 (dry_run では 0)。 */
  linked: number
}

export type LinkResult<T> = { ok: true; value: T } | { ok: false; message: string }

/** 社員の選択肢の表示 (社員コードがあれば添える)。 */
export function employeeLabel(e: Pick<Employee, 'name' | 'code'>): string {
  return e.code ? `${e.name} (${e.code})` : e.name
}

/** 社員の一覧 (削除済みを除く。社員コードの順)。 */
export async function loadEmployees(apiFetch: ApiFetch): Promise<Employee[]> {
  return await apiFetch<Employee[]>('/notify/employees')
}

/** 宛先に結び付いた社員の表示。結び付いていなければ「-」、一覧に無い (削除済みなど) なら「不明」。 */
export function linkedEmployeeText(employeeId: string | null, byId: Map<string, Employee>): string {
  if (!employeeId) return '-'
  const e = byId.get(employeeId)
  return e ? employeeLabel(e) : '(不明な社員)'
}

/** 他の宛先に結び付いている社員の id の集合 (選択肢から外すため)。自分自身の結び付きは含めない。 */
export function takenEmployeeIds(recipients: { id: string; employee_id: string | null }[], exceptRecipientId: string): Set<string> {
  const taken = new Set<string>()
  for (const r of recipients) {
    if (r.employee_id && r.id !== exceptRecipientId) taken.add(r.employee_id)
  }
  return taken
}

const GENERIC_ERROR = '結び付けを保存できませんでした。しばらくしてからお試しください'

function errorCode(e: any): string | undefined {
  return e?.data?.error ?? e?.response?._data?.error
}

/** 失敗を 1 行の文言にする (投げた値の形は問わない)。 */
export function linkErrorMessage(e: any): string {
  const code = errorCode(e)
  if (e?.status === 409 || code === 'employee_already_linked') return 'その社員は別の宛先に結び付いています'
  if (e?.status === 403 || code === 'forbidden') return '管理者だけが結び付けられます'
  if (code === 'employee_not_found') return '社員が見つかりません (削除された可能性があります)'
  return GENERIC_ERROR
}

/** 宛先の社員を決める (null で外す)。投げない。 */
export async function setRecipientEmployee(
  apiFetch: ApiFetch,
  recipientId: string,
  employeeId: string | null,
): Promise<LinkResult<null>> {
  try {
    await apiFetch(`/notify/recipients/${recipientId}`, {
      method: 'PUT',
      body: JSON.stringify({ employee_id: employeeId }),
    })
    return { ok: true, value: null }
  } catch (e: any) {
    return { ok: false, message: linkErrorMessage(e) }
  }
}

/**
 * 氏名での自動結合。dryRun=true は候補を返すだけで何も書かず、false で確定して書く。投げない。
 * 規則 (サーバー側): 空白 (半角・全角) を除いて名前を比べ、一致する社員がちょうど 1 人で、宛先も社員もまだ結び付いていないものだけ。
 */
export async function linkEmployeesByName(apiFetch: ApiFetch, dryRun: boolean): Promise<LinkResult<LinkPlan>> {
  try {
    const plan = await apiFetch<LinkPlan>('/notify/recipients/link-employees-by-name', {
      method: 'POST',
      body: JSON.stringify({ dry_run: dryRun }),
    })
    if (!Array.isArray(plan?.candidates) || !Array.isArray(plan?.skipped)) {
      return { ok: false, message: GENERIC_ERROR }
    }
    return { ok: true, value: plan }
  } catch (e: any) {
    return { ok: false, message: linkErrorMessage(e) }
  }
}

/** 結べなかった理由の文言。 */
export function skipReasonLabel(reason: string): string {
  switch (reason) {
    case 'already_linked':
      return '既に社員に結び付いています'
    case 'no_match':
      return '同じ名前の社員がいません'
    case 'multiple_employees':
      return '同じ名前の社員が 2 人以上います'
    case 'employee_already_linked':
      return 'その社員は別の宛先に結び付いています'
    case 'multiple_recipients':
      return '同じ名前の宛先が 2 つ以上あります'
    default:
      return '結べませんでした'
  }
}

/** 確定の結果を 1 行の文言にする。 */
export function linkResultMessage(plan: LinkPlan): string {
  return plan.linked > 0 ? `${plan.linked} 件を社員に結び付けました` : '結び付ける宛先はありませんでした'
}
