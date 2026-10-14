import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { buildEmailDocument, sendEmail } from '@/lib/emailUtils'
import { ADMIN_SESSION_COOKIE, hasManagerAccess } from '@/lib/adminSession'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getEmailSettings } from '@/lib/appSettings'
import { buildPerformanceRows, buildPerformanceReportHtml } from '@/lib/performanceReporting'
import { getEmployeeScheduleDepartments } from '@/lib/employeeSelect'
import type { Employee, EodReport, Schedule, ShiftClock, TaskCompletion } from '@/lib/types'

function getReportLabel(start: string, end: string) {
  return start === end ? start : `${start} - ${end}`
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  if (!await hasManagerAccess(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { employee_id, start_date, end_date, department, report_html } = await req.json() as {
    employee_id?: string
    start_date?: string
    end_date?: string
    department?: string
    report_html?: string
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

  // Rebuild with the same monthly performance calculation as the page.
  const monthStart = `${start_date.slice(0, 7)}-01`
  const monthEndDate = new Date(`${end_date}T12:00:00`)
  const monthEnd = new Date(monthEndDate.getFullYear(), monthEndDate.getMonth() + 1, 0).toISOString().split('T')[0]
  const [completionsRes, clocksRes, reportsRes, employeesRes, schedulesRes] = await Promise.all([
    supabaseAdmin.from('task_completions').select('*').gte('session_date', monthStart).lte('session_date', monthEnd),
    supabaseAdmin.from('shift_clocks').select('*').gte('session_date', monthStart).lte('session_date', monthEnd),
    supabaseAdmin.from('eod_reports').select('*, tip_distributions(*)').gte('session_date', monthStart).lte('session_date', monthEnd),
    supabaseAdmin.from('employees').select('*'),
    supabaseAdmin.from('schedules').select('employee_id, date, department').gte('date', monthStart).lte('date', monthEnd),
  ])
  for (const result of [completionsRes, clocksRes, reportsRes, employeesRes, schedulesRes]) {
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
  }
  const allEmployees = (employeesRes.data ?? []) as Employee[]
  const filteredEmployees = allEmployees.filter(candidate => (
    !department || department === 'all' || getEmployeeScheduleDepartments(candidate).includes(department)
  ))
  const stats = buildPerformanceRows({
    employees: filteredEmployees,
    tipEmployees: allEmployees,
    schedules: (schedulesRes.data ?? []) as Schedule[],
    completions: (completionsRes.data ?? []) as TaskCompletion[],
    eodReports: (reportsRes.data ?? []) as EodReport[],
    clockRecords: (clocksRes.data ?? []) as ShiftClock[],
    startDate: start_date, endDate: end_date, monthStart, monthEnd,
  })
  const reportHtml = buildPerformanceReportHtml({
    ...stats, employeeId: employee_id, startDate: start_date, endDate: end_date,
    departmentLabel: department && department !== 'all' ? department : 'All Staff',
  })
  if (!reportHtml) return NextResponse.json({ error: 'Employee is not in the selected department' }, { status: 400 })
  const html = buildEmailDocument(logoUrl, `Performance Report — ${getReportLabel(start_date, end_date)}`, reportHtml)

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
