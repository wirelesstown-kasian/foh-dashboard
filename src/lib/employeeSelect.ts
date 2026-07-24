export const EMPLOYEE_PUBLIC_SELECT =
  'id, name, phone, email, role, primary_department, schedule_departments, hourly_wage, guaranteed_hourly, tip_pool_hourly_rate, birth_date, login_enabled, is_active, created_at'

export const EMPLOYEE_PUBLIC_SELECT_FALLBACK =
  'id, name, phone, email, role, primary_department, hourly_wage, guaranteed_hourly, birth_date, login_enabled, is_active, created_at'

export const EMPLOYEE_PUBLIC_SELECT_WITHOUT_SCHEDULE_DEPARTMENTS =
  'id, name, phone, email, role, primary_department, hourly_wage, guaranteed_hourly, tip_pool_hourly_rate, birth_date, login_enabled, is_active, created_at'

export function isMissingTipPoolRateColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? ''
  return message.includes('tip_pool_hourly_rate') || message.includes('schema cache')
}

export function isMissingScheduleDepartmentsColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? ''
  return message.includes('schedule_departments') || message.includes('schema cache')
}

export function withTipPoolHourlyRate<T extends object>(employees: T[]) {
  return employees.map(employee => ({
    ...employee,
    tip_pool_hourly_rate: 'tip_pool_hourly_rate' in employee
      ? (employee.tip_pool_hourly_rate as number | null)
      : null,
  }))
}

export function getEmployeeScheduleDepartments(employee: { primary_department?: string | null; schedule_departments?: unknown }) {
  if (Array.isArray(employee.schedule_departments)) {
    const departments = employee.schedule_departments
      .filter((department): department is string => typeof department === 'string' && department.trim().length > 0)
      .map(department => department.trim())
    if (departments.length > 0) return Array.from(new Set(departments))
  }

  const primaryDepartment = employee.primary_department ?? 'foh'
  return primaryDepartment === 'hybrid' ? ['foh', 'boh'] : [primaryDepartment]
}

export function withScheduleDepartments<T extends object>(employees: T[]) {
  return employees.map(employee => ({
    ...employee,
    schedule_departments: getEmployeeScheduleDepartments(employee),
  }))
}
