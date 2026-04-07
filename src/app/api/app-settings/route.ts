import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { getEmailSettings, saveEmailSettings } from '@/lib/appSettings'

async function requireAdmin() {
  const cookieStore = await cookies()
  return isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return NextResponse.json({ settings: await getEmailSettings() })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load email settings' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const settings = await saveEmailSettings(body)
    return NextResponse.json({ success: true, settings })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save email settings' }, { status: 500 })
  }
}
