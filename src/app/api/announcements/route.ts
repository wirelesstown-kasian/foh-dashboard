import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { buildAnnouncementItems, formatAnnouncementBoardText } from '@/lib/announcementBoard'
import { getAppSettings, saveAppSettings } from '@/lib/appSettings'
import { getBusinessDateString } from '@/lib/dateUtils'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const cookieStore = await cookies()
  return isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)
}

export async function GET() {
  try {
    const settings = await getAppSettings()
    const { data: employees, error } = await supabaseAdmin
      .from('employees')
      .select('id, name, birth_date')
      .eq('is_active', true)

    if (error) throw new Error(error.message)

    const today = getBusinessDateString()
    const items = buildAnnouncementItems({
      announcement: settings.time_clock_announcement,
      events: settings.announcement_events,
      employees: employees ?? [],
      today,
    })

    return NextResponse.json({
      announcement: settings.time_clock_announcement,
      events: settings.announcement_events,
      items,
      boardText: formatAnnouncementBoardText(items),
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load announcements' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const settings = await saveAppSettings({
      time_clock_announcement: typeof body.announcement === 'string' ? body.announcement : '',
      announcement_events: Array.isArray(body.events) ? body.events : [],
    })
    return NextResponse.json({
      success: true,
      announcement: settings.time_clock_announcement,
      events: settings.announcement_events,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save announcements' }, { status: 500 })
  }
}
