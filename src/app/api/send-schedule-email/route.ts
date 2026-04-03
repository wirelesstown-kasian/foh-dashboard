import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function formatTime(time: string): string {
  if (!time) return ''
  const [h, m] = time.split(':')
  const hour = parseInt(h, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${m} ${ampm}`
}

function calcHours(startTime: string, endTime: string): number {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }
  const start = toMinutes(startTime)
  let end = toMinutes(endTime)
  if (end <= start) end += 24 * 60
  return Math.round(((end - start) / 60) * 100) / 100
}

function formatHours(hours: number): string {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function formatDisplayDate(date: string) {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatCalendarDay(date: string) {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })
}

function renderEmailShell(logoUrl: string, content: string, maxWidth = 520) {
  return `
    <div style="font-family:sans-serif;max-width:${maxWidth}px">
      <div style="padding:8px 0 18px;text-align:center">
        <img
          src="${logoUrl}"
          alt="New Village Pub logo"
          style="display:inline-block;max-width:220px;width:100%;height:auto;object-fit:contain"
        />
      </div>
      ${content}
    </div>
  `
}

export async function POST(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 })
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
  const logoUrl = `${appUrl}/new%20logo%20V3.jpg`

  const { week_start, week_end } = await req.json()
  if (!week_start || !week_end) return NextResponse.json({ error: 'Missing week_start or week_end' }, { status: 400 })

  // Fetch all schedules for the week with employee info
  const { data: schedules } = await supabase
    .from('schedules')
    .select('*, employee:employees(id, name, email, role)')
    .gte('date', week_start)
    .lte('date', week_end)
    .order('date')

  if (!schedules || schedules.length === 0) {
    return NextResponse.json({ success: true, sent: 0, message: 'No schedules to send' })
  }

  // Group schedules by employee
  type EmpSchedule = {
    employee: { id: string; name: string; email: string | null; role: string }
    shifts: Array<{ date: string; start_time: string; end_time: string }>
  }
  const empMap = new Map<string, EmpSchedule>()

  for (const s of schedules as Array<{
    date: string; start_time: string; end_time: string
    employee: { id: string; name: string; email: string | null; role: string } | null
  }>) {
    if (!s.employee) continue
    const empId = s.employee.id
    if (!empMap.has(empId)) {
      empMap.set(empId, { employee: s.employee, shifts: [] })
    }
    empMap.get(empId)!.shifts.push({ date: s.date, start_time: s.start_time, end_time: s.end_time })
  }

  const emailPromises: Promise<void>[] = []

  for (const { employee, shifts } of empMap.values()) {
    if (!employee.email) continue

    const totalHours = shifts.reduce((s, sh) => s + calcHours(sh.start_time, sh.end_time), 0)

    const shiftsByDate = new Map(shifts.map(shift => [shift.date, shift]))

    // Format week range for display
    const weekStartDate = new Date(week_start + 'T12:00:00')
    const weekEndDate = new Date(week_end + 'T12:00:00')
    const weekLabel = `${weekStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEndDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    const weekDates: string[] = []
    for (let cursor = new Date(week_start + 'T12:00:00'); cursor <= weekEndDate; cursor.setDate(cursor.getDate() + 1)) {
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
    .filter(r => r.status === 'rejected')
    .map(r => (r as PromiseRejectedResult).reason?.message ?? 'Unknown error')

  if (errors.length > 0) {
    return NextResponse.json({ success: false, errors, sent: results.length - errors.length }, { status: 207 })
  }

  return NextResponse.json({ success: true, sent: results.length })
}
