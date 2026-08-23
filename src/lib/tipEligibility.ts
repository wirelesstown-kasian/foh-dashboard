import { Employee } from '@/lib/types'

const STANDARD_TIP_ROLES = new Set(['manager', 'server', 'busser', 'runner'])

export function isStandardTipRole(role: Employee['role']) {
  return STANDARD_TIP_ROLES.has(role)
}

export function isTipEligibleDepartment(department: string | null | undefined) {
  const normalized = department?.trim().toLowerCase()
  if (!normalized) return false
  return STANDARD_TIP_ROLES.has(normalized) || normalized === 'foh' || normalized === 'hybrid'
}

export function isTipEligibleEmployee(employee: Pick<Employee, 'role' | 'primary_department'>) {
  if (isStandardTipRole(employee.role)) return true
  const primaryDepartment = employee.primary_department ?? 'foh'
  return primaryDepartment === 'foh' || primaryDepartment === 'hybrid'
}

export function isTipEligibleForWork(
  employee: Pick<Employee, 'role' | 'primary_department'>,
  workDepartment?: string | null
) {
  return workDepartment ? isTipEligibleDepartment(workDepartment) : isTipEligibleEmployee(employee)
}
