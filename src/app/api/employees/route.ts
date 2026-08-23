import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { hashPin, verifyPin } from '@/lib/pin'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { EmployeeRole, PaymentMethod } from '@/lib/types'
import { isValidPin } from '@/lib/validation'
import { hashPassword } from '@/lib/password'
import { getAppSettings } from '@/lib/appSettings'
import {
  EMPLOYEE_PUBLIC_SELECT,
  EMPLOYEE_PUBLIC_SELECT_FALLBACK,
  EMPLOYEE_PUBLIC_SELECT_WITHOUT_SCHEDULE_DEPARTMENTS,
  EMPLOYEE_PUBLIC_SELECT_WITHOUT_MEAL_BREAK_THRESHOLD,
  EMPLOYEE_PUBLIC_SELECT_WITHOUT_TIP_ELIGIBLE,
  isMissingAddressColumn,
  isMissingMealBreakThresholdColumn,
  isMissingPaymentMethodColumn,
  isMissingScheduleDepartmentsColumn,
  isMissingTipEligibleColumn,
  isMissingTipPoolRateColumn,
  withTipEligible,
  withMealBreakThresholdHours,
  withStaffingProfileFields,
  withPaymentMethod,
  withScheduleDepartments,
  withTipPoolHourlyRate,
} from '@/lib/employeeSelect'

const EMPLOYEE_ADMIN_SELECT = `${EMPLOYEE_PUBLIC_SELECT}, pin_code`
const EMPLOYEE_ADMIN_SELECT_WITHOUT_MEAL_BREAK_THRESHOLD = `${EMPLOYEE_PUBLIC_SELECT_WITHOUT_MEAL_BREAK_THRESHOLD}, pin_code`

async function requireAdmin() {
  const cookieStore = await cookies()
  return isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)
}

async function getValidRoles() {
  const settings = await getAppSettings()
  return settings.role_definitions.filter(definition => definition.is_active).map(definition => definition.key)
}

async function isValidRole(role: unknown): Promise<boolean> {
  return typeof role === 'string' && (await getValidRoles()).includes(role as EmployeeRole)
}

async function getValidPrimaryDepartments() {
  const settings = await getAppSettings()
  return settings.primary_department_definitions.filter(definition => definition.is_active).map(definition => definition.key)
}

async function isValidPrimaryDepartment(primaryDepartment: unknown) {
  return typeof primaryDepartment === 'string' && (await getValidPrimaryDepartments()).includes(primaryDepartment)
}

async function getValidScheduleDepartments(scheduleDepartments: unknown) {
  const validDepartments = await getValidPrimaryDepartments()
  if (Array.isArray(scheduleDepartments)) {
    const normalized = Array.from(new Set(
      scheduleDepartments
        .filter((department): department is string => typeof department === 'string')
        .map(department => department.trim())
        .filter(Boolean)
    ))
    return normalized.length > 0 && normalized.every(department => validDepartments.includes(department))
      ? normalized
      : null
  }

  return null
}

function normalizePaymentMethod(paymentMethod: unknown): PaymentMethod | null {
  if (paymentMethod !== 'cash' && paymentMethod !== 'check' && paymentMethod !== 'ach') return null
  return paymentMethod
}

function withoutTipPoolHourlyRate<T extends { tip_pool_hourly_rate?: unknown }>(payload: T) {
  const fallbackPayload: Partial<T> = { ...payload }
  delete fallbackPayload.tip_pool_hourly_rate
  return fallbackPayload
}

function withoutTipEligible<T extends { tip_eligible?: unknown }>(payload: T) {
  const fallbackPayload: Partial<T> = { ...payload }
  delete fallbackPayload.tip_eligible
  return fallbackPayload
}

function withoutMealBreakThresholdHours<T extends { meal_break_threshold_hours?: unknown }>(payload: T) {
  const fallbackPayload: Partial<T> = { ...payload }
  delete fallbackPayload.meal_break_threshold_hours
  return fallbackPayload
}

function withoutPaymentMethod<T extends { payment_method?: unknown }>(payload: T) {
  const fallbackPayload: Partial<T> = { ...payload }
  delete fallbackPayload.payment_method
  return fallbackPayload
}

