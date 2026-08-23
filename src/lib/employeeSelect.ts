export const EMPLOYEE_PUBLIC_SELECT =
  'id, name, phone, email, address, role, primary_department, schedule_departments, hourly_wage, guaranteed_hourly, tip_pool_hourly_rate, tip_eligible, meal_break_threshold_hours, commission_enabled, commission_note, payment_method, birth_date, login_enabled, is_active, created_at'

export const EMPLOYEE_PUBLIC_SELECT_WITHOUT_MEAL_BREAK_THRESHOLD =
  'id, name, phone, email, address, role, primary_department, schedule_departments, hourly_wage, guaranteed_hourly, tip_pool_hourly_rate, tip_eligible, commission_enabled, commission_note, payment_method, birth_date, login_enabled, is_active, created_at'

export const EMPLOYEE_PUBLIC_SELECT_FALLBACK =
  'id, name, phone, email, role, primary_department, hourly_wage, guaranteed_hourly, birth_date, login_enabled, is_active, created_at'

export const EMPLOYEE_PUBLIC_SELECT_WITHOUT_SCHEDULE_DEPARTMENTS =
  'id, name, phone, email, address, role, primary_department, hourly_wage, guaranteed_hourly, tip_pool_hourly_rate, tip_eligible, commission_enabled, commission_note, payment_method, birth_date, login_enabled, is_active, created_at'

export const EMPLOYEE_PUBLIC_SELECT_WITHOUT_TIP_ELIGIBLE =
  'id, name, phone, email, address, role, primary_department, schedule_departments, hourly_wage, guaranteed_hourly, tip_pool_hourly_rate, meal_break_threshold_hours, commission_enabled, commission_note, payment_method, birth_date, login_enabled, is_active, created_at'

function missingColumnMessageIncludes(error: { message?: string; code?: string } | null | undefined, ...columns: string[]) {
  const message = error?.message?.toLowerCase() ?? ''
  return columns.some(column => message.includes(column))
}

export function isMissingTipPoolRateColumn(error: { message?: string; code?: string } | null | undefined) {
  return missingColumnMessageIncludes(error, 'tip_pool_hourly_rate')
}

export function isMissingTipEligibleColumn(error: { message?: string; code?: string } | null | undefined) {
  return missingColumnMessageIncludes(error, 'tip_eligible')
}

export function isMissingMealBreakThresholdColumn(error: { message?: string; code?: string } | null | undefined) {
  return missingColumnMessageIncludes(error, 'meal_break_threshold_hours')
}

export function isMissingScheduleDepartmentsColumn(error: { message?: string; code?: string } | null | undefined) {
  return missingColumnMessageIncludes(error, 'schedule_departments')
}

export function isMissingPaymentMethodColumn(error: { message?: string; code?: string } | null | undefined) {
  return missingColumnMessageIncludes(error, 'payment_method')
}

export function isMissingAddressColumn(error: { message?: string; code?: string } | null | undefined) {
  return missingColumnMessageIncludes(error, 'address', 'commission_enabled', 'commission_note')
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

export function getDefaultTipEligible(employee: { role?: unknown; primary_department?: string | null; schedule_departments?: unknown }) {
  return getEmployeeScheduleDepartments(employee).includes('server')
}

export function withTipEligible<T extends object>(employees: T[]) {
  return employees.map(employee => ({
    ...employee,
    tip_eligible: 'tip_eligible' in employee && typeof employee.tip_eligible === 'boolean'
      ? employee.tip_eligible
      : getDefaultTipEligible(employee),
  }))
}

export function withMealBreakThresholdHours<T extends object>(employees: T[]) {
  return employees.map(employee => ({
    ...employee,
    meal_break_threshold_hours: 'meal_break_threshold_hours' in employee
      ? (employee.meal_break_threshold_hours as number | null)
      : 7.5,
  }))
}

export function withPaymentMethod<T extends object>(employees: T[]) {
  return employees.map(employee => ({
    ...employee,
    payment_method: 'payment_method' in employee && employee.payment_method
      ? (employee.payment_method as string)
      : 'cash',
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
