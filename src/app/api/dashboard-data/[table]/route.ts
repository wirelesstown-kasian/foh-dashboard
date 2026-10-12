import { NextRequest, NextResponse } from 'next/server'
import { getDashboardViewer } from '@/lib/routeAuth'
import { getSupabaseAdminKey } from '@/lib/supabaseAdmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getClockWorkDepartment, getEffectiveClockHours } from '@/lib/clockUtils'
import { calculateTips } from '@/lib/tipCalc'
import { isTipEligibleForWork } from '@/lib/tipEligibility'
import type { Employee, ShiftClock } from '@/lib/types'
import {
  businessDateInChicago, canAccessDashboardTable, safeDashboardResponse,
  validStaffQuery, validStaffWritePayload,
} from '@/lib/dashboardDataAccess'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ table: string }> }

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://gnaubgccxjbgxrtmffhp.supabase.co'

async function readExisting(table: string, id: string, key: string) {
  const url = new URL(`/rest/v1/${table}`, supabaseUrl)
  url.searchParams.set('select', key)
  url.searchParams.set('id', `eq.${id}`)
  const secret = getSupabaseAdminKey()
  const response = await fetch(url, {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` },
    cache: 'no-store',
  })
  if (!response.ok) return null
  const rows = await response.json() as Array<Record<string, unknown>>
  return rows[0] ?? null
}

async function readReport(reportId: string) {
  return readExisting('eod_reports', reportId, 'id,session_date,closed_by_employee_id,tip_total')
}

async function validStaffTipPool(rows: Array<Record<string, unknown>>, date: string, tipTotal: number) {
  const ids = rows.map(row => String(row.employee_id))
  if (new Set(ids).size !== ids.length) return false
  const [employeeResult, clockResult] = await Promise.all([
    supabaseAdmin.from('employees').select('id,role,primary_department,schedule_departments,tip_eligible,tip_pool_hourly_rate,is_active').in('id', ids),
    supabaseAdmin.from('shift_clocks').select('*').eq('session_date', date),
  ])
  if (employeeResult.error || clockResult.error) return false
  const employees = new Map((employeeResult.data ?? []).map(employee => [employee.id, employee as Employee]))
  const clocks = (clockResult.data ?? []) as ShiftClock[]
  const entries = []
  for (const row of rows) {
    const employee = employees.get(String(row.employee_id))
    if (!employee?.is_active) return false
    const hours = clocks
      .filter(clock => clock.employee_id === employee.id && isTipEligibleForWork(employee, getClockWorkDepartment(clock, employee)))
      .reduce((sum, clock) => sum + getEffectiveClockHours(clock), 0)
    if (Math.abs(hours - Number(row.hours_worked)) > 0.015) return false
    entries.push({ employee_id: employee.id, hours_worked: hours, tip_pool_hourly_rate: employee.tip_pool_hourly_rate })
  }
  const expected = calculateTips(tipTotal, entries)
  return rows.every(row => {
    const calculated = expected.find(entry => entry.employee_id === row.employee_id)
    return !!calculated
      && Math.abs(calculated.tip_share - Number(row.tip_share)) <= 0.0002
      && Math.abs(calculated.house_deduction - Number(row.house_deduction)) <= 0.02
      && Math.abs(calculated.net_tip - Number(row.net_tip)) <= 0.02
  })
}

function eqFilter(params: URLSearchParams, key: string) {
  const filter = params.get(key)
  return filter?.startsWith('eq.') ? filter.slice(3) : null
}

async function validateStaffWrite(
  table: string,
  method: string,
  params: URLSearchParams,
  body: unknown,
  viewerId: string,
  role: string,
  date: string,
) {
  const viewer = { employeeId: viewerId, role, isManager: false }
  if (method !== 'DELETE' && !validStaffWritePayload(table, method, body, viewer, date)) return false

  if (table === 'daily_sessions') {
    if (method === 'POST') return true
    const id = eqFilter(params, 'id')
    const row = id ? await readExisting('daily_sessions', id, 'id,session_date') : null
    return row?.session_date === date
  }
  if (table === 'eod_reports') {
    if (method === 'POST') return true
    const id = eqFilter(params, 'id')
    const row = id ? await readReport(id) : null
    return row?.session_date === date && row.closed_by_employee_id === viewerId
  }
  if (table === 'tip_distributions') {
    const rows = method === 'POST' ? (Array.isArray(body) ? body : [body]) as Array<Record<string, unknown>> : []
    const reportId = method === 'DELETE'
      ? eqFilter(params, 'eod_report_id')
      : typeof rows[0]?.eod_report_id === 'string' ? rows[0].eod_report_id : null
    if (!reportId || (method === 'POST' && rows.some(row => row.eod_report_id !== reportId))) return false
    const report = await readReport(reportId)
    if (report?.session_date !== date || report.closed_by_employee_id !== viewerId) return false
    if (method === 'POST') return validStaffTipPool(rows, date, Number(report.tip_total ?? 0))
    return true
  }
  return false
}

async function handler(req: NextRequest, context: Context) {
  const { table } = await context.params
  const viewer = await getDashboardViewer()
  if (!viewer) return NextResponse.json({ message: 'Sign in required' }, { status: 401 })
  if (!canAccessDashboardTable(viewer, table, req.method, req.nextUrl.searchParams)) {
    return NextResponse.json({ message: 'Not allowed' }, { status: 403 })
  }
  if (!viewer.isManager && !validStaffQuery(
    table, req.nextUrl.searchParams, req.method, req.headers.get('prefer'),
  )) return NextResponse.json({ message: 'Not allowed' }, { status: 403 })

  const method = req.method
  const date = businessDateInChicago()
  if (!viewer.isManager && table === 'schedule_drafts') {
    const week = eqFilter(req.nextUrl.searchParams, 'week_start')
    if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
      return NextResponse.json({ message: 'Not allowed' }, { status: 403 })
    }
    const publicationUrl = new URL('/rest/v1/schedule_publications', supabaseUrl)
    publicationUrl.searchParams.set('select', 'week_start')
    publicationUrl.searchParams.set('week_start', `eq.${week}`)
    const secret = getSupabaseAdminKey()
    const published = await fetch(publicationUrl, {
      headers: { apikey: secret, Authorization: `Bearer ${secret}` },
      cache: 'no-store',
    })
    if (!published.ok || ((await published.json()) as unknown[]).length === 0) {
      return NextResponse.json({ message: 'Not published' }, { status: 403 })
    }
  }
  let body: unknown
  let rawBody: string | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    rawBody = await req.text()
    if (rawBody.length > 256_000) return NextResponse.json({ message: 'Request too large' }, { status: 413 })
    try {
      body = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 })
    }
    if (!viewer.isManager && !await validateStaffWrite(
      table, method, req.nextUrl.searchParams, body, viewer.employeeId, viewer.role, date,
    )) return NextResponse.json({ message: 'Not allowed' }, { status: 403 })
  }

  const target = new URL(`/rest/v1/${table}${req.nextUrl.search}`, supabaseUrl)
  if (!viewer.isManager && (method === 'GET' || method === 'HEAD')) {
    if (table === 'employees' || table === 'tasks' || table === 'task_categories') {
      target.searchParams.append('is_active', 'eq.true')
    }
    if (table === 'daily_sessions' || table === 'eod_reports') {
      target.searchParams.append('session_date', `eq.${date}`)
    }
    if (table === 'task_completions') {
      const oldest = new Date(`${date}T00:00:00Z`)
      oldest.setUTCDate(oldest.getUTCDate() - 35)
      target.searchParams.append('session_date', `gte.${oldest.toISOString().slice(0, 10)}`)
    }
  }
  const secret = getSupabaseAdminKey()
  const headers = new Headers({ apikey: secret, Authorization: `Bearer ${secret}` })
  for (const key of ['accept', 'content-type', 'prefer', 'range', 'range-unit']) {
    const value = req.headers.get(key)
    if (value) headers.set(key, value)
  }
  const accept = headers.get('accept') ?? 'application/json'
  if (accept === '*/*') headers.set('accept', 'application/json')
  if (accept !== '*/*' && !/^application\/(?:json|vnd\.pgrst\.object\+json)(?:\s*;.*)?$/.test(accept)) {
    return NextResponse.json({ message: 'Unsupported response format' }, { status: 406 })
  }
  const upstream = await fetch(target, { method, headers, body: rawBody, cache: 'no-store' })
  if (method === 'HEAD' || upstream.status === 204) return new NextResponse(null, { status: upstream.status })
  const responseText = await upstream.text()
  if (!upstream.ok) {
    return new NextResponse(responseText, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  }
  if (!responseText) return new NextResponse(null, { status: upstream.status })
  let parsed: unknown
  try {
    parsed = JSON.parse(responseText)
  } catch {
    return NextResponse.json({ message: 'Unexpected database response' }, { status: 502 })
  }
  const safe = safeDashboardResponse(parsed, viewer, table, date)
  const response = NextResponse.json(safe, { status: upstream.status })
  response.headers.set('cache-control', 'no-store')
  return response
}

export const GET = handler
export const HEAD = handler
export const POST = handler
export const PATCH = handler
export const DELETE = handler
