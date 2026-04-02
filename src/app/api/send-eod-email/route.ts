import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const ADMIN_EMAIL = 'admin@newvillagepub.com'

async function sendEmail(resendKey: string, to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'FOH Dashboard <noreply@mail.newvillagepub.com>',
      to: [to],
      subject,
      html,
    }),
  })
  if (!res.ok) throw new Error(await res.text())
}

type TipDist = {
  employee_id: string
  employee?: { id: string; name: string; email: string | null } | null
  start_time: string | null
  end_time: string | null
  hours_worked: number
  tip_share: number
  house_deduction: number
  net_tip: number
}

function formatShiftTime(value: string | null) {
  if (!value) return 'N/A'
  const [hourText = '0', minute = '00'] = value.split(':')
  const hour = Number(hourText)
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const normalizedHour = hour % 12 || 12
  return `${normalizedHour}:${minute} ${suffix}`
}

function getWeekRange(sessionDate: string) {
  const endDate = new Date(sessionDate + 'T12:00:00')
  const startDate = new Date(endDate)
  startDate.setDate(endDate.getDate() - endDate.getDay())
  return {
    weekStart: startDate.toISOString().split('T')[0],
    weekEnd: sessionDate,
  }
}

function getMonthRange(sessionDate: string) {
  const date = new Date(sessionDate + 'T12:00:00')
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1)
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  return {
    monthStart: monthStart.toISOString().split('T')[0],
    monthEnd: monthEnd.toISOString().split('T')[0],
  }
}

function getRank<T>(items: T[], getValue: (item: T) => number, idKey: keyof T, targetId: string) {
  const ranked = [...items].sort((a, b) => getValue(b) - getValue(a))
  const rank = ranked.findIndex(item => String(item[idKey]) === targetId)
  return rank >= 0 ? rank + 1 : null
}

