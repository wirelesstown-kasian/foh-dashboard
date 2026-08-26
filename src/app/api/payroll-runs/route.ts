import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { PaymentMethod } from '@/lib/types'

type PayrollRunPayload = {
  department?: string
  start_date?: string
  end_date?: string
  pay_date?: string
  memo?: string | null
  totals?: {
    cash?: number
    check?: number
    ach?: number
    gross?: number
    deductions?: number
    net?: number
  }
  rows?: Array<{
    employee_id?: string | null
    employee_name?: string
    role?: string | null
    department?: string
    payment_method?: PaymentMethod | ''
    hours?: number
    tips?: number
    base_wages?: number
    guarantee_top_up?: number
    commission?: number
    deductions?: number
    gross_pay?: number
    net_pay?: number
    payout_amount?: number
    cash_rounding?: number
    has_auto_clock_out?: boolean
    has_open_clock?: boolean
    memo?: string | null
  }>
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return fallback
}

function normalizeNumber(value: unknown) {
  const numberValue = Number(value ?? 0)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function isPaymentMethod(value: unknown): value is PaymentMethod {
  return value === 'cash' || value === 'check' || value === 'ach'
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  if (!isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const payload = await req.json() as PayrollRunPayload
    const rows = payload.rows ?? []

    if (!payload.department || !payload.start_date || !payload.end_date || !payload.pay_date) {
      return NextResponse.json({ error: 'Missing payroll period information' }, { status: 400 })
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Payroll worksheet has no rows to save' }, { status: 400 })
    }
    const missingPaymentRow = rows.find(row => !isPaymentMethod(row.payment_method))
    if (missingPaymentRow) {
      return NextResponse.json({ error: `Select a payment method for ${missingPaymentRow.employee_name || 'every employee'} before saving.` }, { status: 400 })
    }

    const runInsert = await supabaseAdmin
      .from('payroll_runs')
      .insert({
        department: payload.department,
        start_date: payload.start_date,
        end_date: payload.end_date,
        pay_date: payload.pay_date,
        memo: payload.memo?.trim() || null,
        total_cash: normalizeNumber(payload.totals?.cash),
        total_check: normalizeNumber(payload.totals?.check),
        total_ach: normalizeNumber(payload.totals?.ach),
        total_gross: normalizeNumber(payload.totals?.gross),
        total_deductions: normalizeNumber(payload.totals?.deductions),
        total_net: normalizeNumber(payload.totals?.net),
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (runInsert.error || !runInsert.data) {
      return NextResponse.json({ error: runInsert.error?.message ?? 'Failed to create payroll run' }, { status: 500 })
    }

    const runId = runInsert.data.id as string
    const itemInsert = await supabaseAdmin.from('payroll_run_items').insert(rows.map((row, index) => ({
      run_id: runId,
      employee_id: row.employee_id || null,
      employee_name: row.employee_name || 'Unknown employee',
      role: row.role || null,
      department: row.department || payload.department,
      payment_method: row.payment_method as PaymentMethod,
      hours: normalizeNumber(row.hours),
      tips: normalizeNumber(row.tips),
      base_wages: normalizeNumber(row.base_wages),
      guarantee_top_up: normalizeNumber(row.guarantee_top_up),
      commission: normalizeNumber(row.commission),
      deductions: normalizeNumber(row.deductions),
      gross_pay: normalizeNumber(row.gross_pay),
      net_pay: normalizeNumber(row.net_pay),
      payout_amount: normalizeNumber(row.payout_amount),
      cash_rounding: normalizeNumber(row.cash_rounding),
      has_auto_clock_out: row.has_auto_clock_out === true,
      has_open_clock: row.has_open_clock === true,
      memo: row.memo?.trim() || null,
      display_order: index,
    })))

    if (itemInsert.error) {
      await supabaseAdmin.from('payroll_runs').delete().eq('id', runId)
      return NextResponse.json({ error: itemInsert.error.message }, { status: 500 })
    }

    return NextResponse.json({ run_id: runId })
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to save payroll worksheet') },
      { status: 500 }
    )
  }
}
