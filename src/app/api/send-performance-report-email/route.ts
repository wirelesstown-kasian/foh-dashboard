import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { buildEmailDocument, renderEmailShell, sendEmail } from '@/lib/emailUtils'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getEmailSettings } from '@/lib/appSettings'
import { getEffectiveClockHours } from '@/lib/clockUtils'
import { employeeMatchesScheduleDepartment } from '@/lib/organization'
import type { Employee } from '@/lib/types'

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`
}

function getReportLabel(start: string, end: string) {
  return start === end ? start : `${start} - ${end}`
}

function getRankMap<T>(items: T[], getValue: (item: T) => number, getId: (item: T) => string) {
  const sorted = [...items].sort((a, b) => getValue(b) - getValue(a))
  return new Map(sorted.map((item, index) => [getId(item), index + 1]))
}

function scoreFromRank(rank: number, count: number) {
  if (count <= 1) return 100
  return ((count - rank) / (count - 1)) * 100
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  if (!isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { employee_id, start_date, end_date, department, report_html } = await req.json() as {
    employee_id?: string
    start_date?: string
    end_date?: string
    department?: 'foh' | 'boh'
    report_html?: string
  }

  if (!employee_id || !start_date || !end_date || !department) {
    return NextResponse.json({ error: 'Missing performance report email payload' }, { status: 400 })
  }

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 })
  const emailSettings = await getEmailSettings()
  if (!emailSettings.wage_report_emails_enabled) {
    return NextResponse.json({ success: true, skipped: true, message: 'Report emails are disabled in Email Settings' })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
  const logoUrl = `${appUrl}/new%20logo%20V3.jpg`

  const { data: employee, error: employeeError } = await supabaseAdmin
    .from('employees').select('*').eq('id', employee_id).single()

  if (employeeError || !employee?.email) {
    return NextResponse.json({ error: 'Employee email not available' }, { status: 400 })
  }

  // Fast path: client passed pre-built report HTML — embed it directly
  if (report_html) {
    const subject = `Performance Report — ${getReportLabel(start_date, end_date)}`
    const html = buildEmailDocument(logoUrl, subject, report_html)
    await sendEmail({
      resendKey,
      to: employee.email,
      subject,
      html,
      fromName: emailSettings.from_name,
      fromEmail: emailSettings.from_email,
      replyTo: emailSettings.reply_to,
    })
    return NextResponse.json({ success: true })
  }

  // Fallback: rebuild report server-side (legacy path)
  const [{ data: completions, error: completionError }, { data: clockRecords, error: clockError }, { data: reports, error: reportError }, { data: employees, error: employeesError }] = await Promise.all([
    supabaseAdmin.from('task_completions').select('*').eq('employee_id', employee_id).gte('session_date', start_date).lte('session_date', end_date).order('session_date', { ascending: false }),
    supabaseAdmin.from('shift_clocks').select('*').eq('employee_id', employee_id).gte('session_date', start_date).lte('session_date', end_date),
    supabaseAdmin.from('eod_reports').select('session_date, tip_distributions(*)').gte('session_date', start_date).lte('session_date', end_date),
    supabaseAdmin.from('employees').select('*').eq('is_active', true),
  ])

  if (completionError) return NextResponse.json({ error: completionError.message }, { status: 500 })
  if (clockError) return NextResponse.json({ error: clockError.message }, { status: 500 })
  if (reportError) return NextResponse.json({ error: reportError.message }, { status: 500 })
  if (employeesError) return NextResponse.json({ error: employeesError.message }, { status: 500 })

  const taskCount = (completions ?? []).filter(completion => completion.status !== 'incomplete').length
  const incompleteCount = (completions ?? []).filter(completion => completion.status === 'incomplete').length
  const hours = (clockRecords ?? []).reduce((sum, record) => sum + getEffectiveClockHours(record), 0)
  const tips = (reports ?? []).reduce((sum, report) => {
    const total = (report.tip_distributions ?? [])
      .filter((dist: { employee_id: string }) => dist.employee_id === employee_id)
      .reduce((inner, dist: { net_tip: number }) => inner + Number(dist.net_tip), 0)
    return sum + total
  }, 0)
  const taskRate = hours > 0 ? taskCount / hours : 0
  const tipRate = hours > 0 ? tips / hours : 0

  const filteredEmployees = ((employees ?? []) as Employee[]).filter(candidate => employeeMatchesScheduleDepartment(candidate, department))
  const filteredEmployeeIds = new Set(filteredEmployees.map(candidate => candidate.id))
  const { data: periodCompletions, error: periodCompletionsError } = await supabaseAdmin
    .from('task_completions')
    .select('employee_id, status')
    .gte('session_date', start_date)
    .lte('session_date', end_date)
  if (periodCompletionsError) return NextResponse.json({ error: periodCompletionsError.message }, { status: 500 })
  const periodDepartmentTaskTotal = (periodCompletions ?? [])
    .filter(completion => filteredEmployeeIds.has(completion.employee_id) && completion.status !== 'incomplete')
    .length
  const monthStart = `${start_date.slice(0, 7)}-01`
  const monthEndDate = new Date(`${end_date}T12:00:00`)
  const monthEnd = new Date(monthEndDate.getFullYear(), monthEndDate.getMonth() + 1, 0).toISOString().split('T')[0]

  const [{ data: monthCompletions, error: monthCompletionsError }, { data: monthClockRecords, error: monthClockError }, { data: monthReports, error: monthReportsError }] = await Promise.all([
    supabaseAdmin.from('task_completions').select('*').gte('session_date', monthStart).lte('session_date', monthEnd),
    supabaseAdmin.from('shift_clocks').select('*').gte('session_date', monthStart).lte('session_date', monthEnd),
    supabaseAdmin.from('eod_reports').select('session_date, tip_distributions(*)').gte('session_date', monthStart).lte('session_date', monthEnd),
  ])

  if (monthCompletionsError) return NextResponse.json({ error: monthCompletionsError.message }, { status: 500 })
  if (monthClockError) return NextResponse.json({ error: monthClockError.message }, { status: 500 })
  if (monthReportsError) return NextResponse.json({ error: monthReportsError.message }, { status: 500 })

  const monthHoursByEmp = new Map<string, number>()
  const monthTipsByEmp = new Map<string, number>()

  for (const record of monthClockRecords ?? []) {
    if (!filteredEmployeeIds.has(record.employee_id)) continue
    monthHoursByEmp.set(record.employee_id, (monthHoursByEmp.get(record.employee_id) ?? 0) + getEffectiveClockHours(record))
  }
  for (const report of monthReports ?? []) {
    for (const dist of report.tip_distributions ?? []) {
      if (!filteredEmployeeIds.has(dist.employee_id)) continue
      monthTipsByEmp.set(dist.employee_id, (monthTipsByEmp.get(dist.employee_id) ?? 0) + Number(dist.net_tip))
    }
  }

  const baseStats = filteredEmployees.map(candidate => {
    const tasks = (monthCompletions ?? []).filter(completion => completion.employee_id === candidate.id && completion.status !== 'incomplete').length
    const candidateHours = monthHoursByEmp.get(candidate.id) ?? 0
    const totalTips = monthTipsByEmp.get(candidate.id) ?? 0
    return {
      candidate,
      tasks,
      hours: candidateHours,
      totalTips,
      taskRate: candidateHours > 0 ? tasks / candidateHours : 0,
      tipRate: candidateHours > 0 ? totalTips / candidateHours : 0,
    }
  }).filter(item => item.tasks > 0 || item.hours > 0 || item.totalTips > 0)

  const taskRankMap = getRankMap(baseStats, item => item.tasks, item => item.candidate.id)
  const taskRateRankMap = getRankMap(baseStats.filter(item => item.hours > 0), item => item.taskRate, item => item.candidate.id)
  const tipRateRankMap = getRankMap(baseStats.filter(item => item.hours > 0), item => item.tipRate, item => item.candidate.id)
  const hoursRankMap = getRankMap(baseStats, item => item.hours, item => item.candidate.id)
  const rankedStats = baseStats.map(item => {
    const taskRank = taskRankMap.get(item.candidate.id) ?? 1
    const taskRateRank = taskRateRankMap.get(item.candidate.id) ?? 1
    const tipRateRank = tipRateRankMap.get(item.candidate.id) ?? 1
    const hoursRank = hoursRankMap.get(item.candidate.id) ?? 1
    return {
      ...item,
      taskRank,
      taskRateRank,
      tipRateRank,
      hoursRank,
      score: Math.round(
        scoreFromRank(taskRank, Math.max(taskRankMap.size, 1)) * 0.3 +
        scoreFromRank(taskRateRank, Math.max(taskRateRankMap.size, 1)) * 0.3 +
        scoreFromRank(tipRateRank, Math.max(tipRateRankMap.size, 1)) * 0.25 +
        scoreFromRank(hoursRank, Math.max(hoursRankMap.size, 1)) * 0.15
      ),
    }
  }).sort((a, b) => b.score - a.score || b.tasks - a.tasks)

  const monthly = rankedStats.find(item => item.candidate.id === employee_id)
  const overallRank = rankedStats.findIndex(item => item.candidate.id === employee_id) + 1
  const share = periodDepartmentTaskTotal > 0 ? `${((taskCount / periodDepartmentTaskTotal) * 100).toFixed(1)}%` : '0.0%'

  const html = renderEmailShell(logoUrl, `
    <h2 style="color:#1a1a1a">Performance Report — ${getReportLabel(start_date, end_date)}</h2>
    <p>Hi ${employee.name},</p>
    <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;margin-top:16px">
      <tr><td><strong>Report Range</strong></td><td>${getReportLabel(start_date, end_date)}</td></tr>
      <tr><td><strong>Overall Rank</strong></td><td>${overallRank > 0 ? `#${overallRank} of ${rankedStats.length}` : '—'}</td></tr>
      <tr><td><strong>Performance Score</strong></td><td>${monthly?.score ?? '—'}</td></tr>
      <tr><td><strong>Completed Tasks</strong></td><td>${taskCount}</td></tr>
      <tr><td><strong>Incomplete Marks</strong></td><td>${incompleteCount}</td></tr>
      <tr><td><strong>Hours Worked</strong></td><td>${hours.toFixed(2)} hrs</td></tr>
      <tr><td><strong>Total Tips</strong></td><td>${formatCurrency(tips)}</td></tr>
      <tr><td><strong>Tasks / Hr</strong></td><td>${taskRate.toFixed(2)}</td></tr>
      <tr><td><strong>Tips / Hr</strong></td><td>${formatCurrency(tipRate)}</td></tr>
      <tr><td><strong>Task Share</strong></td><td>${share}</td></tr>
    </table>
    <h3 style="margin:20px 0 8px;color:#1a1a1a">KPI Ranking</h3>
    <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
      <tr><th align="left">KPI</th><th align="right">Value</th><th align="right">Rank</th></tr>
      <tr><td>Monthly Tasks</td><td align="right">${monthly?.tasks ?? 0}</td><td align="right">${monthly ? `#${monthly.taskRank}` : '—'}</td></tr>
      <tr><td>Tasks / Hr</td><td align="right">${monthly ? monthly.taskRate.toFixed(2) : '—'}</td><td align="right">${monthly ? `#${monthly.taskRateRank}` : '—'}</td></tr>
      <tr><td>Tips / Hr</td><td align="right">${monthly ? formatCurrency(monthly.tipRate) : '—'}</td><td align="right">${monthly ? `#${monthly.tipRateRank}` : '—'}</td></tr>
      <tr><td>Hours Worked</td><td align="right">${monthly?.hours.toFixed(2) ?? '0.00'} hrs</td><td align="right">${monthly ? `#${monthly.hoursRank}` : '—'}</td></tr>
    </table>
  `, 560)

  await sendEmail({
    resendKey,
    to: employee.email,
    subject: `Performance Report — ${getReportLabel(start_date, end_date)}`,
    html,
    fromName: emailSettings.from_name,
    fromEmail: emailSettings.from_email,
    replyTo: emailSettings.reply_to,
  })

  return NextResponse.json({ success: true })
}
