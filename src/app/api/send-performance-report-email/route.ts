import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { renderEmailShell, sendEmail } from '@/lib/emailUtils'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getEmailSettings } from '@/lib/appSettings'
import { getEffectiveClockHours } from '@/lib/clockUtils'

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`
}

function getReportLabel(start: string, end: string) {
  return start === end ? start : `${start} - ${end}`
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  if (!isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { employee_id, start_date, end_date } = await req.json() as {
    employee_id?: string
    start_date?: string
    end_date?: string
  }

  if (!employee_id || !start_date || !end_date) {
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

  const [{ data: employee, error: employeeError }, { data: completions, error: completionError }, { data: tasks, error: taskError }, { data: clockRecords, error: clockError }, { data: reports, error: reportError }] = await Promise.all([
    supabaseAdmin.from('employees').select('*').eq('id', employee_id).single(),
    supabaseAdmin.from('task_completions').select('*').eq('employee_id', employee_id).gte('session_date', start_date).lte('session_date', end_date).order('session_date', { ascending: false }),
    supabaseAdmin.from('tasks').select('id, title').eq('is_active', true),
    supabaseAdmin.from('shift_clocks').select('*').eq('employee_id', employee_id).gte('session_date', start_date).lte('session_date', end_date),
    supabaseAdmin.from('eod_reports').select('session_date, tip_distributions(*)').gte('session_date', start_date).lte('session_date', end_date),
  ])

  if (employeeError || !employee?.email) {
    return NextResponse.json({ error: 'Employee email not available' }, { status: 400 })
  }
  if (completionError) return NextResponse.json({ error: completionError.message }, { status: 500 })
  if (taskError) return NextResponse.json({ error: taskError.message }, { status: 500 })
  if (clockError) return NextResponse.json({ error: clockError.message }, { status: 500 })
  if (reportError) return NextResponse.json({ error: reportError.message }, { status: 500 })

  const taskMap = new Map((tasks ?? []).map(task => [task.id, task.title]))
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

  const html = renderEmailShell(logoUrl, `
    <h2 style="color:#1a1a1a">Performance Report — ${getReportLabel(start_date, end_date)}</h2>
    <p>Hi ${employee.name},</p>
    <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
      <tr><td><strong>Report Range</strong></td><td>${getReportLabel(start_date, end_date)}</td></tr>
      <tr><td><strong>Completed Tasks</strong></td><td>${taskCount}</td></tr>
      <tr><td><strong>Incomplete Marks</strong></td><td>${incompleteCount}</td></tr>
      <tr><td><strong>Hours Worked</strong></td><td>${hours.toFixed(2)} hrs</td></tr>
      <tr><td><strong>Total Tips</strong></td><td>${formatCurrency(tips)}</td></tr>
      <tr><td><strong>Tasks / Hr</strong></td><td>${taskRate.toFixed(2)}</td></tr>
      <tr><td><strong>Tips / Hr</strong></td><td>${formatCurrency(tipRate)}</td></tr>
    </table>
    <h3 style="margin:20px 0 8px;color:#1a1a1a">Task Activity</h3>
    <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
      <tr><th align="left">Date</th><th align="left">Task</th><th align="left">Status</th><th align="left">Completed At</th></tr>
      ${(completions ?? []).map(completion => `
        <tr>
          <td>${completion.session_date}</td>
          <td>${taskMap.get(completion.task_id) ?? 'Task'}</td>
          <td>${completion.status === 'incomplete' ? 'Incomplete' : 'Complete'}</td>
          <td>${completion.completed_at ? new Date(completion.completed_at).toLocaleString('en-US') : '—'}</td>
        </tr>
      `).join('')}
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
