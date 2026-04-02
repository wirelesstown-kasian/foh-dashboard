import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ADMIN_SESSION_COOKIE, createAdminSessionValue } from '@/lib/adminSession'
import { hasActiveManagers } from '@/lib/adminBootstrap'
import { hashPin } from '@/lib/pin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function GET() {
  try {
    return NextResponse.json({ needsSetup: !(await hasActiveManagers()) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to check admin setup' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { name, email, pin } = await req.json()

  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Manager name is required' }, { status: 400 })
  }
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: 'PIN must be 4 digits' }, { status: 400 })
  }

  try {
    if (await hasActiveManagers()) {
      return NextResponse.json({ error: 'An admin manager already exists' }, { status: 409 })
    }

    const pinHash = await hashPin(pin)
    const { error } = await supabaseAdmin.from('employees').insert({
      name: name.trim(),
      email: typeof email === 'string' && email.trim() ? email.trim() : null,
      role: 'manager',
      pin_hash: pinHash,
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const cookieStore = await cookies()
    cookieStore.set(ADMIN_SESSION_COOKIE, createAdminSessionValue(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 8,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create admin manager' }, { status: 500 })
  }
}
