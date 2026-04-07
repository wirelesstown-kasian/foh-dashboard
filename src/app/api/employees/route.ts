import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { hashPin } from '@/lib/pin'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { EmployeeRole } from '@/lib/types'
import { isValidPin } from '@/lib/validation'
import { hashPassword } from '@/lib/password'

const VALID_ROLES: EmployeeRole[] = ['manager', 'server', 'busser', 'runner', 'kitchen_staff']

async function requireAdmin() {
  const cookieStore = await cookies()
  return isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)
}

function isValidRole(role: unknown): role is EmployeeRole {
  return typeof role === 'string' && VALID_ROLES.includes(role as EmployeeRole)
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('id, name, phone, email, role, hourly_wage, guaranteed_hourly, birth_date, login_enabled, is_active, created_at')
    .eq('is_active', true)
    .order('name')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ employees: data ?? [] })
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { name, phone, email, role, birth_date, pin, hourly_wage, guaranteed_hourly, login_enabled, login_password } = await req.json()
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }
  if (!isValidRole(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
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
  if (hourlyWage !== null && Number.isNaN(hourlyWage)) {
    return NextResponse.json({ error: 'Invalid hourly wage' }, { status: 400 })
  }
  if (guaranteedHourly !== null && Number.isNaN(guaranteedHourly)) {
    return NextResponse.json({ error: 'Invalid guaranteed hourly amount' }, { status: 400 })
  }

  const pin_hash = await hashPin(pin)
  const loginPasswordHash = login_enabled === true ? await hashPassword(login_password.trim()) : null
  const { error } = await supabaseAdmin.from('employees').insert({
    name: name.trim(),
    phone: typeof phone === 'string' && phone.trim() ? phone.trim() : null,
    email: typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null,
    role,
    hourly_wage: hourlyWage,
    guaranteed_hourly: guaranteedHourly,
    birth_date: typeof birth_date === 'string' && birth_date ? birth_date : null,
    login_enabled: login_enabled === true,
    login_password_hash: loginPasswordHash,
    pin_hash,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id, name, phone, email, role, birth_date, pin, hourly_wage, guaranteed_hourly, login_enabled, login_password } = await req.json()
  if (typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'Employee id is required' }, { status: 400 })
  }
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }
  if (!isValidRole(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }
  if (login_enabled === true && !(typeof email === 'string' && email.trim())) {
    return NextResponse.json({ error: 'Email is required when app login is enabled' }, { status: 400 })
  }

  const hourlyWage = typeof hourly_wage === 'number' ? hourly_wage : typeof hourly_wage === 'string' && hourly_wage.trim() ? Number(hourly_wage) : null
  const guaranteedHourly = typeof guaranteed_hourly === 'number' ? guaranteed_hourly : typeof guaranteed_hourly === 'string' && guaranteed_hourly.trim() ? Number(guaranteed_hourly) : null
  if (hourlyWage !== null && Number.isNaN(hourlyWage)) {
    return NextResponse.json({ error: 'Invalid hourly wage' }, { status: 400 })
  }
  if (guaranteedHourly !== null && Number.isNaN(guaranteedHourly)) {
    return NextResponse.json({ error: 'Invalid guaranteed hourly amount' }, { status: 400 })
  }

  const update: {
    name: string
    phone: string | null
    email: string | null
    role: EmployeeRole
    hourly_wage: number | null
    guaranteed_hourly: number | null
    birth_date: string | null
    login_enabled: boolean
    pin_hash?: string
    login_password_hash?: string | null
  } = {
    name: name.trim(),
    phone: typeof phone === 'string' && phone.trim() ? phone.trim() : null,
    email: typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null,
    role,
    hourly_wage: hourlyWage,
    guaranteed_hourly: guaranteedHourly,
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

  if (isValidPin(pin)) {
    update.pin_hash = await hashPin(pin)
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

  const { error } = await supabaseAdmin.from('employees').update(update).eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
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

  const { error } = await supabaseAdmin.from('employees').update({ is_active: false }).eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
