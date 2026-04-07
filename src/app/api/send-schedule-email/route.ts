import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { sendWeeklyScheduleEmails } from '@/lib/scheduleEmail'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { getEmailSettings } from '@/lib/appSettings'

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  if (!isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
  const { week_start, week_end } = await req.json()
  if (!week_start || !week_end) return NextResponse.json({ error: 'Missing week_start or week_end' }, { status: 400 })
  const settings = await getEmailSettings()
  if (!settings.schedule_emails_enabled) {
    return NextResponse.json({ success: true, sent: 0, message: 'Schedule emails are disabled in Email Settings' })
  }

  const result = await sendWeeklyScheduleEmails({
    weekStart: week_start,
    weekEnd: week_end,
    appUrl,
  })

  if (!result.success) {
    return NextResponse.json(result, { status: 207 })
  }

  return NextResponse.json(result)
}
