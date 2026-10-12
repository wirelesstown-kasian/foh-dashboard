import type { DashboardViewer } from '@/lib/routeAuth'

export const DASHBOARD_TABLES = new Set([
  'employees', 'schedules', 'schedule_drafts', 'schedule_draft_weeks',
  'schedule_publications', 'task_categories', 'tasks', 'task_completions',
  'daily_sessions', 'eod_reports', 'tip_distributions', 'cash_balance_entries',
])

const MANAGER_WRITABLE = new Set([
  'schedules', 'schedule_drafts', 'schedule_draft_weeks', 'schedule_publications',
  'task_categories', 'tasks', 'task_completions', 'daily_sessions',
  'eod_reports', 'tip_distributions', 'cash_balance_entries',
])

const STAFF_READABLE = new Set([
  'employees', 'schedules', 'schedule_drafts', 'task_categories', 'tasks',
  'task_completions', 'daily_sessions', 'eod_reports',
])

const CLOSER_ROLES = new Set(['server', 'busser', 'runner', 'manager'])
const STAFF_QUERY_KEYS: Record<string, Set<string>> = {
  employees: new Set(['select', 'id', 'is_active', 'order', 'limit', 'offset']),
  schedules: new Set(['select', 'date', 'department', 'employee_id', 'order', 'limit', 'offset']),
  schedule_drafts: new Set(['select', 'week_start', 'department', 'order']),
  task_categories: new Set(['select', 'is_active', 'order']),
  tasks: new Set(['select', 'is_active', 'category_id', 'order']),
  task_completions: new Set(['select', 'id', 'session_date', 'task_id', 'employee_id', 'order']),
  daily_sessions: new Set(['select', 'id', 'session_date', 'order']),
  eod_reports: new Set(['select', 'id', 'session_date', 'order']),
  tip_distributions: new Set(['select', 'eod_report_id']),
}
const STAFF_ORDER_KEYS: Record<string, Set<string>> = {
  employees: new Set(['name']),
  schedules: new Set(['date', 'department', 'start_time', 'end_time']),
  schedule_drafts: new Set(['display_order']),
  task_categories: new Set(['display_order']),
  tasks: new Set(['display_order']),
  task_completions: new Set(['session_date', 'completed_at']),
  daily_sessions: new Set(['session_date']),
  eod_reports: new Set(['session_date']),
}
const PRIVATE_EMPLOYEE_KEYS = new Set(['pin_code', 'pin_hash', 'login_password_hash'])
const STAFF_PRIVATE_EMPLOYEE_KEYS = new Set([
  'phone', 'email', 'address', 'hourly_wage', 'guaranteed_hourly',
  'commission_enabled', 'commission_note', 'payment_method', 'birth_date',
  'login_enabled', 'source_payload', 'analysis_error',
])

export function businessDateInChicago(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  const date = `${value('year')}-${value('month')}-${value('day')}`
  if (Number(value('hour')) >= 3) return date
  const previous = new Date(`${date}T00:00:00Z`)
  previous.setUTCDate(previous.getUTCDate() - 1)
  return previous.toISOString().slice(0, 10)
}

export function isCloser(viewer: DashboardViewer) {
  return CLOSER_ROLES.has(viewer.role)
}

