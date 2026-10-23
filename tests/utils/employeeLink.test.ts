import { describe, it, expect, vi } from 'vitest'
import {
  employeeLabel,
  linkedEmployeeText,
  takenEmployeeIds,
  linkErrorMessage,
  loadEmployees,
  setRecipientEmployee,
  linkEmployeesByName,
  skipReasonLabel,
  linkResultMessage,
  type Employee,
  type LinkPlan,
} from '../../app/utils/employeeLink'
import type { ApiFetch } from '../../app/utils/alertRecipients'

const api = (impl: (path: string, options?: { method?: string; body?: string }) => unknown) =>
  vi.fn(async (path: string, options?: { method?: string; body?: string }) => impl(path, options)) as unknown as ApiFetch & ReturnType<typeof vi.fn>

const reject = (error: unknown) => api(() => Promise.reject(error))

describe('employeeLabel / linkedEmployeeText', () => {
  const a: Employee = { id: 'e1', name: '山田 太郎', code: '12', role: ['driver'] }
  const b: Employee = { id: 'e2', name: '佐藤 花子', code: null, role: ['admin'] }
  it('社員コードがあれば添える', () => {
    expect(employeeLabel(a)).toBe('山田 太郎 (12)')
    expect(employeeLabel(b)).toBe('佐藤 花子')
  })
  it('結び付き無しは「-」、一覧に無い社員は不明', () => {
    const byId = new Map([[a.id, a]])
    expect(linkedEmployeeText(null, byId)).toBe('-')
    expect(linkedEmployeeText('e1', byId)).toBe('山田 太郎 (12)')
    expect(linkedEmployeeText('gone', byId)).toBe('(不明な社員)')
  })
})

describe('takenEmployeeIds', () => {
  it('自分以外の宛先が使っている社員だけ', () => {
    const rs = [
      { id: 'r1', employee_id: 'e1' },
      { id: 'r2', employee_id: 'e2' },
      { id: 'r3', employee_id: null },
    ]
    expect([...takenEmployeeIds(rs, 'r1')]).toEqual(['e2'])
    expect([...takenEmployeeIds(rs, 'r3')].sort()).toEqual(['e1', 'e2'])
  })
})

describe('linkErrorMessage', () => {
  it('409 / employee_already_linked', () => {
    expect(linkErrorMessage({ status: 409 })).toContain('別の宛先')
    expect(linkErrorMessage({ data: { error: 'employee_already_linked' } })).toContain('別の宛先')
    expect(linkErrorMessage({ response: { _data: { error: 'employee_already_linked' } } })).toContain('別の宛先')
  })
  it('403 / forbidden', () => {
    expect(linkErrorMessage({ status: 403 })).toBe('管理者だけが結び付けられます')
    expect(linkErrorMessage({ data: { error: 'forbidden' } })).toBe('管理者だけが結び付けられます')
  })
  it('employee_not_found', () => {
    expect(linkErrorMessage({ data: { error: 'employee_not_found' } })).toContain('見つかりません')
  })
  it('それ以外は汎用 (null を投げても落ちない)', () => {
    expect(linkErrorMessage({ status: 500 })).toContain('保存できませんでした')
    expect(linkErrorMessage(null)).toContain('保存できませんでした')
  })
})

describe('loadEmployees', () => {
  it('社員の一覧を読む', async () => {
    const f = api(() => [{ id: 'e1', name: '甲', code: null, role: ['manager'] }])
    expect(await loadEmployees(f)).toEqual([{ id: 'e1', name: '甲', code: null, role: ['manager'] }])
    expect(f).toHaveBeenCalledWith('/notify/employees')
  })
})

describe('setRecipientEmployee', () => {
  it('結び付ける (PUT employee_id)', async () => {
    const f = api(() => ({}))
    expect(await setRecipientEmployee(f, 'r1', 'e1')).toEqual({ ok: true, value: null })
    expect(f).toHaveBeenCalledWith('/notify/recipients/r1', { method: 'PUT', body: '{"employee_id":"e1"}' })
  })
  it('外す (null を送る)', async () => {
    const f = api(() => ({}))
    await setRecipientEmployee(f, 'r1', null)
    expect(f).toHaveBeenCalledWith('/notify/recipients/r1', { method: 'PUT', body: '{"employee_id":null}' })
  })
  it('失敗は文言にして返す (投げない)', async () => {
    expect(await setRecipientEmployee(reject({ status: 409 }), 'r1', 'e1')).toEqual({
      ok: false,
      message: 'その社員は別の宛先に結び付いています',
    })
  })
})

describe('linkEmployeesByName', () => {
  const plan: LinkPlan = {
    dry_run: true,
    candidates: [
      { recipient_id: 'r1', recipient_name: '山田 太郎', employee_id: 'e1', employee_name: '山田太郎', employee_code: '1' },
    ],
    skipped: [{ recipient_id: 'r2', recipient_name: '高橋', reason: 'no_match' }],
    linked: 0,
  }
  it('dry_run の本文で候補を読む', async () => {
    const f = api(() => plan)
    expect(await linkEmployeesByName(f, true)).toEqual({ ok: true, value: plan })
    expect(f).toHaveBeenCalledWith('/notify/recipients/link-employees-by-name', {
      method: 'POST',
      body: '{"dry_run":true}',
    })
  })
  it('確定は dry_run:false', async () => {
    const f = api(() => ({ ...plan, dry_run: false, linked: 1 }))
    const res = await linkEmployeesByName(f, false)
    expect(res.ok && res.value.linked).toBe(1)
    expect(f).toHaveBeenCalledWith('/notify/recipients/link-employees-by-name', {
      method: 'POST',
      body: '{"dry_run":false}',
    })
  })
  it('形の違う応答・null は汎用エラー', async () => {
    for (const bad of [{}, null, { candidates: [] }]) {
      const res = await linkEmployeesByName(api(() => bad), true)
      expect(res.ok).toBe(false)
    }
  })
  it('403 は管理者だけ、通信失敗は汎用', async () => {
    expect(await linkEmployeesByName(reject({ status: 403 }), true)).toEqual({
      ok: false,
      message: '管理者だけが結び付けられます',
    })
    const res = await linkEmployeesByName(reject(new Error('net')), true)
    expect(res.ok).toBe(false)
  })
})

describe('skipReasonLabel / linkResultMessage', () => {
  it('理由ごとの文言', () => {
    const labels = [
      'already_linked',
      'no_match',
      'multiple_employees',
      'employee_already_linked',
      'multiple_recipients',
      'something_new',
    ].map(skipReasonLabel)
    expect(new Set(labels).size).toBe(6)
    expect(skipReasonLabel('no_match')).toBe('同じ名前の社員がいません')
    expect(skipReasonLabel('something_new')).toBe('結べませんでした')
  })
  it('結果の文言', () => {
    expect(linkResultMessage({ dry_run: false, candidates: [], skipped: [], linked: 3 })).toBe('3 件を社員に結び付けました')
    expect(linkResultMessage({ dry_run: false, candidates: [], skipped: [], linked: 0 })).toBe('結び付ける宛先はありませんでした')
  })
})
