import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { getAppSettings } from '@/lib/appSettings'
import { escapeHtml, renderEmailShell, sendEmail } from '@/lib/emailUtils'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { PayrollRun, PayrollRunItem } from '@/lib/types'

type PayrollSummaryRun = PayrollRun & { payroll_run_items?: PayrollRunItem[] }

const PAYROLL_SUMMARY_ADMIN_EMAIL = 'admin@newvillagepub.com'

function formatCurrency(value: number) {
  return `$${Number(value ?? 0).toFixed(2)}`
}

function formatPaymentMethod(value: string | null | undefined) {
  if (value === 'ach') return 'ACH'
  if (value === 'check') return 'Check'
  if (value === 'cash') return 'Cash'
  return 'Unknown'
}

function formatStatus(item: PayrollRunItem) {
  if (item.has_open_clock) return 'Clock Review'
  if (item.has_auto_clock_out) return 'Auto Clock-Out'
  return 'Verified'
}

function buildItemSummary(items: PayrollRunItem[]) {
  const hours = items.reduce((sum, item) => sum + Number(item.hours ?? 0), 0)
  const tips = items.reduce((sum, item) => sum + Number(item.tips ?? 0), 0)
  const baseWages = items.reduce((sum, item) => sum + Number(item.base_wages ?? 0), 0)
  const topUp = items.reduce((sum, item) => sum + Number(item.guarantee_top_up ?? 0), 0)
  const commission = items.reduce((sum, item) => sum + Number(item.commission ?? 0), 0)
  const employeeCount = items.filter(item => Number(item.hours ?? 0) > 0 || Number(item.payout_amount ?? 0) > 0).length
  return { hours, tips, baseWages, topUp, commission, employeeCount }
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  if (!isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { run_id } = await req.json() as { run_id?: string }
    if (!run_id) return NextResponse.json({ error: 'Missing run_id' }, { status: 400 })

    const resendKey = process.env.RESEND_API_KEY
    if (!resendKey) return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 })

    const appSettings = await getAppSettings()
    const emailSettings = appSettings
    if (!emailSettings.wage_report_emails_enabled) {
      return NextResponse.json({ success: true, skipped: true, reason: 'Wage report emails are disabled in Email Settings' })
    }

    const { data, error } = await supabaseAdmin
      .from('payroll_runs')
      .select('*, payroll_run_items(*)')
      .eq('id', run_id)
      .single()

    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Payroll run not found' }, { status: 404 })
    }

    const run = data as PayrollSummaryRun
    const items = [...(run.payroll_run_items ?? [])].sort((left, right) => left.display_order - right.display_order || left.employee_name.localeCompare(right.employee_name))
    if (items.length === 0) {
      return NextResponse.json({ success: true, skipped: true, reason: 'Payroll run has no items.' })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
    const logoUrl = `${appUrl}/new%20logo%20V3.jpg`
    const periodLabel = `${run.start_date} to ${run.end_date}`
    const departmentLabel = appSettings.primary_department_definitions.find(department => department.key === run.department)?.label ?? (run.department === 'all' ? 'All' : run.department)
    const summary = buildItemSummary(items)
    const rowHtml = items.map(item => `
      <tr>
        <td>${escapeHtml(item.employee_name)}</td>
        <td>${escapeHtml(item.department)}</td>
        <td>${formatPaymentMethod(item.payment_method)}</td>
        <td class="right">${Number(item.hours ?? 0).toFixed(2)}</td>
        <td class="right">${formatCurrency(Number(item.tips ?? 0))}</td>
        <td class="right">${formatCurrency(Number(item.base_wages ?? 0))}</td>
        <td class="right">${formatCurrency(Number(item.guarantee_top_up ?? 0))}</td>
        <td class="right">${formatCurrency(Number(item.commission ?? 0))}</td>
        <td class="right">${formatCurrency(Number(item.deductions ?? 0))}</td>
        <td class="right"><strong>${formatCurrency(Number(item.payout_amount ?? 0))}</strong></td>
        <td>${formatStatus(item)}</td>
        <td>${item.memo ? escapeHtml(item.memo) : ''}</td>
      </tr>
    `).join('')

    const html = renderEmailShell(logoUrl, `
      <h2 style="color:#111827;margin:0 0 6px">Payroll Worksheet Summary</h2>
      <p style="margin:0 0 14px;color:#4b5563">Department: ${escapeHtml(departmentLabel)} | ${escapeHtml(periodLabel)} | Pay date ${escapeHtml(run.pay_date)}</p>
      <table cellpadding="6" style="border-collapse:collapse;width:100%;font-size:12px;margin:12px 0 14px">
        <tbody>
          <tr style="background:#f9fafb">
            <td style="border:1px solid #d1d5db;color:#6b7280">Staff</td><td style="border:1px solid #d1d5db;font-weight:700">${summary.employeeCount}</td>
            <td style="border:1px solid #d1d5db;color:#6b7280">Hours</td><td style="border:1px solid #d1d5db;font-weight:700">${summary.hours.toFixed(2)}</td>
            <td style="border:1px solid #d1d5db;color:#6b7280">Tips</td><td style="border:1px solid #d1d5db;font-weight:700">${formatCurrency(summary.tips)}</td>
          </tr>
          <tr>
            <td style="border:1px solid #d1d5db;color:#6b7280">Cash</td><td style="border:1px solid #d1d5db;font-weight:700;color:#047857">${formatCurrency(Number(run.total_cash ?? 0))}</td>
            <td style="border:1px solid #d1d5db;color:#6b7280">Check</td><td style="border:1px solid #d1d5db;font-weight:700">${formatCurrency(Number(run.total_check ?? 0))}</td>
            <td style="border:1px solid #d1d5db;color:#6b7280">ACH</td><td style="border:1px solid #d1d5db;font-weight:700;color:#1d4ed8">${formatCurrency(Number(run.total_ach ?? 0))}</td>
          </tr>
          <tr style="background:#f9fafb">
            <td style="border:1px solid #d1d5db;color:#6b7280">Base</td><td style="border:1px solid #d1d5db;font-weight:700">${formatCurrency(summary.baseWages)}</td>
            <td style="border:1px solid #d1d5db;color:#6b7280">Top-Up</td><td style="border:1px solid #d1d5db;font-weight:700">${formatCurrency(summary.topUp)}</td>
            <td style="border:1px solid #d1d5db;color:#6b7280">Commission</td><td style="border:1px solid #d1d5db;font-weight:700">${formatCurrency(summary.commission)}</td>
          </tr>
          <tr>
            <td style="border:1px solid #d1d5db;color:#6b7280">Gross</td><td style="border:1px solid #d1d5db;font-weight:700">${formatCurrency(Number(run.total_gross ?? 0))}</td>
            <td style="border:1px solid #d1d5db;color:#b91c1c">Deductions</td><td style="border:1px solid #d1d5db;font-weight:700;color:#b91c1c">${formatCurrency(Number(run.total_deductions ?? 0))}</td>
            <td style="border:1px solid #d1d5db;color:#111827">Net Payroll</td><td style="border:1px solid #d1d5db;font-weight:800;color:#111827">${formatCurrency(Number(run.total_net ?? 0))}</td>
          </tr>
        </tbody>
      </table>
      ${run.memo ? `<p style="margin:0 0 12px"><strong>Memo:</strong> ${escapeHtml(run.memo)}</p>` : ''}
      <table border="1" cellpadding="7" style="border-collapse:collapse;width:100%;font-size:11px">
        <thead>
          <tr style="background:#f3f4f6">
            <th align="left">Employee</th>
            <th align="left">Department</th>
            <th align="left">Paid By</th>
            <th align="right">Hours</th>
            <th align="right">Tips</th>
            <th align="right">Base</th>
            <th align="right">Top-Up</th>
            <th align="right">Commission</th>
            <th align="right">Deductions</th>
            <th align="right">Payout</th>
            <th align="left">Status</th>
            <th align="left">Memo</th>
          </tr>
        </thead>
        <tbody>${rowHtml}</tbody>
      </table>
    `, 900)

    await sendEmail({
      resendKey,
      to: PAYROLL_SUMMARY_ADMIN_EMAIL,
      subject: `Payroll Worksheet Summary - ${departmentLabel} - ${periodLabel}`,
      html,
      fromName: emailSettings.from_name,
      fromEmail: emailSettings.from_email,
      replyTo: emailSettings.reply_to,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send payroll summary email' },
      { status: 500 }
    )
  }
}
