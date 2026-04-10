import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { renderEmailShell, sendEmail } from '@/lib/emailUtils'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getEmailSettings } from '@/lib/appSettings'

type WageReportPeriod = 'daily' | 'weekly' | 'monthly'
type WageReportView = 'earnings' | 'tips'

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`
}

function getRange(refDate: string, period: WageReportPeriod) {
  const date = new Date(refDate + 'T12:00:00')
  if (period === 'daily') {
    return { start: refDate, end: refDate, label: refDate }
  }

  if (period === 'weekly') {
    const start = new Date(date)
    const day = start.getDay()
    const diff = day === 0 ? -6 : 1 - day
    start.setDate(start.getDate() + diff)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    return {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
      label: `${start.toISOString().split('T')[0]} - ${end.toISOString().split('T')[0]}`,
    }
  }

  const start = new Date(date.getFullYear(), date.getMonth(), 1)
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
    label: `${start.toISOString().split('T')[0]} - ${end.toISOString().split('T')[0]}`,
  }
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  if (!isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { employee_id, ref_date, period, view, start_date, end_date } = await req.json() as {
    employee_id?: string
    ref_date?: string
    period?: WageReportPeriod
    view?: WageReportView
    start_date?: string
    end_date?: string
  }

  if (!employee_id || !ref_date || !period || !view) {
    return NextResponse.json({ error: 'Missing wage report email payload' }, { status: 400 })
  }

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 })
  const emailSettings = await getEmailSettings()
  if (!emailSettings.wage_report_emails_enabled) {
    return NextResponse.json({ success: true, skipped: true, message: 'Wage report emails are disabled in Email Settings' })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
  const logoUrl = `${appUrl}/new%20logo%20V3.jpg`
  const customRange = start_date && end_date
    ? {
        start: start_date <= end_date ? start_date : end_date,
        end: start_date <= end_date ? end_date : start_date,
        label: start_date === end_date ? start_date : `${start_date <= end_date ? start_date : end_date} - ${start_date <= end_date ? end_date : start_date}`,
      }
    : null
  const { start, end, label } = customRange ?? getRange(ref_date, period)

  const { data: employee, error: employeeError } = await supabaseAdmin
    .from('employees')
    .select('*')
    .eq('id', employee_id)
    .single()

  if (employeeError || !employee?.email) {
    return NextResponse.json({ error: 'Employee email not available' }, { status: 400 })
  }

  const { data: reports, error: reportsError } = await supabaseAdmin
    .from('eod_reports')
    .select('id, session_date, tip_distributions(*)')
    .gte('session_date', start)
    .lte('session_date', end)
    .order('session_date')

  if (reportsError) {
    return NextResponse.json({ error: reportsError.message }, { status: 500 })
  }

  const { data: clockRecords, error: clockError } = await supabaseAdmin
    .from('shift_clocks')
    .select('session_date, approved_hours, auto_clock_out, clock_out_at, approval_status')
    .eq('employee_id', employee_id)
    .gte('session_date', start)
    .lte('session_date', end)

  if (clockError) {
    return NextResponse.json({ error: clockError.message }, { status: 500 })
  }

  const approvedClockHoursByDate = ((clockRecords ?? []) as Array<{ session_date: string; approved_hours: number | null }>)
    .reduce((map, record) => {
      map.set(record.session_date, (map.get(record.session_date) ?? 0) + Number(record.approved_hours ?? 0))
      return map
    }, new Map<string, number>())

  const distributions = (reports ?? []).flatMap(report => {
    const dailyTips = (report.tip_distributions ?? [])
      .filter((dist: { employee_id: string }) => dist.employee_id === employee_id)
      .reduce((sum: number, dist: { net_tip: number }) => sum + Number(dist.net_tip), 0)
    const dailyHours = approvedClockHoursByDate.get(report.session_date) ?? 0
    return dailyTips > 0 || dailyHours > 0
      ? [{ date: report.session_date, hours: dailyHours, tips: dailyTips }]
      : []
  })

  const hours = distributions.reduce((sum, dist) => sum + dist.hours, 0)
  const tips = distributions.reduce((sum, dist) => sum + dist.tips, 0)
  const baseWages = hours * Number(employee.hourly_wage ?? 0)
  const guaranteedTopUp = distributions.reduce((sum, dist) => {
    const guaranteedTarget = dist.hours * Number(employee.guaranteed_hourly ?? 0)
    const shiftBaseWage = dist.hours * Number(employee.hourly_wage ?? 0)
    return sum + Math.max(0, guaranteedTarget - (shiftBaseWage + dist.tips))
  }, 0)
  const totalEarnings = baseWages + tips + guaranteedTopUp
  const tipsPerHour = hours > 0 ? tips / hours : null
  const effectiveRate = hours > 0 ? totalEarnings / hours : null
  const hasClockWarning = ((clockRecords ?? []) as Array<{ auto_clock_out: boolean; clock_out_at: string | null; approval_status: string }>)
    .some(record => record.auto_clock_out || !record.clock_out_at || record.approval_status === 'pending_review')

  const html = renderEmailShell(logoUrl, `
    <h2 style="color:#1a1a1a">${view === 'earnings' ? 'Earnings Report' : 'Tip Report'} — ${label}</h2>
    <p>Hi ${employee.name},</p>
    ${hasClockWarning ? `
      <div style="margin:0 0 16px;padding:12px 14px;border:1px solid #f59e0b;background:#fffbeb;color:#92400e;border-radius:12px">
        Clock warning: one or more shifts in this report still need review. Hours use approved clock records only.
      </div>
    ` : ''}
    <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
      <tr><td><strong>Period</strong></td><td>${label}</td></tr>
      <tr><td><strong>Hours Worked</strong></td><td>${hours.toFixed(2)} hrs</td></tr>
      <tr><td><strong>Tips Earned</strong></td><td>${formatCurrency(tips)}</td></tr>
      <tr><td><strong>Tips per Hour</strong></td><td>${tipsPerHour !== null ? formatCurrency(tipsPerHour) : '—'}</td></tr>
      ${view === 'earnings' ? `
        <tr><td><strong>Hourly Wage</strong></td><td>${employee.hourly_wage !== null ? formatCurrency(Number(employee.hourly_wage)) : '—'}</td></tr>
        <tr><td><strong>Base Wages</strong></td><td>${formatCurrency(baseWages)}</td></tr>
        <tr><td><strong>Guaranteed / Hr</strong></td><td>${employee.guaranteed_hourly !== null ? formatCurrency(Number(employee.guaranteed_hourly)) : '—'}</td></tr>
        <tr><td><strong>Guaranteed Top-Up</strong></td><td>${formatCurrency(guaranteedTopUp)}</td></tr>
        <tr style="background:#eef7ff"><td><strong>Total Earnings</strong></td><td><strong>${formatCurrency(totalEarnings)}</strong></td></tr>
        <tr><td><strong>Effective / Hr</strong></td><td>${effectiveRate !== null ? formatCurrency(effectiveRate) : '—'}</td></tr>
      ` : ''}
    </table>
    <h3 style="margin:20px 0 8px;color:#1a1a1a">Daily Detail</h3>
    <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
      <tr>
        <th align="left">Date</th>
        <th align="right">Hours</th>
        <th align="right">Tips</th>
        ${view === 'earnings' ? '<th align="right">Base Wages</th><th align="right">Top-Up</th><th align="right">Total</th>' : ''}
      </tr>
      ${distributions.map(dist => {
        const dailyBaseWage = dist.hours * Number(employee.hourly_wage ?? 0)
        const dailyGuaranteedTarget = dist.hours * Number(employee.guaranteed_hourly ?? 0)
        const dailyTopUp = Math.max(0, dailyGuaranteedTarget - (dailyBaseWage + dist.tips))
        const dailyTotal = dailyBaseWage + dist.tips + dailyTopUp
        return `
          <tr>
            <td>${dist.date}</td>
            <td align="right">${dist.hours.toFixed(2)} hrs</td>
            <td align="right">${formatCurrency(dist.tips)}</td>
            ${view === 'earnings' ? `<td align="right">${formatCurrency(dailyBaseWage)}</td><td align="right">${formatCurrency(dailyTopUp)}</td><td align="right">${formatCurrency(dailyTotal)}</td>` : ''}
          </tr>
        `
      }).join('')}
    </table>
  `, 520)

  await sendEmail({
    resendKey,
    to: employee.email,
    subject: `${view === 'earnings' ? 'Earnings' : 'Tip'} Report — ${label}`,
    html,
    fromName: emailSettings.from_name,
    fromEmail: emailSettings.from_email,
    replyTo: emailSettings.reply_to,
  })

  return NextResponse.json({ success: true })
}
