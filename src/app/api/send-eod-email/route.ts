import { NextRequest, NextResponse } from 'next/server'
import { escapeHtml, formatTime, renderEmailShell, sendEmail } from '@/lib/emailUtils'
import { getEmailSettings } from '@/lib/appSettings'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

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
  return formatTime(value)
}

function getWeekRange(sessionDate: string) {
  const endDate = new Date(sessionDate + 'T12:00:00')
  const startDate = new Date(endDate)
  // Week starts Monday (getDay: 0=Sun, 1=Mon ... 6=Sat)
  const day = startDate.getDay()
  const diff = day === 0 ? -6 : 1 - day
  startDate.setDate(startDate.getDate() + diff)
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

export async function POST(req: NextRequest) {
  try {
    const { eod_report_id } = await req.json()
    if (!eod_report_id) return NextResponse.json({ error: 'Missing eod_report_id' }, { status: 400 })

    const resendKey = process.env.RESEND_API_KEY
    if (!resendKey) return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 })
    const emailSettings = await getEmailSettings()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
    const logoUrl = `${appUrl}/new%20logo%20V3.jpg`

    const { data: report, error } = await supabaseAdmin
      .from('eod_reports')
      .select('*, closed_by:employees(*), tip_distributions(*, employee:employees(*))')
      .eq('id', eod_report_id)
      .single()

    if (error || !report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

    const rawTipDists = (report.tip_distributions ?? []) as TipDist[]
    const { data: sessionSchedules } = await supabaseAdmin
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
        // Worked time: tip_distribution explicit times (what was entered at EOD)
        start_time: dist.start_time ?? null,
        end_time: dist.end_time ?? null,
        // Original scheduled shift from the schedules table; null means they were Off
        scheduled_start: schedule?.start_time ?? null,
        scheduled_end: schedule?.end_time ?? null,
      }
    })
    const emailQueue: (() => Promise<void>)[] = []

    const { data: shiftClocks } = await supabaseAdmin
      .from('shift_clocks')
      .select('employee:employees(name), auto_clock_out, approval_status')
      .eq('session_date', report.session_date)

    const attendanceWarnings = ((shiftClocks ?? []) as Array<{ employee?: { name?: string } | null; auto_clock_out: boolean; approval_status: string }>)
      .filter(clock => clock.auto_clock_out || clock.approval_status === 'pending_review' || clock.approval_status === 'open')
    const attendanceWarningHtml = attendanceWarnings.length > 0
      ? `
      <div style="margin:0 0 18px;padding:14px 16px;border:2px solid #f59e0b;background:#fffbeb;color:#92400e;border-radius:12px">
        <div style="font-size:18px;font-weight:700;margin-bottom:8px">ATTENDANCE WARNING</div>
        <div style="font-size:13px;line-height:1.6">
          ${attendanceWarnings.length} clock record(s) need manager review. Auto clock-out hours are excluded from wage reporting until approved.
        </div>
      </div>
    `
      : ''

    const employeeIds = Array.from(new Set(tipDists.map(dist => dist.employee_id)))
    const { weekStart, weekEnd } = getWeekRange(report.session_date)
    const { monthStart, monthEnd } = getMonthRange(report.session_date)
    const weeklyTotals = new Map<string, { hours: number; netTip: number }>()
    const monthlyTaskTotals = new Map<string, number>()
    const monthlyPerformanceTotals = new Map<string, { tasks: number; hours: number; netTip: number }>()

    if (employeeIds.length > 0) {
    // Batch all date-range queries in parallel
    const [monthlyTaskRes, monthlyReportsRes, weeklyReportsRes] = await Promise.all([
      supabaseAdmin
        .from('task_completions')
        .select('employee_id, status')
        .gte('session_date', monthStart)
        .lte('session_date', monthEnd)
        .in('employee_id', employeeIds),
      supabaseAdmin
        .from('eod_reports')
        .select('id')
        .gte('session_date', monthStart)
        .lte('session_date', monthEnd),
      supabaseAdmin
        .from('eod_reports')
        .select('id')
        .gte('session_date', weekStart)
        .lte('session_date', weekEnd),
    ])

    for (const completion of (monthlyTaskRes.data ?? []) as Array<{ employee_id: string; status?: 'complete' | 'incomplete' }>) {
      if (completion.status === 'incomplete') continue
      monthlyTaskTotals.set(completion.employee_id, (monthlyTaskTotals.get(completion.employee_id) ?? 0) + 1)
    }

    const monthlyReportIds = (monthlyReportsRes.data ?? []).map((r: { id: string }) => r.id)
    const weeklyReportIds = (weeklyReportsRes.data ?? []).map((r: { id: string }) => r.id)

    // Batch tip distribution queries in parallel
    const [monthlyTipRes, weeklyTipRes] = await Promise.all([
      monthlyReportIds.length > 0
        ? supabaseAdmin
            .from('tip_distributions')
            .select('employee_id, hours_worked, net_tip')
            .in('eod_report_id', monthlyReportIds)
            .in('employee_id', employeeIds)
        : Promise.resolve({ data: [] }),
      weeklyReportIds.length > 0
        ? supabaseAdmin
            .from('tip_distributions')
            .select('employee_id, hours_worked, net_tip')
            .in('eod_report_id', weeklyReportIds)
            .in('employee_id', employeeIds)
        : Promise.resolve({ data: [] }),
    ])

    for (const distribution of (monthlyTipRes.data ?? []) as Array<{ employee_id: string; hours_worked: number; net_tip: number }>) {
      const current = monthlyPerformanceTotals.get(distribution.employee_id) ?? { tasks: 0, hours: 0, netTip: 0 }
      current.hours += Number(distribution.hours_worked)
      current.netTip += Number(distribution.net_tip)
      monthlyPerformanceTotals.set(distribution.employee_id, current)
    }

    for (const distribution of (weeklyTipRes.data ?? []) as Array<{ employee_id: string; hours_worked: number; net_tip: number }>) {
      const current = weeklyTotals.get(distribution.employee_id) ?? { hours: 0, netTip: 0 }
      current.hours += Number(distribution.hours_worked)
      current.netTip += Number(distribution.net_tip)
      weeklyTotals.set(distribution.employee_id, current)
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

    // Escape user-supplied name before embedding in HTML
    const safeName = escapeHtml(dist.employee.name)

    const scheduledShiftText = dist.scheduled_start
      ? `${formatShiftTime(dist.scheduled_start)} – ${formatShiftTime(dist.scheduled_end ?? '')}`
      : 'Off'
    const workedShiftText = dist.start_time
      ? `${formatShiftTime(dist.start_time)} – ${formatShiftTime(dist.end_time ?? '')}`
      : scheduledShiftText  // fallback to scheduled if tip dist had no explicit time

    const html = renderEmailShell(logoUrl, `
        <h2 style="color:#1a1a1a">Your Tip Summary — ${report.session_date}</h2>
        <p>Hi ${safeName},</p>
        <p>Here is your tip breakdown for <strong>${report.session_date}</strong>:</p>
        <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
          <tr><td><strong>Scheduled Shift</strong></td><td>${scheduledShiftText}</td></tr>
          <tr style="background:#f5f5f5"><td><strong>Worked Schedule</strong></td><td>${workedShiftText}</td></tr>
          <tr><td><strong>Total Hours</strong></td><td>${Number(dist.hours_worked).toFixed(2)} hrs</td></tr>
          <tr><td><strong>Tips per Hour</strong></td><td>${Number(dist.hours_worked) > 0 ? `$${(Number(dist.net_tip) / Number(dist.hours_worked)).toFixed(2)}` : '—'}</td></tr>
          <tr style="background:#e8f5e9"><td><strong>Net Tip</strong></td><td><strong>$${Number(dist.net_tip).toFixed(2)}</strong></td></tr>
        </table>
        <p style="margin:18px 0 8px;font-weight:600">This Week So Far</p>
        <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
          <tr style="background:#f5f5f5"><td><strong>Week Range</strong></td><td>${weekStart} – ${weekEnd}</td></tr>
          <tr><td><strong>Total Hours</strong></td><td>${weeklyTotal.hours.toFixed(2)} hrs</td></tr>
          <tr style="background:#eef7ff"><td><strong>Total Tips</strong></td><td><strong>$${weeklyTotal.netTip.toFixed(2)}</strong></td></tr>
        </table>
        <p style="margin:18px 0 8px;font-weight:600">This Month So Far</p>
        <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
          <tr style="background:#f5f5f5"><td><strong>Month Range</strong></td><td>${monthStart} – ${monthEnd}</td></tr>
          <tr><td><strong>Total Tasks</strong></td><td>${monthlyTotal.tasks}</td></tr>
          <tr><td><strong>Total Hours</strong></td><td>${monthlyTotal.hours.toFixed(2)} hrs</td></tr>
          <tr><td><strong>Total Tips</strong></td><td>$${monthlyTotal.netTip.toFixed(2)}</td></tr>
          <tr><td><strong>Task Rank</strong></td><td>${taskRank ? `#${taskRank}` : '—'}</td></tr>
          <tr><td><strong>Tasks / Hr Rank</strong></td><td>${taskRateRank ? `#${taskRateRank}` : '—'}</td></tr>
          <tr style="background:#eef7ff"><td><strong>Tips / Hr Rank</strong></td><td><strong>${tipRateRank ? `#${tipRateRank}` : '—'}</strong></td></tr>
        </table>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin-top:28px" />
        <p style="color:#6b7280;font-size:12px;margin-top:16px;line-height:1.7">
          Please do not reply to this email. If you have any questions about your tip summary,
          speak with your manager or reach us at
          <a href="mailto:${emailSettings.reply_to}" style="color:#374151">${emailSettings.reply_to}</a>.
        </p>
        <p style="color:#aaa;font-size:11px;margin-top:4px">New Village Pub · FOH Dashboard</p>
    `, 480)
    if (emailSettings.eod_tip_emails_enabled) {
      emailQueue.push(() =>
        sendEmail({
          resendKey,
          to: dist.employee!.email!,
          subject: `Your Tip — ${report.session_date}`,
          html,
          fromName: emailSettings.from_name,
          fromEmail: emailSettings.from_email,
          replyTo: emailSettings.reply_to,
        })
      )
    }
  }

  // 2. Full revenue and tip settlement report to admin only
    const closedByName = escapeHtml((report.closed_by as { name?: string } | null)?.name ?? 'N/A')
    const memoHtml = report.memo
      ? `<p><strong>Memo:</strong> ${escapeHtml(report.memo)}</p>`
      : ''
    const varianceNoteHtml = report.variance_note
      ? `<p><strong>Variance Note:</strong> ${escapeHtml(report.variance_note)}</p>`
      : ''

    const tipRows = tipDists.map(d =>
    `<tr>
      <td>${escapeHtml(d.employee?.name ?? '')}</td>
      <td>${Number(d.hours_worked).toFixed(2)}</td>
      <td>${(Number(d.tip_share) * 100).toFixed(1)}%</td>
      <td>-$${Number(d.house_deduction).toFixed(2)}</td>
      <td><strong>$${Number(d.net_tip).toFixed(2)}</strong></td>
    </tr>`
  ).join('')

    const adminEodHtml = renderEmailShell(logoUrl, `
      ${attendanceWarningHtml}
      <h2 style="color:#1a1a1a">FOH End of Day Report — ${report.session_date}</h2>
      <p><strong>Closed by:</strong> ${closedByName}</p>
      <h3>Revenue</h3>
      <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%">
        <tr><td>Starting Cash</td><td style="text-align:right">$${Number(report.starting_cash ?? 0).toFixed(2)}</td></tr>
        <tr><td>Cash Total</td><td style="text-align:right">$${Number(report.cash_total).toFixed(2)}</td></tr>
        <tr><td>Batch Total</td><td style="text-align:right">$${Number(report.batch_total).toFixed(2)}</td></tr>
        <tr style="background:#f5f5f5"><td><strong>Gross Revenue</strong></td><td style="text-align:right"><strong>$${Number(report.revenue_total).toFixed(2)}</strong></td></tr>
        <tr><td>Sales Tax</td><td style="text-align:right">$${Number(report.sales_tax ?? 0).toFixed(2)}</td></tr>
        <tr><td>Tip Total</td><td style="text-align:right">$${Number(report.tip_total).toFixed(2)}</td></tr>
        <tr style="background:#e8f5e9"><td><strong>Net Revenue</strong></td><td style="text-align:right"><strong>$${(Number(report.revenue_total) - Number(report.sales_tax ?? 0) - Number(report.tip_total)).toFixed(2)}</strong></td></tr>
        <tr><td>CC Tips</td><td style="text-align:right">$${Number(report.cc_tip).toFixed(2)}</td></tr>
        <tr><td>Cash Tips</td><td style="text-align:right">$${Number(report.cash_tip).toFixed(2)}</td></tr>
        <tr><td>Expected Cash</td><td style="text-align:right">$${Number(report.cash_deposit).toFixed(2)}</td></tr>
        <tr><td>Actual Cash on Hand</td><td style="text-align:right">$${Number(report.actual_cash_on_hand ?? 0).toFixed(2)}</td></tr>
        <tr><td>Variance</td><td style="text-align:right">$${Number(report.cash_variance ?? 0).toFixed(2)}</td></tr>
      </table>
      ${varianceNoteHtml}
      ${memoHtml}
      <h3>Tip Distribution</h3>
      <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%">
        <tr style="background:#f5f5f5"><th>Name</th><th>Hours</th><th>Tip Share</th><th>Deduction</th><th>Net Tip</th></tr>
        ${tipRows}
      </table>
      <p style="color:#888;font-size:12px;margin-top:20px">New Village Pub · FOH Dashboard</p>
  `)
    if (emailSettings.eod_admin_summary_enabled) {
    emailQueue.push(() =>
      sendEmail({
        resendKey,
        to: emailSettings.eod_report_email,
        subject: `EOD Report — ${report.session_date}`,
        html: adminEodHtml,
        fromName: emailSettings.from_name,
        fromEmail: emailSettings.from_email,
        replyTo: emailSettings.reply_to,
      })
    )
  }

    // Send sequentially to avoid Resend rate limits (queue holds fns, not started promises)
    let sent = 0
    const errors: string[] = []
    for (const send of emailQueue) {
      try {
        await send()
        sent++
        if (sent < emailQueue.length) {
          await new Promise(resolve => setTimeout(resolve, 350))
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : 'Unknown error')
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({ success: false, errors, sent }, { status: 207 })
    }

    return NextResponse.json({ success: true, sent })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send EOD emails' },
      { status: 500 }
    )
  }
}
