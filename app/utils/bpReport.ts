// 血圧の日報メール (毎朝 7:00) の受け取りを宛先の画面 (recipients.vue) で扱う判定。オプトアウト方式:
// 受け取れる人 (有効・メールあり・社員に結び付き・社員の役割が manager か admin) は既定で受け取り、
// 「血圧の日報を受け取らない」グループ (BP_REPORT_OPT_OUT_GROUP_NAME) に入れた人だけが外れる。
// 送る側 (ippoan/alc-measurements-worker の report.rs) の宛先の規則と同じにする。

import type { Employee } from './employeeLink'

/** 日報を受け取れる役割。 */
export const BP_REPORT_ROLES = ['manager', 'admin']

export interface BpReportRecipient {
  id: string
  email: string | null
  enabled: boolean
  employee_id: string | null
}

/** 受け取れない理由 (title に出す)。受け取れるなら空。 */
export function bpReportDisabledReason(r: BpReportRecipient, employeeById: Map<string, Employee>): string {
  if (!r.enabled) return '宛先が無効のため送られません'
  if (!r.email) return 'メールが未登録のため送られません'
  if (!r.employee_id) return '社員に結び付いていないため送られません'
  const employee = employeeById.get(r.employee_id)
  if (!employee) return '結び付いた社員が確認できないため送られません'
  if (!employee.role.some((role) => BP_REPORT_ROLES.includes(role))) return '管理者でないため送られません'
  return ''
}

/** チェックの状態。受け取れる人が「受け取らない」グループに入っていなければチェックあり。受け取れない人は常にチェックなし。 */
export function bpReportChecked(
  r: BpReportRecipient,
  optOutMembers: Set<string>,
  employeeById: Map<string, Employee>,
): boolean {
  return bpReportDisabledReason(r, employeeById) === '' && !optOutMembers.has(r.id)
}
