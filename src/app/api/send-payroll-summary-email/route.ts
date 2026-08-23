import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { getEmailSettings } from '@/lib/appSettings'
import { escapeHtml, renderEmailShell, sendEmail } from '@/lib/emailUtils'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { PayrollRun, PayrollRunItem } from '@/lib/types'

type PayrollSummaryRun = PayrollRun & { payroll_run_items?: PayrollRunItem[] }

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

    const emailSettings = await getEmailSettings()
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
      <p style="margin:0 0 14px;color:#4b5563">${escapeHtml(periodLabel)} | Pay date ${escapeHtml(run.pay_date)} | Department ${escapeHtml(run.department)}</p>
      <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:14px 0">
        <div style="border:1px solid #d1d5db;border-radius:10px;padding:10px"><div style="font-size:10px;text-transform:uppercase;color:#6b7280">Staff</div><div style="font-size:20px;font-weight:700">${summary.employeeCount}</div></div>
        <div style="border:1px solid #d1d5db;border-radius:10px;padding:10px"><div style="font-size:10px;text-transform:uppercase;color:#6b7280">Hours</div><div style="font-size:20px;font-weight:700">${summary.hours.toFixed(2)}</div></div>
        <div style="border:1px solid #d1d5db;border-radius:10px;padding:10px"><div style="font-size:10px;text-transform:uppercase;color:#6b7280">Tips</div><div style="font-size:20px;font-weight:700">${formatCurrency(summary.tips)}</div></div>
        <div style="border:1px solid #d1d5db;border-radius:10px;padding:10px"><div style="font-size:10px;text-transform:uppercase;color:#6b7280">Base Wages</div><div style="font-size:20px;font-weight:700">${formatCurrency(summary.baseWages)}</div></div>
        <div style="border:1px solid #d1d5db;border-radius:10px;padding:10px"><div style="font-size:10px;text-transform:uppercase;color:#6b7280">Top-Up</div><div style="font-size:20px;font-weight:700">${formatCurrency(summary.topUp)}</div></div>
        <div style="border:1px solid #d1d5db;border-radius:10px;padding:10px"><div style="font-size:10px;text-transform:uppercase;color:#6b7280">Commission</div><div style="font-size:20px;font-weight:700">${formatCurrency(summary.commission)}</div></div>
        <div style="border:1px solid #d1d5db;border-radius:10px;padding:10px"><div style="font-size:10px;text-transform:uppercase;color:#047857">Cash Payout</div><div style="font-size:20px;font-weight:700">${formatCurrency(Number(run.total_cash ?? 0))}</div></div>
        <div style="border:1px solid #d1d5db;border-radius:10px;padding:10px"><div style="font-size:10px;text-transform:uppercase;color:#6b7280">Check Payout</div><div style="font-size:20px;font-weight:700">${formatCurrency(Number(run.total_check ?? 0))}</div></div>
        <div style="border:1px solid #d1d5db;border-radius:10px;padding:10px"><div style="font-size:10px;text-transform:uppercase;color:#1d4ed8">ACH Payout</div><div style="font-size:20px;font-weight:700">${formatCurrency(Number(run.total_ach ?? 0))}</div></div>
        <div style="border:1px solid #d1d5db;border-radius:10px;padding:10px"><div style="font-size:10px;text-transform:uppercase;color:#6b7280">Net Payroll</div><div style="font-size:20px;font-weight:700">${formatCurrency(Number(run.total_net ?? 0))}</div></div>
        <div style="border:1px solid #d1d5db;border-radius:10px;padding:10px"><div style="font-size:10px;text-transform:uppercase;color:#6b7280">Gross</div><div style="font-size:20px;font-weight:700">${formatCurrency(Number(run.total_gross ?? 0))}</div></div>
        <div style="border:1px solid #d1d5db;border-radius:10px;padding:10px"><div style="font-size:10px;text-transform:uppercase;color:#b91c1c">Deductions</div><div style="font-size:20px;font-weight:700">${formatCurrency(Number(run.total_deductions ?? 0))}</div></div>
      </div>
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
      to: emailSettings.eod_report_email,
      subject: `Payroll Worksheet Summary - ${periodLabel}`,
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
