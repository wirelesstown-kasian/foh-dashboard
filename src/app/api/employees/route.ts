import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { hashPin } from '@/lib/pin'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { EmployeeRole } from '@/lib/types'

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
    .select('*')
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

  const { name, phone, email, role, birth_date, pin } = await req.json()
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }
  if (!isValidRole(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: 'PIN must be 4 digits' }, { status: 400 })
  }

  const pin_hash = await hashPin(pin)
  const { error } = await supabaseAdmin.from('employees').insert({
    name: name.trim(),
    phone: typeof phone === 'string' && phone.trim() ? phone.trim() : null,
    email: typeof email === 'string' && email.trim() ? email.trim() : null,
    role,
    birth_date: typeof birth_date === 'string' && birth_date ? birth_date : null,
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

  const { id, name, phone, email, role, birth_date, pin } = await req.json()
  if (typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'Employee id is required' }, { status: 400 })
  }
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }
  if (!isValidRole(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  const update: {
    name: string
    phone: string | null
    email: string | null
    role: EmployeeRole
    birth_date: string | null
    pin_hash?: string
  } = {
    name: name.trim(),
    phone: typeof phone === 'string' && phone.trim() ? phone.trim() : null,
    email: typeof email === 'string' && email.trim() ? email.trim() : null,
    role,
    birth_date: typeof birth_date === 'string' && birth_date ? birth_date : null,
  }

  if (typeof pin === 'string' && /^\d{4}$/.test(pin)) {
    update.pin_hash = await hashPin(pin)
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
