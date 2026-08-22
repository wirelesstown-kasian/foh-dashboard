export const EMPLOYEE_PUBLIC_SELECT =
  'id, name, phone, email, address, role, primary_department, schedule_departments, hourly_wage, guaranteed_hourly, tip_pool_hourly_rate, meal_break_threshold_hours, commission_enabled, commission_note, payment_method, birth_date, login_enabled, is_active, created_at'

export const EMPLOYEE_PUBLIC_SELECT_WITHOUT_MEAL_BREAK_THRESHOLD =
  'id, name, phone, email, address, role, primary_department, schedule_departments, hourly_wage, guaranteed_hourly, tip_pool_hourly_rate, commission_enabled, commission_note, payment_method, birth_date, login_enabled, is_active, created_at'

export const EMPLOYEE_PUBLIC_SELECT_FALLBACK =
  'id, name, phone, email, role, primary_department, hourly_wage, guaranteed_hourly, birth_date, login_enabled, is_active, created_at'

export const EMPLOYEE_PUBLIC_SELECT_WITHOUT_SCHEDULE_DEPARTMENTS =
  'id, name, phone, email, address, role, primary_department, hourly_wage, guaranteed_hourly, tip_pool_hourly_rate, commission_enabled, commission_note, payment_method, birth_date, login_enabled, is_active, created_at'

export function isMissingTipPoolRateColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? ''
  return message.includes('tip_pool_hourly_rate') || message.includes('schema cache')
}

export function isMissingMealBreakThresholdColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? ''
  return message.includes('meal_break_threshold_hours') || message.includes('schema cache')
}

export function isMissingScheduleDepartmentsColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? ''
  return message.includes('schedule_departments') || message.includes('schema cache')
}

export function isMissingPaymentMethodColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? ''
  return message.includes('payment_method') || message.includes('schema cache')
}

export function isMissingAddressColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? ''
  return message.includes('address') || message.includes('commission_enabled') || message.includes('commission_note') || message.includes('schema cache')
}

const LEGACY_SCHEDULE_DEPARTMENT_MAP: Record<string, string> = {
  foh: 'server',
  boh: 'cook',
  hybrid: 'manager',
}

function normalizeStoredScheduleDepartments(scheduleDepartments: unknown) {
  if (!Array.isArray(scheduleDepartments)) return []

  return Array.from(new Set(
    scheduleDepartments
      .filter((department): department is string => typeof department === 'string' && department.trim().length > 0)
      .map(department => department.trim())
      .map(department => LEGACY_SCHEDULE_DEPARTMENT_MAP[department] ?? department)
  ))
}

function getScheduleDepartmentFromRole(role: unknown) {
  if (typeof role !== 'string') return null
  if (role === 'kitchen_staff') return 'cook'
  if (role === 'prep' || role === 'dishwasher') return 'kitchen'
  if (role === 'food_runner' || role === 'runner') return 'server'
  if (role === 'busser') return 'server'
  if (role === 'manager' || role === 'server' || role === 'cook' || role === 'kitchen') return role
  return null
}

export function withTipPoolHourlyRate<T extends object>(employees: T[]) {
  return employees.map(employee => ({
    ...employee,
    tip_pool_hourly_rate: 'tip_pool_hourly_rate' in employee
      ? (employee.tip_pool_hourly_rate as number | null)
      : null,
  }))
}

export function withMealBreakThresholdHours<T extends object>(employees: T[]) {
  return employees.map(employee => ({
    ...employee,
    meal_break_threshold_hours: 'meal_break_threshold_hours' in employee && employee.meal_break_threshold_hours != null
      ? (employee.meal_break_threshold_hours as number)
      : 7.5,
  }))
}

export function withPaymentMethod<T extends object>(employees: T[]) {
  return employees.map(employee => ({
    ...employee,
    payment_method: 'payment_method' in employee
      ? (employee.payment_method as string | null)
      : null,
  }))
}

export function withStaffingProfileFields<T extends object>(employees: T[]) {
  return employees.map(employee => ({
    ...employee,
    address: 'address' in employee ? (employee.address as string | null) : null,
    commission_enabled: 'commission_enabled' in employee ? (employee.commission_enabled as boolean) : false,
    commission_note: 'commission_note' in employee ? (employee.commission_note as string | null) : null,
  }))
}

export function getEmployeeScheduleDepartments(employee: { role?: unknown; primary_department?: string | null; schedule_departments?: unknown }) {
  const storedDepartments = normalizeStoredScheduleDepartments(employee.schedule_departments)
  if (storedDepartments.length > 0) {
    return storedDepartments
  }

  const roleDepartment = getScheduleDepartmentFromRole(employee.role)
  if (roleDepartment) return [roleDepartment]

  const primaryDepartment = employee.primary_department ?? 'foh'
  if (primaryDepartment === 'boh') return ['cook']
  if (primaryDepartment === 'hybrid') return ['manager']
  if (primaryDepartment === 'foh') return ['server']
  return [primaryDepartment]
}

export function withScheduleDepartments<T extends object>(employees: T[]) {
  return employees.map(employee => ({
    ...employee,
    schedule_departments: getEmployeeScheduleDepartments(employee),
  }))
}
