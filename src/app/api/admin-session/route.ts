import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyPin } from '@/lib/pin'
import { ADMIN_SESSION_COOKIE, createAdminSessionValue } from '@/lib/adminSession'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isValidPin } from '@/lib/validation'

export async function GET() {
  const cookieStore = await cookies()
  return NextResponse.json({ authenticated: !!cookieStore.get(ADMIN_SESSION_COOKIE)?.value })
}

export async function POST(req: NextRequest) {
  const { pin } = await req.json()
  if (!isValidPin(pin)) {
    return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 })
  }

  const { data: managers, error } = await supabaseAdmin
    .from('employees')
    .select('pin_hash')
    .eq('role', 'manager')
    .eq('is_active', true)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  for (const manager of managers ?? []) {
    if (await verifyPin(pin, manager.pin_hash)) {
      const cookieStore = await cookies()
      cookieStore.set(ADMIN_SESSION_COOKIE, createAdminSessionValue(), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 8,
      })
      return NextResponse.json({ success: true })
    }
  }

  return NextResponse.json({ error: 'Incorrect manager PIN' }, { status: 401 })
}

export async function DELETE() {
  const cookieStore = await cookies()
  cookieStore.delete(ADMIN_SESSION_COOKIE)
  return NextResponse.json({ success: true })
}
