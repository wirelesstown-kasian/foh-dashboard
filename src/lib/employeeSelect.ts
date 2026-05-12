export const EMPLOYEE_PUBLIC_SELECT =
  'id, name, phone, email, role, primary_department, hourly_wage, guaranteed_hourly, tip_pool_hourly_rate, birth_date, login_enabled, is_active, created_at'

export const EMPLOYEE_PUBLIC_SELECT_FALLBACK =
  'id, name, phone, email, role, primary_department, hourly_wage, guaranteed_hourly, birth_date, login_enabled, is_active, created_at'

export function isMissingTipPoolRateColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? ''
  return message.includes('tip_pool_hourly_rate') || message.includes('schema cache')
}

export function withTipPoolHourlyRate<T extends object>(employees: T[]) {
  return employees.map(employee => ({
    ...employee,
    tip_pool_hourly_rate: 'tip_pool_hourly_rate' in employee
      ? (employee.tip_pool_hourly_rate as number | null)
      : null,
  }))
}
