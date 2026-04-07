import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  formatTime,
  calcHours,
  formatHours,
  formatDisplayDate,
  formatCalendarDay,
  renderEmailShell,
  sendEmail,
} from '@/lib/emailUtils'
import { getEmailSettings } from '@/lib/appSettings'

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
  const emailSettings = await getEmailSettings()
  if (!emailSettings.schedule_emails_enabled) {
    return { success: true, sent: 0, message: 'Schedule emails are disabled in Email Settings' }
  }

  const logoUrl = `${appUrl}/new%20logo%20V3.jpg`

  const { data: schedules } = await supabaseAdmin
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
  const fohSchedules = (schedules as Array<{
    date: string
    start_time: string
    end_time: string
    employee: { id: string; name: string; email: string | null; role: string } | null
  }>).filter(schedule => schedule.employee && schedule.employee.role !== 'kitchen_staff')

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

    const fohTeamRows = Array.from(
      fohSchedules.reduce((map, schedule) => {
        const name = schedule.employee?.name ?? 'Unknown Staff'
        const existing = map.get(name) ?? []
        existing.push(schedule)
        map.set(name, existing)
        return map
      }, new Map<string, Array<{ date: string; start_time: string; end_time: string }>>())
    )
      .sort(([nameA], [nameB]) => nameA.localeCompare(nameB))
      .map(([name, teamShifts]) => {
        const byDate = new Map(teamShifts.map(shift => [shift.date, shift]))
        const cells = weekDates.map(date => {
          const shift = byDate.get(date)
          return `
            <td style="border:1px solid #e5e7eb;padding:8px;text-align:center;background:${shift ? '#eef7ff' : '#fafafa'}">
              ${shift ? `
                <div style="font-size:12px;font-weight:600;color:#1d4ed8">${formatTime(shift.start_time)} – ${formatTime(shift.end_time)}</div>
                <div style="font-size:11px;color:#475569;margin-top:2px">${formatHours(calcHours(shift.start_time, shift.end_time))}</div>
              ` : `
                <div style="font-size:11px;color:#9ca3af">Off</div>
              `}
            </td>
          `
        }).join('')

        return `
          <tr>
            <td style="border:1px solid #e5e7eb;padding:8px;font-size:12px;font-weight:700;background:${name === employee.name ? '#dbeafe' : '#f8fafc'}">${name}</td>
            ${cells}
          </tr>
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
        <div style="margin-top:22px">
          <h3 style="color:#1a1a1a;margin:0 0 8px">FOH Team Calendar</h3>
          <table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px">
            <thead>
              <tr>
                <th style="border:1px solid #e5e7eb;padding:8px;text-align:left;background:#f8fafc">Staff</th>
                ${weekDates.map(date => `
                  <th style="border:1px solid #e5e7eb;padding:8px;background:#f8fafc">
                    <div style="font-size:11px;font-weight:700;color:#111827">${formatCalendarDay(date)}</div>
                    <div style="font-size:10px;color:#6b7280">${formatDisplayDate(date)}</div>
                  </th>
                `).join('')}
              </tr>
            </thead>
            <tbody>
              ${fohTeamRows}
            </tbody>
          </table>
        </div>
        <p style="color:#888;font-size:12px;margin-top:20px">New Village Pub · FOH Dashboard</p>
    `)

    const weekStartShort = weekStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    emailPromises.push(
      sendEmail({
        resendKey,
        to: employee.email,
        subject: `Your Schedule — Week of ${weekStartShort}`,
        html,
        fromName: emailSettings.from_name,
        fromEmail: emailSettings.from_email,
        replyTo: emailSettings.reply_to,
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
