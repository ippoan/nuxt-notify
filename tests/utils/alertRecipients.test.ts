import { describe, it, expect, vi } from 'vitest'
import {
  ALERT_GROUP_NAME,
  findAlertGroup,
  loadAlertMembers,
  ensureAlertGroup,
  addAlertMember,
  removeAlertMember,
  loadEmailStatuses,
  emailStatusLabel,
  emailStatusClass,
  emailStatusNote,
  canResend,
  resendVerification,
  alertCheckDisabledReason,
  type ApiFetch,
} from '../../app/utils/alertRecipients'

/** path ごとの応答 (関数なら呼ぶ) を返す偽 apiFetch。呼び出しは calls に残る。 */
function fakeFetch(routes: Record<string, unknown | (() => unknown)>) {
  const calls: { path: string; method?: string; body?: string }[] = []
  const fn = vi.fn(async (path: string, options: { method?: string; body?: string } = {}) => {
    calls.push({ path, ...options })
    const key = `${options.method ?? 'GET'} ${path}`
    if (!(key in routes)) throw new Error(`unexpected ${key}`)
    const v = routes[key]
    return typeof v === 'function' ? (v as () => unknown)() : v
  })
  return { api: fn as unknown as ApiFetch, calls }
}

const G = { id: 'g1', name: ALERT_GROUP_NAME }

describe('findAlertGroup', () => {
  it('名前一致を返す', () => {
    expect(findAlertGroup([{ id: 'x', name: '他' }, G])).toEqual(G)
  })
  it('無ければ null', () => {
    expect(findAlertGroup([{ id: 'x', name: '他' }])).toBeNull()
  })
})

describe('loadAlertMembers', () => {
  it('グループが無ければ空', async () => {
    const { api, calls } = fakeFetch({ 'GET /notify/groups': [] })
    expect((await loadAlertMembers(api)).size).toBe(0)
    expect(calls).toHaveLength(1)
  })
  it('メンバーを集合にする', async () => {
    const { api } = fakeFetch({
      'GET /notify/groups': [G],
      'GET /notify/groups/g1/members': [{ recipient_id: 'a' }, { recipient_id: 'b' }],
    })
    expect([...(await loadAlertMembers(api))]).toEqual(['a', 'b'])
  })
})

describe('ensureAlertGroup', () => {
  it('在ればそのまま使う', async () => {
    const { api, calls } = fakeFetch({ 'GET /notify/groups': [G] })
    expect(await ensureAlertGroup(api)).toBe('g1')
    expect(calls).toHaveLength(1)
  })
  it('無ければ作る (名前だけ送る)', async () => {
    const { api, calls } = fakeFetch({
      'GET /notify/groups': [],
      'POST /notify/groups': { id: 'new', name: ALERT_GROUP_NAME },
    })
    expect(await ensureAlertGroup(api)).toBe('new')
    expect(JSON.parse(calls[1].body!)).toEqual({ name: ALERT_GROUP_NAME })
  })
  it('作成が失敗しても引き直して見つかれば使う', async () => {
    let n = 0
    const { api } = fakeFetch({
      'GET /notify/groups': () => (n++ === 0 ? [] : [G]),
      'POST /notify/groups': () => {
        throw new Error('500')
      },
    })
    expect(await ensureAlertGroup(api)).toBe('g1')
  })
  it('作成が id 無しで返っても引き直す', async () => {
    let n = 0
    const { api } = fakeFetch({
      'GET /notify/groups': () => (n++ === 0 ? [] : [G]),
      'POST /notify/groups': {},
    })
    expect(await ensureAlertGroup(api)).toBe('g1')
  })
  it('引き直しても無ければ失敗', async () => {
    const { api } = fakeFetch({
      'GET /notify/groups': [],
      'POST /notify/groups': () => {
        throw new Error('500')
      },
    })
    await expect(ensureAlertGroup(api)).rejects.toThrow('通知グループを作れませんでした')
  })
})

describe('addAlertMember / removeAlertMember', () => {
  it('追加はメンバー API に recipient_ids を送る', async () => {
    const { api, calls } = fakeFetch({
      'GET /notify/groups': [G],
      'POST /notify/groups/g1/members': {},
    })
    await addAlertMember(api, 'r1')
    expect(JSON.parse(calls[1].body!)).toEqual({ recipient_ids: ['r1'] })
  })
  it('外す', async () => {
    const { api, calls } = fakeFetch({
      'GET /notify/groups': [G],
      'DELETE /notify/groups/g1/members/r1': {},
    })
    await removeAlertMember(api, 'r1')
    expect(calls[1]).toMatchObject({ path: '/notify/groups/g1/members/r1', method: 'DELETE' })
  })
  it('グループが無ければ外すものも無い', async () => {
    const { api, calls } = fakeFetch({ 'GET /notify/groups': [] })
    await removeAlertMember(api, 'r1')
    expect(calls).toHaveLength(1)
  })
})