export function validStaffQuery(table: string, params: URLSearchParams, method: string, prefer: string | null) {
  const allowed = STAFF_QUERY_KEYS[table]
  if (!allowed) return false
  if ([...params.keys()].some(key => !allowed.has(key))) return false
  if ([...new Set(params.keys())].some(key => params.getAll(key).length > 1)) return false
  for (const order of params.getAll('order')) {
    for (const clause of order.split(',')) {
      const field = clause.split('.')[0]?.trim() ?? ''
      if (!STAFF_ORDER_KEYS[table]?.has(field)) return false
    }
  }
  if (prefer?.toLowerCase().includes('resolution=')) return false
  const select = params.get('select') ?? ''
  if (select.includes('!') || select.includes('::')) return false
  if (table === 'employees' && /[():]/.test(select)) return false
  const relationships = [...select.matchAll(/(?:^|[,(])\s*(?:[a-z_]+\s*:\s*)?([a-z_]+)\s*\(/g)].map(match => match[1])
  if (relationships.some(name => !['employees', 'tip_distributions'].includes(name))) return false
  if (method !== 'GET' && method !== 'HEAD' && params.has('select') && select !== '*') return false
  return true
}

export function canAccessDashboardTable(
  viewer: DashboardViewer,
  table: string,
  method: string,
  params: URLSearchParams,
) {
  if (!DASHBOARD_TABLES.has(table)) return false
  if (viewer.isManager) return method === 'GET' || method === 'HEAD' || MANAGER_WRITABLE.has(table)
  if (method === 'GET' || method === 'HEAD') {
    if (!STAFF_READABLE.has(table)) return false
    if (table === 'eod_reports' && !isCloser(viewer)) return false
    if (table === 'schedule_drafts') {
      return params.get('select') === 'employee_id,display_order'
    }
    return true
  }
  if (!isCloser(viewer)) return false
  if (table === 'daily_sessions') return method === 'POST' || method === 'PATCH'
  if (table === 'eod_reports') return method === 'POST' || method === 'PATCH'
  if (table === 'tip_distributions') return method === 'POST' || method === 'DELETE'
  return false
}

export function safeDashboardResponse(value: unknown, viewer: DashboardViewer, table: string, date: string): unknown {
  if (Array.isArray(value)) {
    const rows = !viewer.isManager && table === 'employees'
      ? value.filter(row => !!row && typeof row === 'object' && (row as Record<string, unknown>).is_active !== false)
      : !viewer.isManager && table === 'eod_reports'
        ? value.filter(row => !!row && typeof row === 'object' && (row as Record<string, unknown>).session_date === date)
        : !viewer.isManager && table === 'daily_sessions'
          ? value.filter(row => !!row && typeof row === 'object' && (row as Record<string, unknown>).session_date === date)
          : value
    return rows.map(row => safeDashboardResponse(row, viewer, table, date))
  }
  if (!value || typeof value !== 'object') return value
  const row = value as Record<string, unknown>
  if (!viewer.isManager && (table === 'eod_reports' || table === 'daily_sessions') && row.session_date !== date) return null
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(row)) {
    if (PRIVATE_EMPLOYEE_KEYS.has(key)) continue
    if (!viewer.isManager && STAFF_PRIVATE_EMPLOYEE_KEYS.has(key)) continue
    result[key] = safeDashboardResponse(item, viewer, key === 'employee' || key === 'employees' ? 'employees' : key, date)
  }
  return result
}

export function validStaffWritePayload(table: string, method: string, payload: unknown, viewer: DashboardViewer, date: string) {
  const rows = Array.isArray(payload) ? payload : [payload]
  if (rows.length === 0 || rows.length > 100 || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) return false
  return rows.every(row => {
    const value = row as Record<string, unknown>
    if (table === 'daily_sessions') {
      const allowed = new Set(['session_date', 'starting_cash', 'register_opened_by', 'current_phase'])
      return Object.keys(value).every(key => allowed.has(key))
        && (method !== 'POST' || value.session_date === date)
        && (value.session_date === undefined || value.session_date === date)
        && (value.register_opened_by === undefined || value.register_opened_by === viewer.employeeId)
        && (value.starting_cash === undefined || (typeof value.starting_cash === 'number'
          && Number.isFinite(value.starting_cash) && value.starting_cash >= 0 && value.starting_cash <= 100_000))
        && (value.current_phase === undefined || ['register_open', 'pre_shift', 'operation', 'closing', 'complete'].includes(String(value.current_phase)))
        && ((value.starting_cash === undefined && value.register_opened_by === undefined)
          || viewer.role === 'server')
    }
    if (table === 'eod_reports') {
      const allowed = new Set([
        'session_date', 'closed_by_employee_id', 'starting_cash', 'cash_total',
        'batch_total', 'revenue_total', 'cc_tip', 'cash_tip', 'tip_total',
        'cash_deposit', 'sales_tax', 'memo', 'updated_at',
      ])
      return Object.keys(value).every(key => allowed.has(key))
        && (method !== 'POST' || value.session_date === date)
        && (value.session_date === undefined || value.session_date === date)
        && value.closed_by_employee_id === viewer.employeeId
        && ['starting_cash', 'cash_total', 'batch_total', 'revenue_total', 'cc_tip', 'cash_tip', 'tip_total', 'cash_deposit', 'sales_tax']
          .every(key => value[key] === undefined || (typeof value[key] === 'number' && Number.isFinite(value[key]) && Math.abs(value[key]) <= 10_000_000))
        && ['cash_total', 'batch_total', 'cc_tip', 'cash_tip', 'tip_total', 'cash_deposit', 'sales_tax']
          .every(key => value[key] === undefined || Number(value[key]) >= 0)
        && (value.tip_total === undefined || value.cc_tip === undefined || value.cash_tip === undefined
          || Math.abs(Number(value.tip_total) - Number(value.cc_tip) - Number(value.cash_tip)) <= 0.03)
        && (value.revenue_total === undefined || value.cash_total === undefined || value.batch_total === undefined
          || Math.abs(Number(value.revenue_total) - Number(value.cash_total) - Number(value.batch_total)) <= 0.03)
        && (value.cash_deposit === undefined || value.cash_total === undefined || value.cash_tip === undefined
          || Math.abs(Number(value.cash_deposit) - Number(value.cash_total) - Number(value.cash_tip)) <= 0.03)
    }
    if (table === 'tip_distributions') {
      const allowed = new Set([
        'eod_report_id', 'employee_id', 'start_time', 'end_time',
        'hours_worked', 'tip_share', 'house_deduction', 'net_tip',
      ])
      return method === 'POST' && Object.keys(value).every(key => allowed.has(key))
        && typeof value.eod_report_id === 'string' && typeof value.employee_id === 'string'
        && ['hours_worked', 'tip_share', 'house_deduction', 'net_tip'].every(key =>
          typeof value[key] === 'number' && Number.isFinite(value[key]) && (value[key] as number) >= 0)
    }
    return false
  })
}
