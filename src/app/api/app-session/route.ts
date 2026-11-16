import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { APP_SESSION_COOKIE, createAppSessionValue, getAppSessionMaxAge, parseAppSessionValue } from '@/lib/appAuth'
import { ADMIN_SESSION_COOKIE } from '@/lib/adminSession'
import { verifyPin } from '@/lib/pin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { chicagoDate } from '@/lib/onboarding'

export async function GET() {
  const cookieStore = await cookies()
  const session = parseAppSessionValue(cookieStore.get(APP_SESSION_COOKIE)?.value)

  if (!session) {
    return NextResponse.json({ authenticated: false, login_ready: true })
  }

  const { data: employee, error } = await supabaseAdmin
    .from('employees')
    .select('id, name, email, role')
    .eq('id', session.employeeId)
    .eq('is_active', true)
    .eq('login_enabled', true)
    .maybeSingle()
  if (error || !employee) {
    cookieStore.delete(APP_SESSION_COOKIE)
    return NextResponse.json({ authenticated: false, login_ready: true })
  }

  cookieStore.set(APP_SESSION_COOKIE, createAppSessionValue({
    employeeId: employee.id,
    name: employee.name,
    email: employee.email,
    role: employee.role,
  }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: getAppSessionMaxAge(),
  })

  return NextResponse.json({
    authenticated: true,
    login_ready: true,
    employee: {
      id: employee.id,
      name: employee.name,
      email: employee.email,
      role: employee.role,
    },
    can_manage_admin: employee.role === 'manager',
  })
}

export async function POST(req: NextRequest) {
  const { email, pin } = await req.json() as { email?: string; pin?: string }
  if (typeof email !== 'string' || !email.trim() || !/^\d{4}$/.test(pin ?? '')) {
    return NextResponse.json({ error: 'Email and four-digit PIN are required' }, { status: 400 })
  }

  const normalizedEmail = email.trim().toLowerCase()
  const attempts = await supabaseAdmin.from('app_pin_attempts').select('failures,locked_until').eq('email', normalizedEmail).maybeSingle()
  if (attempts.error) return NextResponse.json({ error: attempts.error.message }, { status: 500 })
  if (attempts.data?.locked_until && new Date(attempts.data.locked_until) > new Date()) return NextResponse.json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 })
  // Make scheduled access available as soon as the employee logs in on the activation date.
  const pending = await supabaseAdmin.from('onboarding_cases').select('id')
    .eq('email', normalizedEmail).eq('status', 'approved').lte('activation_date', chicagoDate())
  if (!pending.error) {
    for (const row of pending.data ?? []) await supabaseAdmin.rpc('activate_onboarding_case', { p_case_id: row.id })
  }
  const { data: employees, error } = await supabaseAdmin
    .from('employees')
    .select('id, name, email, role, login_enabled, pin_hash, pin_code, is_active')
    .ilike('email', normalizedEmail)
    .eq('is_active', true)
    .eq('login_enabled', true)
    .limit(1)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const employee = employees?.[0]
  const pinMatches = Boolean(employee?.pin_hash && await verifyPin(pin!, employee.pin_hash)) || employee?.pin_code === pin
  if (!employee?.email || !pinMatches) {
    const failures = (attempts.data?.failures ?? 0) + 1
    const tracked = await supabaseAdmin.from('app_pin_attempts').upsert({ email: normalizedEmail, failures, locked_until: failures >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : null, updated_at: new Date().toISOString() })
    if (tracked.error) return NextResponse.json({ error: tracked.error.message }, { status: 500 })
    return NextResponse.json({ error: 'Incorrect email or PIN' }, { status: 401 })
  }
  await supabaseAdmin.from('app_pin_attempts').delete().eq('email', normalizedEmail)

  const cookieStore = await cookies()
  cookieStore.set(APP_SESSION_COOKIE, createAppSessionValue({
    employeeId: employee.id,
    name: employee.name,
    email: employee.email,
    role: employee.role,
  }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: getAppSessionMaxAge(),
  })

  return NextResponse.json({
    success: true,
    employee: {
      id: employee.id,
      name: employee.name,
      email: employee.email,
      role: employee.role,
    },
    can_manage_admin: employee.role === 'manager',
  })
}

export async function DELETE() {
  const cookieStore = await cookies()
  cookieStore.delete(APP_SESSION_COOKIE)
  cookieStore.delete(ADMIN_SESSION_COOKIE)
  return NextResponse.json({ success: true })
}
