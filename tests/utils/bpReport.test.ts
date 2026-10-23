import { describe, expect, it } from 'vitest'
import { bpReportChecked, bpReportDisabledReason, type BpReportRecipient } from '../../app/utils/bpReport'
import type { Employee } from '../../app/utils/employeeLink'

const emp = (id: string, role: string[]): Employee => ({ id, name: id, code: null, role })
const byId = new Map<string, Employee>([
  ['admin', emp('admin', ['admin'])],
  ['mgr', emp('mgr', ['driver', 'manager'])],
  ['drv', emp('drv', ['driver'])],
])
const r = (over: Partial<BpReportRecipient> = {}): BpReportRecipient => ({
  id: 'r1',
  email: 'a@example.test',
  enabled: true,
  employee_id: 'admin',
  ...over,
})

describe('bpReportDisabledReason (受け取れない理由)', () => {
  it('有効・メールあり・結び付き・管理者なら空 (manager も)', () => {
    expect(bpReportDisabledReason(r(), byId)).toBe('')
    expect(bpReportDisabledReason(r({ employee_id: 'mgr' }), byId)).toBe('')
  })
  it('無効な宛先', () => {
    expect(bpReportDisabledReason(r({ enabled: false }), byId)).toContain('無効')
  })
  it('メールが無い', () => {
    expect(bpReportDisabledReason(r({ email: null }), byId)).toContain('メール')
  })
  it('社員に結び付いていない', () => {
    expect(bpReportDisabledReason(r({ employee_id: null }), byId)).toContain('結び付いていない')
  })
  it('結び付いた社員が一覧に無い (削除済み・一覧を読めない)', () => {
    expect(bpReportDisabledReason(r({ employee_id: 'gone' }), byId)).toContain('確認できない')
  })
  it('管理者でない', () => {
    expect(bpReportDisabledReason(r({ employee_id: 'drv' }), byId)).toContain('管理者でない')
  })
})

describe('bpReportChecked (オプトアウト)', () => {
  it('受け取れる人は既定でチェックあり', () => {
    expect(bpReportChecked(r(), new Set(), byId)).toBe(true)
  })
  it('「受け取らない」グループに入っていればチェックなし', () => {
    expect(bpReportChecked(r(), new Set(['r1']), byId)).toBe(false)
  })
  it('ほかの人がグループにいても影響しない', () => {
    expect(bpReportChecked(r(), new Set(['other']), byId)).toBe(true)
  })
  it('受け取れない人は常にチェックなし', () => {
    expect(bpReportChecked(r({ employee_id: 'drv' }), new Set(), byId)).toBe(false)
    expect(bpReportChecked(r({ email: null }), new Set(), byId)).toBe(false)
  })
})
