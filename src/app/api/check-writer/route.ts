import { NextRequest, NextResponse } from 'next/server'
import { checkActions, type CheckAction, type CheckEntry } from '@/lib/checkWriter'
import { getPayrollPaymentBreakdown } from '@/lib/payroll'
import { getAppSettings } from '@/lib/appSettings'
import { verifyPin } from '@/lib/pin'
import { getDashboardViewer } from '@/lib/routeAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { PayrollRunItem } from '@/lib/types'
import { isValidPin } from '@/lib/validation'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const runColumns = 'id, department, start_date, end_date, pay_date'
const responseHeaders = { 'Cache-Control': 'private, no-store' }

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: responseHeaders })
}

async function listRows(table: string, columns: string, sort: string, ascending = true) {
  const pageSize = 500
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin.from(table).select(columns)
      .order(sort, { ascending }).order('id').range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...data)
    if (data.length < pageSize) return rows
  }
}

export async function GET(req: NextRequest) {
  if (!(await getDashboardViewer())?.isManager) return failure('Manager access required.', 403)

  try {
    const historyId = req.nextUrl.searchParams.get('history')
    const historyType = req.nextUrl.searchParams.get('type')
    if (historyId !== null) {
      if (!uuid.test(historyId)) return failure('Invalid history record.', 400)
      const column = historyType === 'vendor' ? 'vendor_id' : 'entry_id'
      const { data, error } = await supabaseAdmin.from('check_writer_audit')
        .select('id, occurred_at, actor_name, action, reason, before_record, after_record')
        .eq(column, historyId).order('id', { ascending: false })
      if (error) throw error
      return NextResponse.json({ history: data }, { headers: responseHeaders })
    }

    const runId = req.nextUrl.searchParams.get('run')
    if (runId !== null) {
      if (!uuid.test(runId)) return failure('Invalid payroll run.', 400)
      const { data: run, error } = await supabaseAdmin.from('payroll_runs')
        .select(`${runColumns}, payroll_run_items(id, employee_name, payment_method, commission_payment_method, payment_allocations, commission, net_pay)`)
        .eq('id', runId).maybeSingle()
      if (error) throw error
      if (!run) return failure('Payroll run was not found.', 404)

      const { payroll_run_items: items, ...details } = run
      const checkItems = (items as Pick<PayrollRunItem, 'id' | 'employee_name' | 'payment_method' | 'commission_payment_method' | 'payment_allocations' | 'commission' | 'net_pay'>[])
        .map(item => ({ id: item.id, employee_name: item.employee_name, allocated: getPayrollPaymentBreakdown(item).check }))
      return NextResponse.json({ run: details, items: checkItems }, { headers: responseHeaders })
    }

    const [entries, vendors, employees, runs, settings, categories] = await Promise.all([
      listRows('check_writer_entries', '*', 'payment_date', false),
      listRows('check_writer_vendors', 'id, name, category, address, phone, archived_at', 'name'),
      listRows('employees', 'id, name, is_active', 'name'),
      listRows('payroll_runs', runColumns, 'pay_date', false),
      getAppSettings(),
      listRows('check_writer_categories', '*', 'name'),
    ])
    return NextResponse.json({ entries: entries as unknown as CheckEntry[], vendors, employees, runs, categories, company: { name: settings.from_name, email: 'admin@newvillagepub.com' } }, { headers: responseHeaders })
  } catch (error) {
    console.error('Check Writer read failed', error)
    return failure('Could not load Check Writer. Try again or contact an administrator.', 500)
  }
}

export async function POST(req: NextRequest) {
  const viewer = await getDashboardViewer()
  if (!viewer?.isManager) return failure('Manager access required.', 403)
  if (req.headers.get('sec-fetch-site') === 'cross-site' ||
    !req.headers.get('content-type')?.startsWith('application/json')) return failure('Invalid request.', 400)

  const body = await req.json().catch(() => null)
  const { action, pin, data } = body ?? {}
  if (!checkActions.has(action as CheckAction) || !data || typeof data !== 'object' || Array.isArray(data)) {
    return failure('Choose a valid check action.', 400)
  }
  let actorId = viewer.employeeId
  try {
    {
      if (!isValidPin(pin)) return failure('Enter a four-digit manager PIN.', 400)
      const attempt = await supabaseAdmin.rpc('check_writer_allow_pin', { p_employee_id: viewer.employeeId })
      if (attempt.error) throw attempt.error
      if (!attempt.data) return failure('Too many PIN attempts. Wait a minute and try again.', 429)

      const { data: managers, error: managerError } = await supabaseAdmin.from('employees')
        .select('id, pin_code, pin_hash').eq('role', 'manager').eq('is_active', true)
      if (managerError) throw managerError
      let manager = managers.find(employee => employee.pin_code === pin)
      if (!manager) {
        for (const employee of managers) {
          if (employee.pin_hash && await verifyPin(pin, employee.pin_hash)) {
            manager = employee
            break
          }
        }
      }
      if (!manager) return failure('Manager PIN was incorrect.', 401)
      actorId = manager.id
    }
    const { data: saved, error } = await supabaseAdmin.rpc('check_writer_change', {
      p_action: action, p_actor: actorId, p_data: data,
    })
    if (!error) return NextResponse.json({ saved }, { headers: responseHeaders })
    if (error.code === 'P0001') return failure(error.message, 409)
    if (error.code === '23505') {
      const message = error.message.includes('category_name') ? 'A category already uses that name.' : error.message.includes('active_vendor')
        ? 'An active vendor already uses that name.'
        : 'That check number is already in use for this bank account.'
      return failure(message, 409)
    }
    if (/^22|^2350[24]/.test(error.code ?? '')) return failure('Check the entered values and try again.', 400)
    throw error
  } catch (error) {
    console.error('Check Writer update failed', error)
    return failure('Could not save the check action. Refresh the register to verify its status.', 500)
  }
}
