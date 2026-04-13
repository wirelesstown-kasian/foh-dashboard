import { escapeHtml, renderEmailShell, sendEmail } from '@/lib/emailUtils'
import { getEmailSettings } from '@/lib/appSettings'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

function formatDateOnly(date: Date) {
  return date.toISOString().split('T')[0]
}

export function getPreviousTuesdaySundayRange(referenceDate = new Date()) {
  const anchor = new Date(`${formatDateOnly(referenceDate)}T12:00:00`)
  const day = anchor.getDay()
  const daysSinceSunday = day === 0 ? 7 : day

  const sunday = new Date(anchor)
  sunday.setDate(anchor.getDate() - daysSinceSunday)

  const tuesday = new Date(sunday)
  tuesday.setDate(sunday.getDate() - 5)

  return {
    weekStart: formatDateOnly(tuesday),
    weekEnd: formatDateOnly(sunday),
  }
}

export async function sendPreviousWeekSummaryEmail({
  resendKey,
  appUrl,
  referenceDate = new Date(),
}: {
  resendKey: string
  appUrl: string
  referenceDate?: Date
}) {
  const emailSettings = await getEmailSettings()
  if (!emailSettings.eod_admin_summary_enabled || !emailSettings.eod_report_email) {
    return { success: true, skipped: true, reason: 'Weekly summary email is disabled.' }
  }

  const { weekStart, weekEnd } = getPreviousTuesdaySundayRange(referenceDate)
  const logoUrl = `${appUrl}/new%20logo%20V3.jpg`

  const { data: weekReports, error: weekReportsError } = await supabaseAdmin
    .from('eod_reports')
    .select('*, tip_distributions(*)')
    .gte('session_date', weekStart)
    .lte('session_date', weekEnd)
    .order('session_date')

  if (weekReportsError) {
    throw new Error(weekReportsError.message)
  }

  if (!weekReports || weekReports.length === 0) {
    return { success: true, skipped: true, reason: `No EOD reports found for ${weekStart} to ${weekEnd}.` }
  }

  const allEodIds = weekReports.map((report: { id: string }) => report.id)
  const { data: allDists, error: distsError } = await supabaseAdmin
    .from('tip_distributions')
    .select('*, employee:employees(id, name)')
    .in('eod_report_id', allEodIds)

  if (distsError) {
    throw new Error(distsError.message)
  }

  const totalRevenue = weekReports.reduce((sum: number, report: { revenue_total: number }) => sum + Number(report.revenue_total), 0)
  const totalTips = weekReports.reduce((sum: number, report: { tip_total: number }) => sum + Number(report.tip_total), 0)
  const totalCash = weekReports.reduce((sum: number, report: { cash_total: number }) => sum + Number(report.cash_total), 0)
  const totalBatch = weekReports.reduce((sum: number, report: { batch_total: number }) => sum + Number(report.batch_total), 0)
  const totalDeposit = weekReports.reduce((sum: number, report: { cash_deposit: number }) => sum + Number(report.cash_deposit), 0)

  const dailyRows = weekReports.map((report: {
    session_date: string
    cash_total: number
    batch_total: number
    revenue_total: number
    tip_total: number
    cash_deposit: number
  }) =>
    `<tr>
      <td>${report.session_date}</td>
      <td style="text-align:right">$${Number(report.cash_total).toFixed(2)}</td>
      <td style="text-align:right">$${Number(report.batch_total).toFixed(2)}</td>
      <td style="text-align:right">$${Number(report.revenue_total).toFixed(2)}</td>
      <td style="text-align:right">$${Number(report.tip_total).toFixed(2)}</td>
      <td style="text-align:right">$${Number(report.cash_deposit).toFixed(2)}</td>
    </tr>`
  ).join('')

  type EmployeeTipSummary = { name: string; hours: number; total: number }
  const employeeTipMap = new Map<string, EmployeeTipSummary>()
  for (const distribution of (allDists ?? []) as Array<{ employee_id: string; employee?: { id: string; name: string } | null; hours_worked: number; net_tip: number }>) {
    const employeeId = distribution.employee_id
    const name = distribution.employee?.name ?? employeeId
    const existing = employeeTipMap.get(employeeId) ?? { name, hours: 0, total: 0 }
    existing.hours += Number(distribution.hours_worked)
    existing.total += Number(distribution.net_tip)
    employeeTipMap.set(employeeId, existing)
  }

  const employeeTipRows = Array.from(employeeTipMap.values())
    .sort((left, right) => right.total - left.total)
    .map(employee =>
      `<tr>
        <td>${escapeHtml(employee.name)}</td>
        <td style="text-align:right">${employee.hours.toFixed(1)}</td>
        <td style="text-align:right">$${employee.total.toFixed(2)}</td>
      </tr>`
    ).join('')

  const weeklyHtml = renderEmailShell(logoUrl, `
    <h2 style="color:#1a1a1a">Weekly Revenue &amp; Tip Summary</h2>
    <p><strong>Week:</strong> ${weekStart} – ${weekEnd}</p>
    <p style="color:#6b7280">Tuesday through Sunday summary, delivered on Monday morning.</p>
    <h3>Daily Breakdown</h3>
    <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%">
      <tr style="background:#f5f5f5">
        <th>Date</th><th>Cash</th><th>Batch</th><th>Revenue</th><th>Tips</th><th>Deposit</th>
      </tr>
      ${dailyRows}
      <tr style="font-weight:bold;background:#e8eaf6">
        <td>TOTAL</td>
        <td style="text-align:right">$${totalCash.toFixed(2)}</td>
        <td style="text-align:right">$${totalBatch.toFixed(2)}</td>
        <td style="text-align:right">$${totalRevenue.toFixed(2)}</td>
        <td style="text-align:right">$${totalTips.toFixed(2)}</td>
        <td style="text-align:right">$${totalDeposit.toFixed(2)}</td>
      </tr>
    </table>
    <h3>Weekly Tips by Employee</h3>
    <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%">
      <tr style="background:#f5f5f5"><th>Name</th><th>Total Hours</th><th>Total Tips</th></tr>
      ${employeeTipRows}
    </table>
    <p style="color:#888;font-size:12px;margin-top:20px">New Village Pub · FOH Dashboard</p>
  `, 640)

  await sendEmail({
    resendKey,
    to: emailSettings.eod_report_email,
    subject: `Weekly Summary — ${weekStart} to ${weekEnd}`,
    html: weeklyHtml,
    fromName: emailSettings.from_name,
    fromEmail: emailSettings.from_email,
    replyTo: emailSettings.reply_to,
  })

  return { success: true, skipped: false, weekStart, weekEnd }
}