function withoutScheduleDepartments<T extends { schedule_departments?: unknown }>(payload: T) {
  const fallbackPayload: Partial<T> = { ...payload }
  delete fallbackPayload.schedule_departments
  return fallbackPayload
}

function withoutPinCode<T extends { pin_code?: unknown }>(payload: T) {
  const fallbackPayload: Partial<T> = { ...payload }
  delete fallbackPayload.pin_code
  return fallbackPayload
}

function withoutStaffingProfileFields<T extends { address?: unknown; commission_enabled?: unknown; commission_note?: unknown }>(payload: T) {
  const fallbackPayload: Partial<T> = { ...payload }
  delete fallbackPayload.address
  delete fallbackPayload.commission_enabled
  delete fallbackPayload.commission_note
  return fallbackPayload
}

function isMissingPinCodeColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? ''
  return message.includes('pin_code')
}

type PinLookupEmployee = {
  id: string
  name: string
  pin_hash: string | null
  pin_code?: string | null
}

function getReplacementScheduleDepartment(currentDepartment: string | null | undefined, scheduleDepartments: string[]) {
  if (currentDepartment === 'kitchen' && scheduleDepartments.includes('cook')) return 'cook'
  if (currentDepartment === 'cook' && scheduleDepartments.includes('kitchen')) return 'kitchen'
  return scheduleDepartments[0]
}

async function reconcileEmployeeScheduleRows(employeeId: string, scheduleDepartments: string[]) {
  if (scheduleDepartments.length === 0) return

  for (const table of ['schedules', 'schedule_drafts'] as const) {
    const rowsResult = await supabaseAdmin
      .from(table)
      .select('id, department')
      .eq('employee_id', employeeId)

    if (rowsResult.error) throw new Error(rowsResult.error.message)

    const invalidRows = ((rowsResult.data ?? []) as Array<{ id: string; department: string | null }>)
      .filter(row => !row.department || !scheduleDepartments.includes(row.department))

    for (const row of invalidRows) {
      const replacementDepartment = getReplacementScheduleDepartment(row.department, scheduleDepartments)
      const updateResult = await supabaseAdmin
        .from(table)
        .update({ department: replacementDepartment })
        .eq('id', row.id)

      if (updateResult.error) throw new Error(updateResult.error.message)
    }
  }
}

async function findDuplicatePin(pin: string, currentEmployeeId?: string) {
  const result = await supabaseAdmin
    .from('employees')
    .select('id, name, pin_hash, pin_code')
    .eq('is_active', true)

  if (result.error) {
    if (isMissingPinCodeColumn(result.error)) {
      const fallbackResult = await supabaseAdmin
        .from('employees')
        .select('id, name, pin_hash')
        .eq('is_active', true)

      if (fallbackResult.error) {
        throw new Error(fallbackResult.error.message)
      }

      return findDuplicatePinInRows(pin, (fallbackResult.data ?? []) as PinLookupEmployee[], currentEmployeeId)
    }

    throw new Error(result.error.message)
  }

  return findDuplicatePinInRows(pin, (result.data ?? []) as PinLookupEmployee[], currentEmployeeId)
}

async function findDuplicatePinInRows(pin: string, employees: PinLookupEmployee[], currentEmployeeId?: string) {
  for (const employee of employees) {
    if (employee.id === currentEmployeeId) continue
    if ('pin_code' in employee && employee.pin_code === pin) return employee
    if (employee.pin_hash && await verifyPin(pin, employee.pin_hash)) return employee
  }

  return null
}

