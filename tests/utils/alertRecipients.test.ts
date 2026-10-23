import { describe, it, expect, vi } from 'vitest'
import {
  ALERT_GROUP_NAME,
  BP_REPORT_GROUP_NAME,
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
  sendAlertTest,
  sendBpReportTest,
  alertTestMessage,
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
      'GET /notify/groups/g1/members': [{ id: 'a', name: 'A', email: 'a@example.com' }, { id: 'b', name: 'B', email: 'b@example.com' }],
    })
    const members = await loadAlertMembers(api)
    expect(members.size).toBe(2)
    expect([...members]).toEqual(['a', 'b'])
    expect(members.has('undefined' as string)).toBe(false)
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

describe('sendAlertTest', () => {
  const route = 'POST /measurements/alert-test'
  const failWith = (err: unknown) =>
    fakeFetch({
      [route]: () => {
        throw err
      },
    }).api

  it('sent / failed を返す', async () => {
    const { api, calls } = fakeFetch({ [route]: { sent: 3, failed: 1 } })
    expect(await sendAlertTest(api)).toEqual({ ok: true, sent: 3, failed: 1 })
    expect(calls[0]).toEqual({ path: '/measurements/alert-test', method: 'POST' })
  })
  it('failed が無ければ 0', async () => {
    const { api } = fakeFetch({ [route]: { sent: 2 } })
    expect(await sendAlertTest(api)).toEqual({ ok: true, sent: 2, failed: 0 })
  })
  it('想定外の 200 は汎用エラー', async () => {
    for (const body of [null, {}]) {
      const { api } = fakeFetch({ [route]: body })
      expect(await sendAlertTest(api)).toEqual({ ok: false, message: 'テスト送信に失敗しました' })
    }
  })
  it('403 forbidden (status / data / response どれでも)', async () => {
    for (const err of [{ status: 403 }, { data: { error: 'forbidden' } }, { response: { _data: { error: 'forbidden' } } }]) {
      expect(await sendAlertTest(failWith(err))).toEqual({ ok: false, message: '管理者だけが送れます' })
    }
  })
  it('409 no_recipients', async () => {
    for (const err of [{ status: 409 }, { data: { error: 'no_recipients' } }]) {
      expect(await sendAlertTest(failWith(err))).toEqual({
        ok: false,
        message: 'アルコール検知メールの受け取り手がいません',
      })
    }
  })
  it('503 mail_unavailable', async () => {
    for (const err of [{ status: 503 }, { data: { error: 'mail_unavailable' } }]) {
      expect(await sendAlertTest(failWith(err))).toEqual({ ok: false, message: 'メールを送れない状態です' })
    }
  })
  it('それ以外・通信失敗は汎用エラー', async () => {
    for (const err of [{ status: 500 }, new Error('network'), undefined]) {
      expect(await sendAlertTest(failWith(err))).toEqual({ ok: false, message: 'テスト送信に失敗しました' })
    }
  })
})

describe('alertTestMessage', () => {
  it('失敗 0 件なら失敗の部分を出さない', () => {
    expect(alertTestMessage({ ok: true, sent: 3, failed: 0 })).toBe('3 件送信しました')
  })
  it('失敗があれば添える', () => {
    expect(alertTestMessage({ ok: true, sent: 2, failed: 1 })).toBe('2 件送信しました (失敗 1 件)')
  })
  it('失敗はそのまま文言', () => {
    expect(alertTestMessage({ ok: false, message: 'x' })).toBe('x')
  })
})

describe('血圧の日報のグループ (グループ名を渡す)', () => {
  const BP = { id: 'g2', name: BP_REPORT_GROUP_NAME }
  it('グループ名は送る側と同じ「血圧の日報」', () => {
    expect(BP_REPORT_GROUP_NAME).toBe('血圧の日報')
  })
  it('名前で探す (アルコール検知と取り違えない)', () => {
    expect(findAlertGroup([G, BP], BP_REPORT_GROUP_NAME)).toEqual(BP)
    expect(findAlertGroup([G], BP_REPORT_GROUP_NAME)).toBeNull()
    expect(findAlertGroup([G, BP])).toEqual(G)
  })
  it('メンバーはそのグループのもの', async () => {
    const { api } = fakeFetch({
      'GET /notify/groups': [G, BP],
      'GET /notify/groups/g2/members': [{ id: 'z' }],
    })
    expect([...(await loadAlertMembers(api, BP_REPORT_GROUP_NAME))]).toEqual(['z'])
  })
  it('無ければその名前で作り、メンバーを足す', async () => {
    let created = false
    const { api, calls } = fakeFetch({
      'GET /notify/groups': () => (created ? [BP] : []),
      'POST /notify/groups': () => {
        created = true
        return BP
      },
      'POST /notify/groups/g2/members': {},
    })
    await addAlertMember(api, 'r1', BP_REPORT_GROUP_NAME)
    expect(calls.find((c) => c.path === '/notify/groups' && c.method === 'POST')?.body).toBe(
      JSON.stringify({ name: '血圧の日報' }),
    )
    expect(calls.at(-1)).toMatchObject({ path: '/notify/groups/g2/members', method: 'POST' })
  })
  it('引き直しても無ければ失敗', async () => {
    const { api } = fakeFetch({ 'GET /notify/groups': [G], 'POST /notify/groups': {} })
    await expect(ensureAlertGroup(api, BP_REPORT_GROUP_NAME)).rejects.toThrow()
  })
  it('外す', async () => {
    const { api, calls } = fakeFetch({
      'GET /notify/groups': [G, BP],
      'DELETE /notify/groups/g2/members/r1': {},
    })
    await removeAlertMember(api, 'r1', BP_REPORT_GROUP_NAME)
    expect(calls.at(-1)?.path).toBe('/notify/groups/g2/members/r1')
  })
})

describe('sendBpReportTest', () => {
  it('bp-report-test を呼び、結果を返す', async () => {
    const { api, calls } = fakeFetch({ 'POST /measurements/bp-report-test': { sent: 2, failed: 0 } })
    expect(await sendBpReportTest(api)).toEqual({ ok: true, sent: 2, failed: 0 })
    expect(calls[0]).toMatchObject({ path: '/measurements/bp-report-test', method: 'POST' })
  })
  it('受け取り手がいない (409) は血圧の日報の文言', async () => {
    const api = (async () => {
      throw { status: 409 }
    }) as unknown as ApiFetch
    expect(await sendBpReportTest(api)).toEqual({ ok: false, message: '血圧の日報の受け取り手がいません' })
  })
})
