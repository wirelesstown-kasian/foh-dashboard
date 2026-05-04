import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { APP_SESSION_COOKIE, createAppSessionValue, getAppSessionMaxAge, parseAppSessionValue } from '@/lib/appAuth'
import { ADMIN_SESSION_COOKIE } from '@/lib/adminSession'
import { verifyPassword } from '@/lib/password'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function GET() {
  const cookieStore = await cookies()
  const session = parseAppSessionValue(cookieStore.get(APP_SESSION_COOKIE)?.value)

  const { count } = await supabaseAdmin
    .from('employees')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('login_enabled', true)

  const loginReady = (count ?? 0) > 0

  if (!session) {
    return NextResponse.json({ authenticated: false, login_ready: loginReady })
  }

  cookieStore.set(APP_SESSION_COOKIE, createAppSessionValue({
    employeeId: session.employeeId,
    name: session.name,
    email: session.email,
    role: session.role,
  }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: getAppSessionMaxAge(),
  })

  return NextResponse.json({
    authenticated: true,
    login_ready: loginReady,
    employee: {
      id: session.employeeId,
      name: session.name,
      email: session.email,
      role: session.role,
    },
    can_manage_admin: session.role === 'manager',
  })
}

export async function POST(req: NextRequest) {
  const { email, password } = await req.json() as { email?: string; password?: string }
  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password.trim()) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
  }

  const normalizedEmail = email.trim().toLowerCase()
  const { data: employees, error } = await supabaseAdmin
    .from('employees')
    .select('id, name, email, role, login_enabled, login_password_hash, is_active')
    .ilike('email', normalizedEmail)
    .eq('is_active', true)
    .eq('login_enabled', true)
    .limit(1)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const employee = employees?.[0]
  if (!employee?.login_password_hash || !employee.email) {
    return NextResponse.json({ error: 'No active app login found for that email' }, { status: 401 })
  }

  const passwordMatches = await verifyPassword(password, employee.login_password_hash)
  if (!passwordMatches) {
    return NextResponse.json({ error: 'Incorrect email or password' }, { status: 401 })
  }

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
