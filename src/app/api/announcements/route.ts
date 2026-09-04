import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { buildAnnouncementItems, formatAnnouncementBoardText } from '@/lib/announcementBoard'
import { getAppSettings, saveAppSettings, type AnnouncementEvent } from '@/lib/appSettings'
import { getBusinessDateString } from '@/lib/dateUtils'
import { escapeHtml, renderEmailShell, sendEmail } from '@/lib/emailUtils'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const cookieStore = await cookies()
  return isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)
}

function formatEventDetail(event: AnnouncementEvent) {
  const dayWindow = event.day_start_time && event.day_end_time
    ? `${event.day_start_time.slice(0, 5)}-${event.day_end_time.slice(0, 5)}`
    : null
  const recurrence = event.recurrence && event.recurrence !== 'none' ? event.recurrence : 'No repeat'
  return [
    ['Date', event.date],
    ['Time', event.time?.slice(0, 5) || 'Not set'],
    ['Day-of Window', dayWindow || 'Not set'],
    ['Place', event.place || 'Not set'],
    ['Duration', event.duration],
    ['Show Starting On', event.duration === 'custom' ? event.announcement_start_date || 'Not set' : 'Not set'],
    ['Recurring', recurrence],
    ['Repeat Until', event.recurrence_end_date || 'Not set'],
  ]
}

function buildBirthdayCalendarEvents(employees: Array<{ id: string; name: string; birth_date?: string | null }>): AnnouncementEvent[] {
  return employees
    .filter(employee => employee.birth_date && /^\d{4}-\d{2}-\d{2}$/.test(employee.birth_date))
    .map(employee => ({
      id: `birthday-${employee.id}`,
      title: `Happy birthday, ${employee.name}!`,
      date: employee.birth_date as string,
      time: '',
      day_start_time: '',
      day_end_time: '',
      place: '',
      duration: 'until_close',
      recurrence: 'annually',
      recurrence_end_date: '',
      is_active: true,
    }))
}

async function sendAnnouncementEventEmail(event: AnnouncementEvent, settings: Awaited<ReturnType<typeof getAppSettings>>, origin: string) {
  if (!settings.announcement_event_emails_enabled) return
  const resendKey = process.env.RESEND_API_KEY
  const recipient = settings.announcement_event_email.trim()
  if (!resendKey || !recipient) return

  const logoUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? origin}/new%20logo%20V3.jpg`
  const rows = formatEventDetail(event).map(([label, value]) => `
    <tr>
      <td style="border:1px solid #d1d5db;padding:8px 10px;font-weight:700;background:#f9fafb">${escapeHtml(label)}</td>
      <td style="border:1px solid #d1d5db;padding:8px 10px">${escapeHtml(String(value))}</td>
    </tr>
  `).join('')
  const html = renderEmailShell(logoUrl, `
    <h2 style="color:#111827;margin:0 0 6px">Announcement Event Created</h2>
    <p style="margin:0 0 14px;color:#4b5563">A new announcement calendar event was added.</p>
    <h3 style="margin:0 0 10px;color:#111827">${escapeHtml(event.title)}</h3>
    <table border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px">${rows}</table>
  `)

  await sendEmail({
    resendKey,
    to: recipient,
    subject: `Announcement Event Created - ${event.title}`,
    html,
    fromName: settings.from_name,
    fromEmail: settings.from_email,
    replyTo: settings.reply_to,
  })
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
      birthdayEvents: buildBirthdayCalendarEvents(employees ?? []),
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
    const currentSettings = await getAppSettings()
    const existingEventIds = new Set(currentSettings.announcement_events.map(event => event.id))
    const settings = await saveAppSettings({
      time_clock_announcement: typeof body.announcement === 'string' ? body.announcement : '',
      announcement_events: Array.isArray(body.events) ? body.events : [],
    })
    const newEvents = settings.announcement_events.filter(event => !existingEventIds.has(event.id))
    for (const event of newEvents) {
      try {
        await sendAnnouncementEventEmail(event, settings, req.nextUrl.origin)
      } catch (error) {
        console.error('Failed to send announcement event email', error)
      }
    }
    return NextResponse.json({
      success: true,
      announcement: settings.time_clock_announcement,
      events: settings.announcement_events,
      eventEmailsSent: newEvents.length,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save announcements' }, { status: 500 })
  }
}