async function writeEmployeeWithOptionalFallback(
  operation: 'insert' | 'update',
  payload: Record<string, unknown>,
  id?: string
) {
  let nextPayload = payload
  let lastError: { message?: string } | null = null

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = operation === 'insert'
      ? await supabaseAdmin.from('employees').insert(nextPayload)
      : await supabaseAdmin.from('employees').update(nextPayload).eq('id', id)

    if (!result.error) return null
    lastError = result.error

    if (isMissingPinCodeColumn(result.error) && 'pin_code' in nextPayload) {
      nextPayload = withoutPinCode(nextPayload)
      continue
    }

    if (isMissingScheduleDepartmentsColumn(result.error) && 'schedule_departments' in nextPayload) {
      nextPayload = withoutScheduleDepartments(nextPayload)
      continue
    }

    if (isMissingTipPoolRateColumn(result.error) && 'tip_pool_hourly_rate' in nextPayload) {
      nextPayload = withoutTipPoolHourlyRate(nextPayload)
      continue
    }

    if (isMissingTipEligibleColumn(result.error) && 'tip_eligible' in nextPayload) {
      nextPayload = withoutTipEligible(nextPayload)
      continue
    }

    if (isMissingMealBreakThresholdColumn(result.error) && 'meal_break_threshold_hours' in nextPayload) {
      nextPayload = withoutMealBreakThresholdHours(nextPayload)
      continue
    }

    if (isMissingPaymentMethodColumn(result.error) && 'payment_method' in nextPayload) {
      nextPayload = withoutPaymentMethod(nextPayload)
      continue
    }

    if (isMissingAddressColumn(result.error) && (
      'address' in nextPayload || 'commission_enabled' in nextPayload || 'commission_note' in nextPayload
    )) {
      nextPayload = withoutStaffingProfileFields(nextPayload)
      continue
    }

    return result.error
  }

  return { message: lastError?.message ?? 'Failed to save employee after optional column fallback' }
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await supabaseAdmin
    .from('employees')
    .select(EMPLOYEE_ADMIN_SELECT)
    .eq('is_active', true)
    .order('name')
  let data = result.data as unknown[] | null
  let error = result.error

  if (error && isMissingPinCodeColumn(error)) {
    const fallbackResult = await supabaseAdmin
      .from('employees')
      .select(EMPLOYEE_PUBLIC_SELECT_WITHOUT_SCHEDULE_DEPARTMENTS)
      .eq('is_active', true)
      .order('name')
    data = fallbackResult.data as unknown[] | null
    error = fallbackResult.error
  }

  if (error && isMissingMealBreakThresholdColumn(error)) {
    const fallbackResult = await supabaseAdmin
      .from('employees')
      .select(EMPLOYEE_ADMIN_SELECT_WITHOUT_MEAL_BREAK_THRESHOLD)
      .eq('is_active', true)
      .order('name')
    data = fallbackResult.data as unknown[] | null
    error = fallbackResult.error
  }

  if (error && isMissingTipEligibleColumn(error)) {
    const fallbackResult = await supabaseAdmin
      .from('employees')
      .select(EMPLOYEE_PUBLIC_SELECT_WITHOUT_TIP_ELIGIBLE)
      .eq('is_active', true)
      .order('name')
    data = fallbackResult.data as unknown[] | null
    error = fallbackResult.error
  }

  if (error && isMissingScheduleDepartmentsColumn(error)) {
    const fallbackResult = await supabaseAdmin
      .from('employees')
      .select(EMPLOYEE_PUBLIC_SELECT_WITHOUT_SCHEDULE_DEPARTMENTS)
      .eq('is_active', true)
      .order('name')
    data = fallbackResult.data as unknown[] | null
    error = fallbackResult.error
  }

  if (error && isMissingTipPoolRateColumn(error)) {
    const fallbackResult = await supabaseAdmin
      .from('employees')
      .select(EMPLOYEE_PUBLIC_SELECT_FALLBACK)
      .eq('is_active', true)
      .order('name')
    data = fallbackResult.data as unknown[] | null
    error = fallbackResult.error
  }

  if (error && isMissingPaymentMethodColumn(error)) {
    const fallbackResult = await supabaseAdmin
      .from('employees')
      .select(EMPLOYEE_PUBLIC_SELECT_FALLBACK)
      .eq('is_active', true)
      .order('name')
    data = fallbackResult.data as unknown[] | null
    error = fallbackResult.error
  }

  if (error && isMissingAddressColumn(error)) {
    const fallbackResult = await supabaseAdmin
      .from('employees')
      .select(EMPLOYEE_PUBLIC_SELECT_FALLBACK)
      .eq('is_active', true)
      .order('name')
    data = fallbackResult.data as unknown[] | null
    error = fallbackResult.error
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ employees: withTipEligible(withMealBreakThresholdHours(withStaffingProfileFields(withPaymentMethod(withScheduleDepartments(withTipPoolHourlyRate((data ?? []) as object[])))))) })
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { name, phone, email, address, role, primary_department, schedule_departments, birth_date, pin, hourly_wage, guaranteed_hourly, tip_pool_hourly_rate, tip_eligible, meal_break_threshold_hours, commission_enabled, commission_note, payment_method, login_enabled, login_password } = await req.json()
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }
  if (!(await isValidRole(role))) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }
  const normalizedScheduleDepartments = await getValidScheduleDepartments(schedule_departments)
  if (!normalizedScheduleDepartments) {
    return NextResponse.json({ error: 'Select at least one valid schedule department' }, { status: 400 })
  }
  const primaryDepartment = typeof primary_department === 'string' && primary_department.trim()
    ? primary_department.trim()
    : normalizedScheduleDepartments[0]
  if (!(await isValidPrimaryDepartment(primaryDepartment))) {
    return NextResponse.json({ error: 'Invalid primary department' }, { status: 400 })
  }
  if (!isValidPin(pin)) {
    return NextResponse.json({ error: 'PIN must be 4 digits' }, { status: 400 })
  }
  if (login_enabled === true && !(typeof email === 'string' && email.trim())) {
    return NextResponse.json({ error: 'Email is required when app login is enabled' }, { status: 400 })
  }
  if (login_enabled === true && !(typeof login_password === 'string' && login_password.trim().length >= 8)) {
    return NextResponse.json({ error: 'Login password must be at least 8 characters' }, { status: 400 })
  }

  const hourlyWage = typeof hourly_wage === 'number' ? hourly_wage : typeof hourly_wage === 'string' && hourly_wage.trim() ? Number(hourly_wage) : null
  const guaranteedHourly = typeof guaranteed_hourly === 'number' ? guaranteed_hourly : typeof guaranteed_hourly === 'string' && guaranteed_hourly.trim() ? Number(guaranteed_hourly) : null
  const tipPoolHourlyRate = typeof tip_pool_hourly_rate === 'number' ? tip_pool_hourly_rate : typeof tip_pool_hourly_rate === 'string' && tip_pool_hourly_rate.trim() ? Number(tip_pool_hourly_rate) : null
  const mealBreakThresholdHours = meal_break_threshold_hours === null
    ? null
    : typeof meal_break_threshold_hours === 'number'
      ? meal_break_threshold_hours
      : typeof meal_break_threshold_hours === 'string' && meal_break_threshold_hours.trim()
        ? Number(meal_break_threshold_hours)
        : 7.5
  if (hourlyWage !== null && (Number.isNaN(hourlyWage) || hourlyWage < 0)) {
    return NextResponse.json({ error: 'Invalid hourly wage' }, { status: 400 })
  }
  if (guaranteedHourly !== null && (Number.isNaN(guaranteedHourly) || guaranteedHourly < 0)) {
    return NextResponse.json({ error: 'Invalid guaranteed hourly amount' }, { status: 400 })
  }
  if (tipPoolHourlyRate !== null && (Number.isNaN(tipPoolHourlyRate) || tipPoolHourlyRate < 0)) {
    return NextResponse.json({ error: 'Invalid tip pool hourly rate' }, { status: 400 })
  }
  if (mealBreakThresholdHours !== null && (Number.isNaN(mealBreakThresholdHours) || mealBreakThresholdHours <= 0)) {
    return NextResponse.json({ error: 'Invalid meal break alert hours' }, { status: 400 })
  }
  const paymentMethod = normalizePaymentMethod(payment_method)
  if (!paymentMethod) {
    return NextResponse.json({ error: 'Select cash, check, or ACH payment method' }, { status: 400 })
  }
  try {
    const duplicate = await findDuplicatePin(pin)
    if (duplicate) {
      return NextResponse.json({ error: `PIN already belongs to ${duplicate.name}. Choose a different PIN.` }, { status: 409 })
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to validate PIN' }, { status: 500 })
  }

  const pin_hash = await hashPin(pin)
  const loginPasswordHash = login_enabled === true ? await hashPassword(login_password.trim()) : null
  const insertPayload = {
    name: name.trim(),
    phone: typeof phone === 'string' && phone.trim() ? phone.trim() : null,
    email: typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null,
    address: typeof address === 'string' && address.trim() ? address.trim() : null,
    role,
    primary_department: primaryDepartment,
    schedule_departments: normalizedScheduleDepartments,
    hourly_wage: hourlyWage,
    guaranteed_hourly: guaranteedHourly,
    tip_pool_hourly_rate: tipPoolHourlyRate,
    tip_eligible: typeof tip_eligible === 'boolean' ? tip_eligible : normalizedScheduleDepartments.includes('server'),
    meal_break_threshold_hours: mealBreakThresholdHours,
    commission_enabled: commission_enabled === true,
    commission_note: commission_enabled === true && typeof commission_note === 'string' && commission_note.trim() ? commission_note.trim() : null,
    payment_method: paymentMethod,
    birth_date: typeof birth_date === 'string' && birth_date ? birth_date : null,
    login_enabled: login_enabled === true,
    login_password_hash: loginPasswordHash,
    pin_hash,
    pin_code: pin,
  }

  const error = await writeEmployeeWithOptionalFallback('insert', insertPayload)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id, name, phone, email, address, role, primary_department, schedule_departments, birth_date, pin, hourly_wage, guaranteed_hourly, tip_pool_hourly_rate, tip_eligible, meal_break_threshold_hours, commission_enabled, commission_note, payment_method, login_enabled, login_password } = await req.json()
  if (typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'Employee id is required' }, { status: 400 })
  }
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }
  if (!(await isValidRole(role))) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }
  const normalizedScheduleDepartments = await getValidScheduleDepartments(schedule_departments)
  if (!normalizedScheduleDepartments) {
    return NextResponse.json({ error: 'Select at least one valid schedule department' }, { status: 400 })
  }
  const primaryDepartment = typeof primary_department === 'string' && primary_department.trim()
    ? primary_department.trim()
    : normalizedScheduleDepartments[0]
  if (!(await isValidPrimaryDepartment(primaryDepartment))) {
    return NextResponse.json({ error: 'Invalid primary department' }, { status: 400 })
  }
  if (login_enabled === true && !(typeof email === 'string' && email.trim())) {
    return NextResponse.json({ error: 'Email is required when app login is enabled' }, { status: 400 })
  }
  const shouldUpdatePin = typeof pin === 'string' && pin.trim().length > 0
  if (shouldUpdatePin && !isValidPin(pin)) {
    return NextResponse.json({ error: 'PIN must be 4 digits' }, { status: 400 })
  }

  const hourlyWage = typeof hourly_wage === 'number' ? hourly_wage : typeof hourly_wage === 'string' && hourly_wage.trim() ? Number(hourly_wage) : null
  const guaranteedHourly = typeof guaranteed_hourly === 'number' ? guaranteed_hourly : typeof guaranteed_hourly === 'string' && guaranteed_hourly.trim() ? Number(guaranteed_hourly) : null
  const tipPoolHourlyRate = typeof tip_pool_hourly_rate === 'number' ? tip_pool_hourly_rate : typeof tip_pool_hourly_rate === 'string' && tip_pool_hourly_rate.trim() ? Number(tip_pool_hourly_rate) : null
  const mealBreakThresholdHours = meal_break_threshold_hours === null
    ? null
    : typeof meal_break_threshold_hours === 'number'
      ? meal_break_threshold_hours
      : typeof meal_break_threshold_hours === 'string' && meal_break_threshold_hours.trim()
        ? Number(meal_break_threshold_hours)
        : 7.5
  if (hourlyWage !== null && (Number.isNaN(hourlyWage) || hourlyWage < 0)) {
    return NextResponse.json({ error: 'Invalid hourly wage' }, { status: 400 })
  }
  if (guaranteedHourly !== null && (Number.isNaN(guaranteedHourly) || guaranteedHourly < 0)) {
    return NextResponse.json({ error: 'Invalid guaranteed hourly amount' }, { status: 400 })
  }
  if (tipPoolHourlyRate !== null && (Number.isNaN(tipPoolHourlyRate) || tipPoolHourlyRate < 0)) {
    return NextResponse.json({ error: 'Invalid tip pool hourly rate' }, { status: 400 })
  }
  if (mealBreakThresholdHours !== null && (Number.isNaN(mealBreakThresholdHours) || mealBreakThresholdHours <= 0)) {
    return NextResponse.json({ error: 'Invalid meal break alert hours' }, { status: 400 })
  }
  const paymentMethod = normalizePaymentMethod(payment_method)
  if (!paymentMethod) {
    return NextResponse.json({ error: 'Select cash, check, or ACH payment method' }, { status: 400 })
  }
  const update: {
    name: string
    phone: string | null
    email: string | null
    address: string | null
    role: EmployeeRole
    primary_department: string
    schedule_departments: string[]
    hourly_wage: number | null
    guaranteed_hourly: number | null
    tip_pool_hourly_rate: number | null
    tip_eligible: boolean
    meal_break_threshold_hours: number | null
    commission_enabled: boolean
    commission_note: string | null
    payment_method: PaymentMethod
    birth_date: string | null
    login_enabled: boolean
    pin_hash?: string
    pin_code?: string
    login_password_hash?: string | null
  } = {
    name: name.trim(),
    phone: typeof phone === 'string' && phone.trim() ? phone.trim() : null,
    email: typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null,
    address: typeof address === 'string' && address.trim() ? address.trim() : null,
    role,
    primary_department: primaryDepartment,
    schedule_departments: normalizedScheduleDepartments,
    hourly_wage: hourlyWage,
    guaranteed_hourly: guaranteedHourly,
    tip_pool_hourly_rate: tipPoolHourlyRate,
    tip_eligible: typeof tip_eligible === 'boolean' ? tip_eligible : normalizedScheduleDepartments.includes('server'),
    meal_break_threshold_hours: mealBreakThresholdHours,
    commission_enabled: commission_enabled === true,
    commission_note: commission_enabled === true && typeof commission_note === 'string' && commission_note.trim() ? commission_note.trim() : null,
    payment_method: paymentMethod,
    birth_date: typeof birth_date === 'string' && birth_date ? birth_date : null,
    login_enabled: login_enabled === true,
  }

  const { data: currentEmployee, error: currentEmployeeError } = await supabaseAdmin
    .from('employees')
    .select('login_password_hash')
    .eq('id', id)
    .single()

  if (currentEmployeeError || !currentEmployee) {
    return NextResponse.json({ error: currentEmployeeError?.message ?? 'Employee not found' }, { status: 404 })
  }

  if (shouldUpdatePin) {
    try {
      const duplicate = await findDuplicatePin(pin, id)
      if (duplicate) {
        return NextResponse.json({ error: `PIN already belongs to ${duplicate.name}. Choose a different PIN.` }, { status: 409 })
      }
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to validate PIN' }, { status: 500 })
    }
    update.pin_hash = await hashPin(pin)
    update.pin_code = pin
  }

  if (login_enabled === true) {
    const hasExistingLoginPassword = typeof currentEmployee.login_password_hash === 'string' && currentEmployee.login_password_hash.length > 0
    if (typeof login_password === 'string' && login_password.trim()) {
      if (login_password.trim().length < 8) {
        return NextResponse.json({ error: 'Login password must be at least 8 characters' }, { status: 400 })
      }
      update.login_password_hash = await hashPassword(login_password.trim())
    } else if (!hasExistingLoginPassword) {
      return NextResponse.json({ error: 'Set a login password before enabling app login' }, { status: 400 })
    }
  } else {
    update.login_password_hash = null
  }

  const error = await writeEmployeeWithOptionalFallback('update', update, id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  try {
    await reconcileEmployeeScheduleRows(id, normalizedScheduleDepartments)
  } catch (reconcileError) {
    return NextResponse.json({ error: reconcileError instanceof Error ? reconcileError.message : 'Failed to update employee schedule rows' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = req.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'Employee id is required' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('employees')
    .update({ is_active: false, login_enabled: false, login_password_hash: null })
    .eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, archived: true })
}
