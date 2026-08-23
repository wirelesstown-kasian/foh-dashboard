import { Employee } from '@/lib/types'

const TIP_PAYING_DEPARTMENTS = new Set(['server'])

export function isStandardTipRole(role: Employee['role']) {
  return role === 'server'
}

export function isTipEligibleDepartment(department: string | null | undefined) {
  const normalized = department?.trim().toLowerCase()
  if (!normalized) return false
  return TIP_PAYING_DEPARTMENTS.has(normalized)
}

export function isTipEligibleEmployee(employee: Pick<Employee, 'role' | 'primary_department' | 'tip_eligible'>) {
  if (typeof employee.tip_eligible === 'boolean') return employee.tip_eligible
  return isStandardTipRole(employee.role) || employee.primary_department === 'server'
}

export function isTipEligibleForWork(
  employee: Pick<Employee, 'role' | 'primary_department' | 'tip_eligible'>,
  workDepartment?: string | null
) {
  if (!isTipEligibleEmployee(employee)) return false
  return workDepartment ? isTipEligibleDepartment(workDepartment) : employee.primary_department === 'server'
}
