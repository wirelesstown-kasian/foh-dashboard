import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { sendWeeklyScheduleEmails } from '@/lib/scheduleEmail'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { getAppSettings, getEmailSettings } from '@/lib/appSettings'
import type { ScheduleDepartment } from '@/lib/types'

function parseDepartment(value: unknown): ScheduleDepartment | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return typeof value === 'string' ? value : undefined
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  if (!isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
    const { week_start, week_end, department } = await req.json()
    if (!week_start || !week_end) return NextResponse.json({ error: 'Missing week_start or week_end' }, { status: 400 })
    const appSettings = await getAppSettings()
    const validDepartments = appSettings.primary_department_definitions.filter(definition => definition.is_active).map(definition => definition.key)
    const scheduleDepartment = parseDepartment(department)
    if (department && (!scheduleDepartment || !validDepartments.includes(scheduleDepartment))) {
      return NextResponse.json({ error: 'Invalid schedule department' }, { status: 400 })
    }
    const settings = await getEmailSettings()
    if (!settings.schedule_emails_enabled) {
      return NextResponse.json({ success: true, sent: 0, message: 'Schedule emails are disabled in Email Settings' })
    }

    const result = await sendWeeklyScheduleEmails({
      weekStart: week_start,
      weekEnd: week_end,
      appUrl,
      department: scheduleDepartment,
    })

    if (!result.success) {
      return NextResponse.json(result, { status: 207 })
    }

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send schedule emails' },
      { status: 500 }
    )
  }
}