describe('loadEmailStatuses', () => {
  it('configured:false なら空', async () => {
    const { api } = fakeFetch({
      'GET /notify/recipients/email-status': { configured: false, items: [{ recipient_id: 'a', email_status: 'verified' }] },
    })
    expect((await loadEmailStatuses(api)).size).toBe(0)
  })
  it('recipient_id ごとの Map', async () => {
    const { api } = fakeFetch({
      'GET /notify/recipients/email-status': {
        configured: true,
        items: [
          { recipient_id: 'a', email_status: 'verified' },
          { recipient_id: 'b', email_status: 'pending' },
        ],
      },
    })
    const m = await loadEmailStatuses(api)
    expect(m.get('a')).toBe('verified')
    expect(m.get('b')).toBe('pending')
  })
})

describe('状態の表示', () => {
  it('ラベル', () => {
    expect(emailStatusLabel('verified')).toBe('確認済み')
    expect(emailStatusLabel('pending')).toBe('確認待ち')
    expect(emailStatusLabel('not_registered')).toBe('未登録')
    expect(emailStatusLabel(undefined)).toBe('-')
  })
  it('色', () => {
    expect(emailStatusClass('verified')).toContain('green')
    expect(emailStatusClass('pending')).toContain('amber')
    expect(emailStatusClass('not_registered')).toContain('red')
    expect(emailStatusClass(undefined)).toContain('gray')
  })
  it('補足は確認待ちと未登録だけ', () => {
    expect(emailStatusNote('pending')).toBe('確認メールのリンクを押すまで届きません')
    expect(emailStatusNote('not_registered')).toBe('送り先の登録は管理者がメールを保存したときに行われます')
    expect(emailStatusNote('verified')).toBe('')
    expect(emailStatusNote(undefined)).toBe('')
  })
  it('再送ボタンは確認待ちと未登録だけ', () => {
    expect(canResend('pending')).toBe(true)
    expect(canResend('not_registered')).toBe(true)
    expect(canResend('verified')).toBe(false)
    expect(canResend(undefined)).toBe(false)
  })
})

describe('resendVerification', () => {
  const route = 'POST /notify/recipients/r1/resend-verification'
  it('created / resent は送信済み', async () => {
    for (const status of ['created', 'resent']) {
      const { api } = fakeFetch({ [route]: { status } })
      expect(await resendVerification(api, 'r1')).toEqual({ ok: true, message: '確認メールを送りました' })
    }
  })
  it('想定外の 200 は汎用エラー', async () => {
    const { api } = fakeFetch({ [route]: null })
    const r = await resendVerification(api, 'r1')
    expect(r.ok).toBe(false)
  })
  it('already_verified (status / data どちらでも)', async () => {
    for (const err of [{ status: 409 }, { data: { error: 'already_verified' } }, { response: { _data: { error: 'already_verified' } } }]) {
      const { api } = fakeFetch({
        [route]: () => {
          throw err
        },
      })
      expect(await resendVerification(api, 'r1')).toEqual({ ok: true, message: '確認済みです' })
    }
  })
  it('forbidden', async () => {
    for (const err of [{ status: 403 }, { data: { error: 'forbidden' } }]) {
      const { api } = fakeFetch({
        [route]: () => {
          throw err
        },
      })
      expect(await resendVerification(api, 'r1')).toEqual({ ok: false, message: '管理者だけが再送できます' })
    }
  })
  it('404 や想定外は汎用エラー (null を投げても落ちない)', async () => {
    for (const err of [{ status: 404 }, new Error('x'), null]) {
      const { api } = fakeFetch({
        [route]: () => {
          throw err
        },
      })
      const r = await resendVerification(api, 'r1')
      expect(r.ok).toBe(false)
      expect(r.message).toContain('確認メールを送れませんでした')
    }
  })
})

describe('alertCheckDisabledReason', () => {
  it('メールが無ければ理由を返す', () => {
    expect(alertCheckDisabledReason(null)).toContain('メール')
    expect(alertCheckDisabledReason('')).toContain('メール')
  })
  it('在れば空', () => {
    expect(alertCheckDisabledReason('a@example.com')).toBe('')
  })
})
