import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyPin } from '@/lib/pin'
import { ADMIN_SESSION_COOKIE, createAdminSessionValue } from '@/lib/adminSession'
import { getSupabaseAdminConfigError, supabaseAdmin } from '@/lib/supabaseAdmin'
import { isValidPin } from '@/lib/validation'

export async function GET() {
  const cookieStore = await cookies()
  return NextResponse.json({ authenticated: !!cookieStore.get(ADMIN_SESSION_COOKIE)?.value })
}

export async function POST(req: NextRequest) {
  const configError = getSupabaseAdminConfigError()
  if (configError) {
    return NextResponse.json({ error: `Supabase admin is not configured: ${configError}` }, { status: 500 })
  }

  const { pin } = await req.json()
  if (!isValidPin(pin)) {
    return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 })
  }

  let managers: Array<{ name: string | null; pin_hash: string | null; pin_code: string | null }> = []
  try {
    const result = await supabaseAdmin
      .from('employees')
      .select('name, pin_hash, pin_code')
      .eq('role', 'manager')
      .eq('is_active', true)

    if (result.error) {
      return NextResponse.json({ error: `Failed to read manager PINs from Supabase: ${result.error.message}` }, { status: 500 })
    }
    managers = (result.data ?? []) as Array<{ name: string | null; pin_hash: string | null; pin_code: string | null }>
  } catch (error) {
    return NextResponse.json({ error: `Failed to reach Supabase for admin access: ${error instanceof Error ? error.message : 'Unknown error'}` }, { status: 500 })
  }

  for (const manager of managers) {
    if (manager.pin_code === pin) {
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
    if (!manager.pin_hash) continue
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
