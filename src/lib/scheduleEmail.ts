import { createClient } from '@supabase/supabase-js'
import {
  formatTime,
  calcHours,
  formatHours,
  formatDisplayDate,
  formatCalendarDay,
  renderEmailShell,
} from '@/lib/emailUtils'

export async function sendWeeklyScheduleEmails({
  weekStart,
  weekEnd,
  appUrl,
}: {
  weekStart: string
  weekEnd: string
  appUrl: string
}) {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) throw new Error('RESEND_API_KEY not configured')

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'placeholder'
  )
  const logoUrl = `${appUrl}/new%20logo%20V3.jpg`

  const { data: schedules } = await supabase
    .from('schedules')
    .select('*, employee:employees(id, name, email, role)')
    .gte('date', weekStart)
    .lte('date', weekEnd)
    .order('date')

  if (!schedules || schedules.length === 0) {
    return { success: true, sent: 0, message: 'No schedules to send' }
  }

  type EmpSchedule = {
    employee: { id: string; name: string; email: string | null; role: string }
    shifts: Array<{ date: string; start_time: string; end_time: string }>
  }
  const empMap = new Map<string, EmpSchedule>()

  for (const schedule of schedules as Array<{
    date: string
    start_time: string
    end_time: string
    employee: { id: string; name: string; email: string | null; role: string } | null
  }>) {
    if (!schedule.employee) continue
    const employeeId = schedule.employee.id
    if (!empMap.has(employeeId)) {
      empMap.set(employeeId, { employee: schedule.employee, shifts: [] })
    }
    empMap.get(employeeId)!.shifts.push({
      date: schedule.date,
      start_time: schedule.start_time,
      end_time: schedule.end_time,
    })
  }

  const emailPromises: Promise<void>[] = []

  for (const { employee, shifts } of empMap.values()) {
    if (!employee.email) continue

    const totalHours = shifts.reduce((sum, shift) => sum + calcHours(shift.start_time, shift.end_time), 0)
    const shiftsByDate = new Map(shifts.map(shift => [shift.date, shift]))
    const weekStartDate = new Date(weekStart + 'T12:00:00')
    const weekEndDate = new Date(weekEnd + 'T12:00:00')
    const weekLabel = `${weekStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEndDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    const weekDates: string[] = []
    for (let cursor = new Date(weekStart + 'T12:00:00'); cursor <= weekEndDate; cursor.setDate(cursor.getDate() + 1)) {
      weekDates.push(cursor.toISOString().split('T')[0])
    }

    const calendarCells = weekDates.map(date => {
      const shift = shiftsByDate.get(date)
      const duration = shift ? formatHours(calcHours(shift.start_time, shift.end_time)) : null
      return `
        <td style="width:14.28%;vertical-align:top;border:1px solid #e5e7eb;padding:10px;background:${shift ? '#eef7ff' : '#fafafa'}">
          <div style="font-size:12px;font-weight:700;color:#111827">${formatCalendarDay(date)}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px">${formatDisplayDate(date)}</div>
          ${shift ? `
            <div style="margin-top:10px;font-size:13px;font-weight:600;color:#1d4ed8">${formatTime(shift.start_time)} – ${formatTime(shift.end_time)}</div>
            <div style="font-size:12px;color:#475569;margin-top:4px">${duration}</div>
          ` : `
            <div style="margin-top:14px;font-size:12px;color:#9ca3af">Off</div>
          `}
        </td>
      `
    }).join('')

    const html = renderEmailShell(logoUrl, `
        <h2 style="color:#1a1a1a;margin-bottom:4px">Your Schedule</h2>
        <p style="color:#666;margin-top:0">${weekLabel}</p>
        <p>Hi ${employee.name},</p>
        <p>Here is your weekly calendar:</p>
        <table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px">
          <tbody>
            <tr>
              ${calendarCells}
            </tr>
            <tr style="background:#f5f5f5;font-weight:bold">
              <td colspan="7" style="padding:10px 12px;text-align:right">Weekly Total: ${formatHours(totalHours)}</td>
            </tr>
          </tbody>
        </table>
        <p style="color:#888;font-size:12px;margin-top:20px">New Village Pub · FOH Dashboard</p>
    `)

    const weekStartShort = weekStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    emailPromises.push(
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'FOH Dashboard <noreply@mail.newvillagepub.com>',
          to: [employee.email],
          subject: `Your Schedule — Week of ${weekStartShort}`,
          html,
        }),
      }).then(async res => {
        if (!res.ok) throw new Error(await res.text())
      })
    )
  }

  const results = await Promise.allSettled(emailPromises)
  const errors = results
    .filter(result => result.status === 'rejected')
    .map(result => (result as PromiseRejectedResult).reason?.message ?? 'Unknown error')

  if (errors.length > 0) {
    return { success: false, errors, sent: results.length - errors.length }
  }

  return { success: true, sent: results.length }
}
