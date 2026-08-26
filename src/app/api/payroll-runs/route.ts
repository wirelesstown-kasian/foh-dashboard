import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { PaymentMethod } from '@/lib/types'

type PayrollRunPayload = {
  run_id?: string
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
    id?: string
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

export async function GET() {
  const cookieStore = await cookies()
  if (!isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('payroll_runs')
    .select('*, payroll_run_items(*)')
    .order('pay_date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ payroll_runs: data ?? [] })
}

function getPayrollTotals(rows: NonNullable<PayrollRunPayload['rows']>) {
  return rows.reduce<{ cash: number; check: number; ach: number; gross: number; deductions: number; net: number }>((totals, row) => {
    const payout = normalizeNumber(row.payout_amount)
    if (row.payment_method === 'cash') totals.cash += payout
    if (row.payment_method === 'check') totals.check += payout
    if (row.payment_method === 'ach') totals.ach += payout
    totals.gross += normalizeNumber(row.gross_pay)
    totals.deductions += normalizeNumber(row.deductions)
    totals.net += normalizeNumber(row.net_pay)
    return totals
  }, { cash: 0, check: 0, ach: 0, gross: 0, deductions: 0, net: 0 })
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

    const existingRunResult = await supabaseAdmin
      .from('payroll_runs')
      .select('id, department, payroll_run_items(employee_id, employee_name)')
      .eq('start_date', payload.start_date)
      .eq('end_date', payload.end_date)

    if (existingRunResult.error) {
      return NextResponse.json({ error: existingRunResult.error.message }, { status: 500 })
    }

    const relatedExistingRuns = (existingRunResult.data ?? []).filter(run =>
      run.department === payload.department ||
      run.department === 'all' ||
      payload.department === 'all'
    )
    const requestedEmployeeIds = new Set(rows.map(row => row.employee_id).filter(Boolean))
    const duplicateEmployee = relatedExistingRuns
      .flatMap(run => run.payroll_run_items ?? [])
      .find(item => item.employee_id && requestedEmployeeIds.has(item.employee_id))
    if (duplicateEmployee) {
      return NextResponse.json(
        { error: `${duplicateEmployee.employee_name || 'An employee'} is already paid for this period. Open Payroll Payouts to edit the saved payout or create a worksheet for unpaid staff only.` },
        { status: 409 }
      )
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

export async function PATCH(req: NextRequest) {
  const cookieStore = await cookies()
  if (!isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const payload = await req.json() as PayrollRunPayload
    const rows = payload.rows ?? []

    if (!payload.run_id) return NextResponse.json({ error: 'Missing payroll run id' }, { status: 400 })
    if (rows.length === 0) return NextResponse.json({ error: 'Payroll summary has no rows to update' }, { status: 400 })
    const missingPaymentRow = rows.find(row => !isPaymentMethod(row.payment_method))
    if (missingPaymentRow) {
      return NextResponse.json({ error: `Select a payment method for ${missingPaymentRow.employee_name || 'every employee'} before saving.` }, { status: 400 })
    }

    const { data: existingRun, error: existingRunError } = await supabaseAdmin
      .from('payroll_runs')
      .select('*')
      .eq('id', payload.run_id)
      .single()

    if (existingRunError || !existingRun) {
      return NextResponse.json({ error: existingRunError?.message ?? 'Payroll run not found' }, { status: 404 })
    }

    const totals = getPayrollTotals(rows)
    const updateRun = await supabaseAdmin
      .from('payroll_runs')
      .update({
        memo: payload.memo?.trim() || null,
        total_cash: totals.cash,
        total_check: totals.check,
        total_ach: totals.ach,
        total_gross: totals.gross,
        total_deductions: totals.deductions,
        total_net: totals.net,
        updated_at: new Date().toISOString(),
      })
      .eq('id', payload.run_id)

    if (updateRun.error) return NextResponse.json({ error: updateRun.error.message }, { status: 500 })

    for (const [index, row] of rows.entries()) {
      if (!row.id) return NextResponse.json({ error: `Missing payroll item id for ${row.employee_name || 'employee row'}` }, { status: 400 })
      const updateItem = await supabaseAdmin
        .from('payroll_run_items')
        .update({
          payment_method: row.payment_method,
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
          memo: row.memo?.trim() || null,
          display_order: index,
        })
        .eq('id', row.id)
        .eq('run_id', payload.run_id)

      if (updateItem.error) return NextResponse.json({ error: updateItem.error.message }, { status: 500 })
    }

    let cashEntryId: string | null = null
    const oldCash = normalizeNumber((existingRun as { total_cash?: number | string | null }).total_cash)
    const cashDifference = Math.round((totals.cash - oldCash) * 100) / 100
    if (cashDifference !== 0) {
      const entryType = cashDifference > 0 ? 'cash_out' : 'cash_in'
      const amount = Math.abs(cashDifference)
      const description = [
        'Wage Worksheet cash payout adjustment',
        `${existingRun.start_date} to ${existingRun.end_date}`,
        `Pay date ${existingRun.pay_date}`,
        `Run ${payload.run_id}`,
        'Modified after payout',
        `Cash ${cashDifference > 0 ? 'increased' : 'decreased'} by $${amount.toFixed(2)}`,
      ].join(' | ')
      const { data: cashEntry, error: cashError } = await supabaseAdmin
        .from('cash_balance_entries')
        .insert({
          entry_date: existingRun.pay_date,
          entry_type: entryType,
          amount,
          description,
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (cashError) return NextResponse.json({ error: cashError.message }, { status: 500 })
      cashEntryId = cashEntry?.id ?? null
    }

    return NextResponse.json({ run_id: payload.run_id, cash_entry_id: cashEntryId })
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to update payroll payout') },
      { status: 500 }
    )
  }
}
