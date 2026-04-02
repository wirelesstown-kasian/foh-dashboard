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

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatDisplayDate(date: string) {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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

    const shiftRows = shifts.map(sh => {
      const dayOfWeek = new Date(sh.date + 'T12:00:00').getDay()
      const dayName = DAY_NAMES[dayOfWeek]
      const dateFormatted = formatDisplayDate(sh.date)
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee"><strong>${dayName}</strong></td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${dateFormatted}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${formatTime(sh.start_time)} – ${formatTime(sh.end_time)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${formatHours(calcHours(sh.start_time, sh.end_time))}</td>
      </tr>`
    }).join('')

    const fullTeamRows = (schedules as Array<{
      date: string
      start_time: string
      end_time: string
      employee: { id: string; name: string; email: string | null; role: string } | null
    }>).map(schedule => {
      const teammate = schedule.employee
      if (!teammate) return ''
      const dayName = DAY_NAMES[new Date(schedule.date + 'T12:00:00').getDay()]
      return `<tr${teammate.id === employee.id ? ' style="background:#eef7ff"' : ''}>
        <td style="padding:6px 10px;border-bottom:1px solid #eee"><strong>${dayName}</strong></td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${formatDisplayDate(schedule.date)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${teammate.name}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-transform:capitalize">${teammate.role}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${formatTime(schedule.start_time)} – ${formatTime(schedule.end_time)}</td>
      </tr>`
    }).join('')

    // Format week range for display
    const weekStartDate = new Date(week_start + 'T12:00:00')
    const weekEndDate = new Date(week_end + 'T12:00:00')
    const weekLabel = `${weekStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEndDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

    const html = renderEmailShell(logoUrl, `
        <h2 style="color:#1a1a1a;margin-bottom:4px">Your Schedule</h2>
        <p style="color:#666;margin-top:0">${weekLabel}</p>
        <p>Hi ${employee.name},</p>
        <p>Here is your schedule for the upcoming week:</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="background:#f5f5f5">
              <th style="padding:6px 10px;text-align:left">Day</th>
              <th style="padding:6px 10px;text-align:left">Date</th>
              <th style="padding:6px 10px;text-align:left">Hours</th>
              <th style="padding:6px 10px;text-align:right">Duration</th>
            </tr>
          </thead>
          <tbody>
            ${shiftRows}
            <tr style="background:#f5f5f5;font-weight:bold">
              <td colspan="3" style="padding:6px 10px">Total Hours</td>
              <td style="padding:6px 10px;text-align:right">${formatHours(totalHours)}</td>
            </tr>
          </tbody>
        </table>
        <h3 style="margin:20px 0 8px;color:#1a1a1a">Full Team Schedule</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#f5f5f5">
              <th style="padding:6px 10px;text-align:left">Day</th>
              <th style="padding:6px 10px;text-align:left">Date</th>
              <th style="padding:6px 10px;text-align:left">Employee</th>
              <th style="padding:6px 10px;text-align:left">Role</th>
              <th style="padding:6px 10px;text-align:left">Shift</th>
            </tr>
          </thead>
          <tbody>
            ${fullTeamRows}
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