function renderEmailShell(logoUrl: string, content: string, maxWidth = 600) {
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
  const { eod_report_id } = await req.json()
  if (!eod_report_id) return NextResponse.json({ error: 'Missing eod_report_id' }, { status: 400 })

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 })
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
  const logoUrl = `${appUrl}/new%20logo%20V3.jpg`

  const { data: report, error } = await supabase
    .from('eod_reports')
    .select('*, closed_by:employees(*), tip_distributions(*, employee:employees(*))')
    .eq('id', eod_report_id)
    .single()

  if (error || !report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

  const rawTipDists = (report.tip_distributions ?? []) as TipDist[]
  const { data: sessionSchedules } = await supabase
    .from('schedules')
    .select('employee_id, start_time, end_time')
    .eq('date', report.session_date)

  const scheduleByEmployee = new Map(
    ((sessionSchedules ?? []) as Array<{ employee_id: string; start_time: string; end_time: string }>).map(schedule => [
      schedule.employee_id,
      schedule,
    ])
  )

  const tipDists = rawTipDists.map(dist => {
    const schedule = scheduleByEmployee.get(dist.employee_id)
    return {
      ...dist,
      start_time: dist.start_time ?? schedule?.start_time ?? null,
      end_time: dist.end_time ?? schedule?.end_time ?? null,
    }
  })
  const emailPromises: Promise<void>[] = []

  const employeeIds = Array.from(new Set(tipDists.map(dist => dist.employee_id)))
  const { weekStart, weekEnd } = getWeekRange(report.session_date)
  const { monthStart, monthEnd } = getMonthRange(report.session_date)
  const weeklyTotals = new Map<string, { hours: number; netTip: number }>()
  const monthlyTaskTotals = new Map<string, number>()
  const monthlyPerformanceTotals = new Map<string, { tasks: number; hours: number; netTip: number }>()

  if (employeeIds.length > 0) {
    const { data: monthlyTaskCompletions } = await supabase
      .from('task_completions')
      .select('employee_id')
      .gte('session_date', monthStart)
      .lte('session_date', monthEnd)
      .in('employee_id', employeeIds)

    for (const completion of (monthlyTaskCompletions ?? []) as Array<{ employee_id: string }>) {
      monthlyTaskTotals.set(completion.employee_id, (monthlyTaskTotals.get(completion.employee_id) ?? 0) + 1)
    }

    const { data: monthlyReports } = await supabase
      .from('eod_reports')
      .select('id')
      .gte('session_date', monthStart)
      .lte('session_date', monthEnd)

    const monthlyReportIds = (monthlyReports ?? []).map((monthlyReport: { id: string }) => monthlyReport.id)
    if (monthlyReportIds.length > 0) {
      const { data: monthlyTipDistributions } = await supabase
        .from('tip_distributions')
        .select('employee_id, hours_worked, net_tip')
        .in('eod_report_id', monthlyReportIds)
        .in('employee_id', employeeIds)

      for (const distribution of (monthlyTipDistributions ?? []) as Array<{ employee_id: string; hours_worked: number; net_tip: number }>) {
        const current = monthlyPerformanceTotals.get(distribution.employee_id) ?? { tasks: 0, hours: 0, netTip: 0 }
        current.hours += Number(distribution.hours_worked)
        current.netTip += Number(distribution.net_tip)
        monthlyPerformanceTotals.set(distribution.employee_id, current)
      }
    }

    const { data: weeklyReports } = await supabase
      .from('eod_reports')
      .select('id')
      .gte('session_date', weekStart)
      .lte('session_date', weekEnd)

    const weeklyReportIds = (weeklyReports ?? []).map((weeklyReport: { id: string }) => weeklyReport.id)
    if (weeklyReportIds.length > 0) {
      const { data: weeklyTipDistributions } = await supabase
        .from('tip_distributions')
        .select('employee_id, hours_worked, net_tip')
        .in('eod_report_id', weeklyReportIds)
        .in('employee_id', employeeIds)

      for (const distribution of (weeklyTipDistributions ?? []) as Array<{ employee_id: string; hours_worked: number; net_tip: number }>) {
        const current = weeklyTotals.get(distribution.employee_id) ?? { hours: 0, netTip: 0 }
        current.hours += Number(distribution.hours_worked)
        current.netTip += Number(distribution.net_tip)
        weeklyTotals.set(distribution.employee_id, current)
      }
    }
  }

  const monthlyRankings = employeeIds.map(employeeId => {
    const totals = monthlyPerformanceTotals.get(employeeId) ?? { tasks: 0, hours: 0, netTip: 0 }
    const tasks = monthlyTaskTotals.get(employeeId) ?? 0
    return {
      employee_id: employeeId,
      tasks,
      hours: totals.hours,
      netTip: totals.netTip,
      taskRate: totals.hours > 0 ? tasks / totals.hours : 0,
      tipRate: totals.hours > 0 ? totals.netTip / totals.hours : 0,
    }
  })

  // 1. Individual tip emails only to staff who actually received tips
  for (const dist of tipDists) {
    if (!dist.employee?.email || Number(dist.net_tip) <= 0) continue
    const weeklyTotal = weeklyTotals.get(dist.employee_id) ?? { hours: Number(dist.hours_worked), netTip: Number(dist.net_tip) }
    const monthlyTotal = monthlyRankings.find(ranking => ranking.employee_id === dist.employee_id) ?? {
      employee_id: dist.employee_id,
      tasks: 0,
      hours: Number(dist.hours_worked),
      netTip: Number(dist.net_tip),
      taskRate: 0,
      tipRate: Number(dist.hours_worked) > 0 ? Number(dist.net_tip) / Number(dist.hours_worked) : 0,
    }
    const taskRank = getRank(monthlyRankings, item => item.tasks, 'employee_id', dist.employee_id)
    const taskRateRank = getRank(monthlyRankings.filter(item => item.hours > 0), item => item.taskRate, 'employee_id', dist.employee_id)
    const tipRateRank = getRank(monthlyRankings.filter(item => item.hours > 0), item => item.tipRate, 'employee_id', dist.employee_id)
    const html = renderEmailShell(logoUrl, `
        <h2 style="color:#1a1a1a">Your Tip Summary — ${report.session_date}</h2>
        <p>Hi ${dist.employee.name},</p>
        <p>Here is your tip breakdown for <strong>${report.session_date}</strong>:</p>
        <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
          <tr style="background:#f5f5f5"><td><strong>Worked Schedule</strong></td><td>${formatShiftTime(dist.start_time)} - ${formatShiftTime(dist.end_time)}</td></tr>
          <tr><td><strong>Total Hours</strong></td><td>${Number(dist.hours_worked).toFixed(2)} hrs</td></tr>
          <tr style="background:#e8f5e9"><td><strong>Net Tip</strong></td><td><strong>$${Number(dist.net_tip).toFixed(2)}</strong></td></tr>
        </table>
        <p style="margin:18px 0 8px;font-weight:600">This Week So Far</p>
        <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
          <tr style="background:#f5f5f5"><td><strong>Week Range</strong></td><td>${weekStart} - ${weekEnd}</td></tr>
          <tr><td><strong>Total Hours</strong></td><td>${weeklyTotal.hours.toFixed(2)} hrs</td></tr>
          <tr style="background:#eef7ff"><td><strong>Total Tips</strong></td><td><strong>$${weeklyTotal.netTip.toFixed(2)}</strong></td></tr>
        </table>
        <p style="margin:18px 0 8px;font-weight:600">This Month So Far</p>
        <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
          <tr style="background:#f5f5f5"><td><strong>Month Range</strong></td><td>${monthStart} - ${monthEnd}</td></tr>
          <tr><td><strong>Total Tasks</strong></td><td>${monthlyTotal.tasks}</td></tr>
          <tr><td><strong>Total Hours</strong></td><td>${monthlyTotal.hours.toFixed(2)} hrs</td></tr>
          <tr><td><strong>Total Tips</strong></td><td>$${monthlyTotal.netTip.toFixed(2)}</td></tr>
          <tr><td><strong>Task Rank</strong></td><td>${taskRank ? `#${taskRank}` : '—'}</td></tr>
          <tr><td><strong>Tasks / Hr Rank</strong></td><td>${taskRateRank ? `#${taskRateRank}` : '—'}</td></tr>
          <tr style="background:#eef7ff"><td><strong>Tips / Hr Rank</strong></td><td><strong>${tipRateRank ? `#${tipRateRank}` : '—'}</strong></td></tr>
        </table>
        <p style="color:#888;font-size:12px;margin-top:20px">New Village Pub · FOH Dashboard</p>
    `, 480)
    emailPromises.push(
      sendEmail(resendKey, dist.employee.email, `Your Tip — ${report.session_date}`, html)
    )
  }

  // 2. Full revenue and tip settlement report to admin only
  const tipRows = tipDists.map(d =>
    `<tr>
      <td>${d.employee?.name ?? ''}</td>
      <td>${Number(d.hours_worked).toFixed(2)}</td>
      <td>${(Number(d.tip_share) * 100).toFixed(1)}%</td>
      <td>-$${Number(d.house_deduction).toFixed(2)}</td>
      <td><strong>$${Number(d.net_tip).toFixed(2)}</strong></td>
    </tr>`
  ).join('')

  const adminEodHtml = renderEmailShell(logoUrl, `
      <h2 style="color:#1a1a1a">FOH End of Day Report — ${report.session_date}</h2>
      <p><strong>Closed by:</strong> ${(report.closed_by as { name?: string } | null)?.name ?? 'N/A'}</p>
      <h3>Revenue</h3>
      <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%">
        <tr><td>Cash Total</td><td style="text-align:right">$${Number(report.cash_total).toFixed(2)}</td></tr>
        <tr><td>Batch Total</td><td style="text-align:right">$${Number(report.batch_total).toFixed(2)}</td></tr>
        <tr style="background:#f5f5f5"><td><strong>Gross Revenue</strong></td><td style="text-align:right"><strong>$${Number(report.revenue_total).toFixed(2)}</strong></td></tr>
        <tr><td>CC Tips</td><td style="text-align:right">$${Number(report.cc_tip).toFixed(2)}</td></tr>
        <tr><td>Cash Tips</td><td style="text-align:right">$${Number(report.cash_tip).toFixed(2)}</td></tr>
        <tr style="background:#f5f5f5"><td><strong>Tip Total</strong></td><td style="text-align:right"><strong>$${Number(report.tip_total).toFixed(2)}</strong></td></tr>
        <tr><td>Cash Deposit</td><td style="text-align:right">$${Number(report.cash_deposit).toFixed(2)}</td></tr>
      </table>
      ${report.memo ? `<p><strong>Memo:</strong> ${report.memo}</p>` : ''}
      <h3>Tip Distribution</h3>
      <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%">
        <tr style="background:#f5f5f5"><th>Name</th><th>Hours</th><th>Tip Share</th><th>Deduction</th><th>Net Tip</th></tr>
        ${tipRows}
      </table>
      <p style="color:#888;font-size:12px;margin-top:20px">New Village Pub · FOH Dashboard</p>
  `)
  emailPromises.push(
    sendEmail(resendKey, ADMIN_EMAIL, `EOD Report — ${report.session_date}`, adminEodHtml)
  )

  // 3. Sunday weekly summary to admin
  const sessionDay = new Date(report.session_date + 'T12:00:00').getDay() // 0 = Sunday
  if (sessionDay === 0) {
    const sunday = new Date(report.session_date + 'T12:00:00')
    const monday = new Date(sunday)
    monday.setDate(sunday.getDate() - 6)
    const weekStart = monday.toISOString().split('T')[0]
    const weekEnd = report.session_date

    const { data: weekReports } = await supabase
      .from('eod_reports')
      .select('*, tip_distributions(*)')
      .gte('session_date', weekStart)
      .lte('session_date', weekEnd)
      .order('session_date')

    if (weekReports && weekReports.length > 0) {
      // Collect all tip distribution data with employee names
      const allEodIds = weekReports.map((r: { id: string }) => r.id)
      const { data: allDists } = await supabase
        .from('tip_distributions')
        .select('*, employee:employees(id, name)')
        .in('eod_report_id', allEodIds)

      // Aggregate totals
      const totalRevenue = weekReports.reduce((s: number, r: { revenue_total: number }) => s + Number(r.revenue_total), 0)
      const totalTips = weekReports.reduce((s: number, r: { tip_total: number }) => s + Number(r.tip_total), 0)
      const totalCash = weekReports.reduce((s: number, r: { cash_total: number }) => s + Number(r.cash_total), 0)
      const totalBatch = weekReports.reduce((s: number, r: { batch_total: number }) => s + Number(r.batch_total), 0)
      const totalDeposit = weekReports.reduce((s: number, r: { cash_deposit: number }) => s + Number(r.cash_deposit), 0)

      const dailyRows = weekReports.map((r: {
        session_date: string; cash_total: number; batch_total: number
        revenue_total: number; tip_total: number; cash_deposit: number
      }) =>
        `<tr>
          <td>${r.session_date}</td>
          <td style="text-align:right">$${Number(r.cash_total).toFixed(2)}</td>
          <td style="text-align:right">$${Number(r.batch_total).toFixed(2)}</td>
          <td style="text-align:right">$${Number(r.revenue_total).toFixed(2)}</td>
          <td style="text-align:right">$${Number(r.tip_total).toFixed(2)}</td>
          <td style="text-align:right">$${Number(r.cash_deposit).toFixed(2)}</td>
        </tr>`
      ).join('')

      // Sum tips by employee
      type EmpTip = { name: string; hours: number; total: number }
      const empTipMap = new Map<string, EmpTip>()
      for (const d of (allDists ?? []) as Array<{ employee_id: string; employee?: { id: string; name: string } | null; hours_worked: number; net_tip: number }>) {
        const empId = d.employee_id
        const name = d.employee?.name ?? empId
        const existing = empTipMap.get(empId) ?? { name, hours: 0, total: 0 }
        existing.hours += Number(d.hours_worked)
        existing.total += Number(d.net_tip)
        empTipMap.set(empId, existing)
      }

      const empTipRows = Array.from(empTipMap.values())
        .sort((a, b) => b.total - a.total)
        .map(e =>
          `<tr>
            <td>${e.name}</td>
            <td style="text-align:right">${e.hours.toFixed(1)}</td>
            <td style="text-align:right">$${e.total.toFixed(2)}</td>
          </tr>`
        ).join('')

      const weeklyHtml = renderEmailShell(logoUrl, `
          <h2 style="color:#1a1a1a">Weekly Revenue &amp; Tip Summary</h2>
          <p><strong>Week:</strong> ${weekStart} – ${weekEnd}</p>
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
            ${empTipRows}
          </table>
          <p style="color:#888;font-size:12px;margin-top:20px">New Village Pub · FOH Dashboard</p>
      `, 640)

      emailPromises.push(
        sendEmail(resendKey, ADMIN_EMAIL, `Weekly Summary — ${weekStart} to ${weekEnd}`, weeklyHtml)
      )
    }
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
