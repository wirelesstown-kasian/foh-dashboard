import { Employee } from '@/lib/types'

const STANDARD_TIP_ROLES = new Set(['manager', 'server', 'busser', 'runner'])

export function isStandardTipRole(role: Employee['role']) {
  return STANDARD_TIP_ROLES.has(role)
}

export function isTipEligibleEmployee(employee: Pick<Employee, 'role' | 'primary_department' | 'tip_pool_hourly_rate'>) {
  if (isStandardTipRole(employee.role)) return true
  return (employee.primary_department ?? 'foh') === 'foh' && Number(employee.tip_pool_hourly_rate ?? 0) > 0
}
