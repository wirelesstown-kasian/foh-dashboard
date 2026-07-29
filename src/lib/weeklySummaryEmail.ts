import { escapeHtml, renderEmailShell, sendEmail } from '@/lib/emailUtils'
import { getEmailSettings } from '@/lib/appSettings'
import { buildPerformanceRows } from '@/lib/performanceReporting'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { Employee, ShiftClock, TaskCompletion } from '@/lib/types'

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

function getMonthRange(dateString: string) {
  const date = new Date(`${dateString}T12:00:00`)
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1)
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0)

  return {
    monthStart: formatDateOnly(monthStart),
    monthEnd: formatDateOnly(monthEnd),
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
  if (!emailSettings.weekly_summary_emails_enabled || !emailSettings.weekly_summary_recipient) {
    return { success: true, skipped: true, reason: 'Weekly summary email is disabled.' }
  }

  const { weekStart, weekEnd } = getPreviousTuesdaySundayRange(referenceDate)
  const { monthStart, monthEnd } = getMonthRange(weekEnd)
  const logoUrl = `${appUrl}/new%20logo%20V3.jpg`

  const [
    weekReportsRes,
    monthlyReportsRes,
    employeesRes,
    taskCompletionsRes,
    shiftClocksRes,
    cashEntriesRes,
    allCashReportsRes,
  ] = await Promise.all([
    supabaseAdmin
      .from('eod_reports')
      .select('*, tip_distributions(*)')
      .gte('session_date', weekStart)
      .lte('session_date', weekEnd)
      .order('session_date'),
    supabaseAdmin
      .from('eod_reports')
      .select('*, tip_distributions(*)')
      .gte('session_date', monthStart)
      .lte('session_date', monthEnd),
    supabaseAdmin.from('employees').select('*'),
    supabaseAdmin
      .from('task_completions')
      .select('*')
      .gte('session_date', monthStart)
      .lte('session_date', monthEnd),
    supabaseAdmin
      .from('shift_clocks')
      .select('*')
      .gte('session_date', monthStart)
      .lte('session_date', monthEnd),
    supabaseAdmin
      .from('cash_balance_entries')
      .select('entry_date, entry_type, amount')
      .lte('entry_date', weekEnd),
    supabaseAdmin
      .from('eod_reports')
      .select('session_date, actual_cash_on_hand')
      .gt('actual_cash_on_hand', 0)
      .lte('session_date', weekEnd),
  ])

  if (weekReportsRes.error) {
    throw new Error(weekReportsRes.error.message)
  }

  const weekReports = weekReportsRes.data
  if (!weekReports || weekReports.length === 0) {
    return { success: true, skipped: true, reason: `No EOD reports found for ${weekStart} to ${weekEnd}.` }
  }

  if (monthlyReportsRes.error) throw new Error(monthlyReportsRes.error.message)
  if (employeesRes.error) throw new Error(employeesRes.error.message)
  if (taskCompletionsRes.error) throw new Error(taskCompletionsRes.error.message)
  if (shiftClocksRes.error) throw new Error(shiftClocksRes.error.message)
  if (cashEntriesRes.error) throw new Error(cashEntriesRes.error.message)
  if (allCashReportsRes.error) throw new Error(allCashReportsRes.error.message)

  const allEodIds = weekReports.map((report: { id: string }) => report.id)
  const { data: allDists, error: distsError } = await supabaseAdmin
    .from('tip_distributions')
    .select('*, employee:employees(id, name)')
    .in('eod_report_id', allEodIds)

  if (distsError) {
    throw new Error(distsError.message)
  }

  const totalRevenue = weekReports.reduce((sum: number, report: { revenue_total: number }) => sum + Number(report.revenue_total), 0)
  const totalNetRevenue = weekReports.reduce((sum: number, report: { revenue_total: number; sales_tax: number | null; tip_total: number }) => (
    sum + Number(report.revenue_total) - Number(report.sales_tax ?? 0) - Number(report.tip_total)
  ), 0)
  const totalTips = weekReports.reduce((sum: number, report: { tip_total: number }) => sum + Number(report.tip_total), 0)
  const totalCash = weekReports.reduce((sum: number, report: { cash_total: number }) => sum + Number(report.cash_total), 0)
  const totalBatch = weekReports.reduce((sum: number, report: { batch_total: number }) => sum + Number(report.batch_total), 0)
  const totalCashTip = weekReports.reduce((sum: number, report: { cash_tip: number }) => sum + Number(report.cash_tip), 0)
  const totalDeposit = weekReports.reduce((sum: number, report: { cash_deposit: number }) => sum + Number(report.cash_deposit), 0)
  const totalCashOnHandByDate = new Map<string, number>()

  const actualCashReports = allCashReportsRes.data ?? []
  const cashEntries = cashEntriesRes.data ?? []
  for (const report of weekReports) {
    const eodCashTotal = actualCashReports.reduce((sum, item) => {
      return item.session_date <= report.session_date ? sum + Number(item.actual_cash_on_hand ?? 0) : sum
    }, 0)
    const cashEntryTotal = cashEntries.reduce((sum, entry) => {
      if (entry.entry_date > report.session_date) return sum
      return sum + (entry.entry_type === 'cash_in' ? Number(entry.amount) : -Number(entry.amount))
    }, 0)
    totalCashOnHandByDate.set(report.session_date, eodCashTotal + cashEntryTotal)
  }

  const endingCashOnHand = totalCashOnHandByDate.get(weekReports[weekReports.length - 1]?.session_date ?? '') ?? 0

  const employees = (employeesRes.data ?? []) as Employee[]
  const { perfRows } = buildPerformanceRows({
    employees,
    completions: (taskCompletionsRes.data ?? []) as TaskCompletion[],
    eodReports: monthlyReportsRes.data ?? [],
    clockRecords: (shiftClocksRes.data ?? []) as ShiftClock[],
    startDate: weekStart,
    endDate: weekEnd,
    monthStart,
    monthEnd,
  })
  const performanceByEmployeeId = new Map(
    perfRows.map(row => [row.emp.id, row.monthly?.score ?? null])
  )

  const dailyRows = weekReports.map((report: {
    session_date: string
    cash_total: number
    batch_total: number
    revenue_total: number
    sales_tax: number | null
    tip_total: number
    cash_tip: number
    cash_deposit: number
  }) =>
    `<tr>
      <td>${report.session_date}</td>
      <td style="text-align:right">$${Number(report.cash_total).toFixed(2)}</td>
      <td style="text-align:right">$${Number(report.batch_total).toFixed(2)}</td>
      <td style="text-align:right">$${Number(report.revenue_total).toFixed(2)}</td>
      <td style="text-align:right">$${(Number(report.revenue_total) - Number(report.sales_tax ?? 0) - Number(report.tip_total)).toFixed(2)}</td>
      <td style="text-align:right">$${Number(report.cash_tip).toFixed(2)}</td>
      <td style="text-align:right">$${Number(report.tip_total).toFixed(2)}</td>
      <td style="text-align:right">$${Number(report.cash_deposit).toFixed(2)}</td>
      <td style="text-align:right">$${(totalCashOnHandByDate.get(report.session_date) ?? 0).toFixed(2)}</td>
    </tr>`
  ).join('')

  type EmployeeTipSummary = { employeeId: string; name: string; hours: number; total: number; tipPerHour: number; performanceScore: number | null }
  const employeeTipMap = new Map<string, EmployeeTipSummary>()
  for (const distribution of (allDists ?? []) as Array<{ employee_id: string; employee?: { id: string; name: string } | null; hours_worked: number; net_tip: number }>) {
    const employeeId = distribution.employee_id
    const name = distribution.employee?.name ?? employeeId
    const existing = employeeTipMap.get(employeeId) ?? { employeeId, name, hours: 0, total: 0, tipPerHour: 0, performanceScore: performanceByEmployeeId.get(employeeId) ?? null }
    existing.hours += Number(distribution.hours_worked)
    existing.total += Number(distribution.net_tip)
    existing.tipPerHour = existing.hours > 0 ? existing.total / existing.hours : 0
    employeeTipMap.set(employeeId, existing)
  }

  const employeeTipSummaries = Array.from(employeeTipMap.values()).sort((left, right) => right.total - left.total)
  const totalEmployeeHours = employeeTipSummaries.reduce((sum, employee) => sum + employee.hours, 0)
  const totalEmployeeTips = employeeTipSummaries.reduce((sum, employee) => sum + employee.total, 0)
  const totalEmployeeTipPerHour = totalEmployeeHours > 0 ? totalEmployeeTips / totalEmployeeHours : 0
  const employeesWithScore = employeeTipSummaries.filter(employee => employee.performanceScore !== null)
  const averagePerformanceScore = employeesWithScore.length > 0
    ? employeesWithScore.reduce((sum, employee) => sum + Number(employee.performanceScore ?? 0), 0) / employeesWithScore.length
    : null

  const employeeTipRows = employeeTipSummaries
    .map(employee =>
      `<tr>
        <td>${escapeHtml(employee.name)}</td>
        <td style="text-align:right">${employee.hours.toFixed(1)}</td>
        <td style="text-align:right">$${employee.total.toFixed(2)}</td>
        <td style="text-align:right">${employee.hours > 0 ? `$${employee.tipPerHour.toFixed(2)}` : '—'}</td>
        <td style="text-align:right">${employee.performanceScore ?? '—'}</td>
      </tr>`
    ).join('')

  const weeklyHtml = renderEmailShell(logoUrl, `
    <h2 style="color:#1a1a1a">Weekly Revenue &amp; Tip Summary</h2>
    <p><strong>Week:</strong> ${weekStart} – ${weekEnd}</p>
    <p style="color:#6b7280">Tuesday through Sunday summary, delivered on Monday morning.</p>
    <h3>Daily Breakdown</h3>
    <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%">
      <tr style="background:#f5f5f5">
        <th>Date</th><th>Cash Revenue</th><th>Batch Total</th><th>Gross Revenue</th><th>Net Revenue</th><th>Cash Tip</th><th>Tips</th><th>Cash Deposit</th><th>Cash On Hand</th>
      </tr>
      ${dailyRows}
      <tr style="font-weight:bold;background:#e8eaf6">
        <td>TOTAL</td>
        <td style="text-align:right">$${totalCash.toFixed(2)}</td>
        <td style="text-align:right">$${totalBatch.toFixed(2)}</td>
        <td style="text-align:right">$${totalRevenue.toFixed(2)}</td>
        <td style="text-align:right">$${totalNetRevenue.toFixed(2)}</td>
        <td style="text-align:right">$${totalCashTip.toFixed(2)}</td>
        <td style="text-align:right">$${totalTips.toFixed(2)}</td>
        <td style="text-align:right">$${totalDeposit.toFixed(2)}</td>
        <td style="text-align:right">$${endingCashOnHand.toFixed(2)}</td>
      </tr>
    </table>
    <h3>Weekly Tips by Employee</h3>
    <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%">
      <tr style="background:#f5f5f5"><th>Name</th><th>Total Hours</th><th>Total Tips</th><th>Tip / Hr</th><th>Performance Score</th></tr>
      ${employeeTipRows}
      <tr style="font-weight:bold;background:#e8eaf6">
        <td>TOTAL</td>
        <td style="text-align:right">${totalEmployeeHours.toFixed(1)}</td>
        <td style="text-align:right">$${totalEmployeeTips.toFixed(2)}</td>
        <td style="text-align:right">${totalEmployeeHours > 0 ? `$${totalEmployeeTipPerHour.toFixed(2)}` : '—'}</td>
        <td style="text-align:right">${averagePerformanceScore !== null ? averagePerformanceScore.toFixed(0) : '—'}</td>
      </tr>
    </table>
    <p style="color:#888;font-size:12px;margin-top:20px">New Village Pub · FOH Dashboard</p>
  `, 640)

  await sendEmail({
    resendKey,
    to: emailSettings.weekly_summary_recipient,
    subject: `Weekly Summary — ${weekStart} to ${weekEnd}`,
    html: weeklyHtml,
    fromName: emailSettings.from_name,
    fromEmail: emailSettings.from_email,
    replyTo: emailSettings.reply_to,
  })

  return { success: true, skipped: false, weekStart, weekEnd }
}
