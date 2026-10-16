import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { load, dashboardFixture, elements } from './helpers/dashboard-fixture.mjs'

const { calculateLegacyFohPayroll, summarizeLegacyPayroll } = load('src/lib/legacyDashboardPayroll.ts')
const employee = { id: 'legacy-server', name: 'Archived Server', role: 'server', primary_department: 'server',
  is_active: false, hourly_wage: 10, guaranteed_hourly: 20, tip_eligible: true }
const clock = (id, date, extra = {}) => ({ id, employee_id: id, session_date: date,
  clock_in_at: `${date}T18:00:00Z`, clock_out_at: `${date}T23:00:00Z`, approved_hours: 5,
  approval_status: 'approved', ...extra })
const args = { employees: [employee], schedules: [], reports: [], clocks: [], imports: [], cutoff: '2026-08-17' }

test('legacy Dashboard shares Wage Report daily guarantees, saved tips, breaks and archived employees', () => {
  const days = calculateLegacyFohPayroll({ ...args,
    clocks: [clock(employee.id, '2026-08-01'), clock(employee.id, '2026-08-02', { break_minutes: 30 })],
    reports: [{ session_date: '2026-08-01', tip_total: 100, tip_distributions: [{ employee_id: employee.id, hours_worked: 5, net_tip: 25 }] },
      { session_date: '2026-08-02', tip_total: 100, tip_distributions: [{ employee_id: employee.id, hours_worked: 4.5, net_tip: 85 }] }],
  })
  const totals = summarizeLegacyPayroll(days)
  assert.equal(totals.tipOut, 110)
  assert.equal(totals.payrollOut, 120) // 50 base + 25 daily guarantee + 45 base
  assert.equal(totals.totalPayrollOut, 230)
})

test('legacy source gaps exclude imported Server coverage, rollout day, pending shifts and Kitchen pay', () => {
  const cook = { ...employee, id: 'cook', primary_department: 'kitchen', role: 'cook', tip_eligible: false }
  const days = calculateLegacyFohPayroll({ ...args, employees: [employee, cook],
    clocks: [clock(employee.id, '2026-04-06'), clock(employee.id, '2026-04-07'),
      clock(employee.id, '2026-08-16'), clock(employee.id, '2026-08-17'), clock(cook.id, '2026-08-01'),
      clock(employee.id, '2026-08-15', { approval_status: 'pending_review' })],
    imports: [{ category: 'server', start_date: '2026-04-01', end_date: '2026-04-06' }],
  })
  assert.deepEqual(Array.from(days, day => day.date), ['2026-04-07', '2026-08-16'])
  assert.equal(calculateLegacyFohPayroll({ ...args, cutoff: null }).length, 0)
})

test('worked Server department and the full eligible tip pool take priority over current staffing department', () => {
  const manager = { ...employee, id: 'manager', primary_department: 'manager', role: 'manager' }
  const days = calculateLegacyFohPayroll({ ...args, employees: [employee, manager],
    clocks: [clock(employee.id, '2026-08-01'), clock(manager.id, '2026-08-01', { manager_note: '[work_department=server]' })],
    reports: [{ session_date: '2026-08-01', tip_total: 200 }],
  })
  assert.equal(summarizeLegacyPayroll(days).tipOut, 170)
  assert.equal(summarizeLegacyPayroll(days).totalPayrollOut, 270)
})

test('historical tipped Management staff retain Wage Report amounts under their worked department', () => {
  const manager = { ...employee, id: 'manager', primary_department: 'manager', role: 'manager' }
  const days = calculateLegacyFohPayroll({ ...args, employees: [manager], clocks: [clock(manager.id, '2026-07-01')],
    reports: [{ session_date: '2026-07-01', tip_total: 100,
      tip_distributions: [{employee_id: manager.id, hours_worked: 5, net_tip: 85}] }] })
  assert.equal(days[0].department, 'manager')
  assert.equal(summarizeLegacyPayroll(days).totalPayrollOut, 135)
})

test('server reads paginate all source rows and fail visibly instead of returning partial financial data', async () => {
  const { readAllLegacyRows } = load('src/lib/loadLegacyDashboardPayroll.ts', { '@/lib/supabaseAdmin': {supabaseAdmin: {}} })
  const calls = []
  const rows = await readAllLegacyRows(async (from, to) => {
    calls.push([from, to])
    return { data: Array.from({length: from === 0 ? 500 : 3}, (_, i) => from + i), error: null }
  })
  assert.equal(rows.length, 503)
  assert.deepEqual(calls, [[0, 499], [500, 999]])
  await assert.rejects(readAllLegacyRows(async () => ({data: null, error: {message: 'Clock source unavailable'}})), /Clock source unavailable/)
})

const legacy = [{ date: '2026-08-01', tipOut: 16010.33, payrollOut: 2051.45, totalPayrollOut: 18061.78 }]
const augustRun = { id: 'aug-run', pay_date: '2026-08-25', start_date: '2026-08-17', end_date: '2026-08-23', department: 'server',
  total_cash: 2693, total_check: 5036.33, total_ach: 0,
  payroll_run_items: [{ employee_id: employee.id, department: 'server', payment_method: 'check', tips: 6761.01,
    payout_amount: 7729.33, net_pay: 7731.89, payment_allocations: {cash: 2693, check: 5036.33} }] }
const septemberRun = { ...augustRun, id: 'sep-run', pay_date: '2026-09-01',
  payroll_run_items: [{ ...augustRun.payroll_run_items[0], tips: 6839.68, payout_amount: 7765.9, net_pay: 7767.71 }] }
const historical = { version: 1, sales: [], legacy_payroll: legacy, payroll: [
  { category: 'kitchen', start_date: '2026-08-01', end_date: '2026-08-31', cash: 34386, check: 4232.76 },
  { category: 'owner', start_date: '2026-08-01', end_date: '2026-08-31', check: 13333.34 },
  { category: 'kitchen', start_date: '2026-09-01', end_date: '2026-09-15', cash: 18888, check: 1120, additive: true },
] }

test('August cards, department totals and yearly chart include legacy earnings once without inventing payment methods', () => {
  const options = { refDate: '2026-08-15T12:00:00', historical, payrollRuns: [augustRun, septemberRun] }
  const monthly = dashboardFixture(options)
  assert.match(monthly.html, /\$77,743/)
  assert.match(monthly.html, /\$22,771/)
  assert.match(monthly.html, /\$54,972/)
  assert.match(monthly.html, /\$18,062/)
  assert.match(monthly.html, /Cash, check, and ACH totals show recorded payments only/)
  const yearly = dashboardFixture({ ...options, period: 'yearly', chart: 'totalPayrollOut' })
  const charts = elements(yearly.tree).filter(node => node.props.points?.some(point => point.date === '2026-08'))
  assert.ok(charts.length > 0)
  const augustTotals = charts.flatMap(node => node.props.points).filter(point => point.date === '2026-08').map(point => point.value)
  assert.ok(augustTotals.some(value => Math.abs(value - 77743.21) < 0.01))
  const cashCards = elements(monthly.tree).filter(node => node.props.label === 'Cash Payroll Out')
  assert.ok(cashCards.length > 0)
  assert.equal(cashCards[0].props.value, 37079)
})

test('September keeps additive Kitchen imports, places saved payments by pay date, and adds no August legacy', () => {
  const fixture = dashboardFixture({ refDate: '2026-09-15T12:00:00', historical,
    payrollRuns: [augustRun, septemberRun] })
  const total = elements(fixture.tree).find(node => node.props.label === 'Total Payroll Out')
  assert.equal(total.props.value, 27773.9)
  assert.match(fixture.html, /\$20,008|\$27,774/)
})

test('legacy read errors are included in the Dashboard and PDF snapshot source', () => {
  const fixture = dashboardFixture({ payrollRuns: [], historical: { ...historical, legacy_payroll: [], legacy_error: 'Legacy Wage Report earnings could not be loaded. Payroll totals are incomplete.' } })
  assert.match(fixture.html, /role="alert"[^>]*>Legacy Wage Report earnings could not be loaded/)
})

function historicalRoute({ authenticated = true, failLegacy = false } = {}) {
  const secret = 'synthetic-test-only-secret'
  const body = Buffer.from(JSON.stringify({employeeId: 'synthetic-manager', expiresAt: Date.now() + 60000})).toString('base64url')
  const token = `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
  let reads = 0, legacyReads = 0
  const managerQuery = { select() { return this }, eq() { return this }, async maybeSingle() { return {data: {id: 'synthetic-manager'}, error: null} } }
  const route = load('src/app/api/historical-adjustments/route.ts', {
    'next/headers': { cookies: async () => ({get: () => authenticated ? {value: token} : undefined}) },
    '@/lib/supabaseAdmin': {supabaseAdmin: {
      from() { reads++; return managerQuery },
      async rpc() { reads++; return {data: historical, error: null} },
    }},
    '@/lib/loadLegacyDashboardPayroll': {loadLegacyDashboardPayroll: async () => {
      legacyReads++
      if (failLegacy) throw Error('Synthetic clock source failure')
      return legacy
    }},
  }, {Buffer, process: {env: {APP_SESSION_SECRET: secret}}})
  return { route, reads: () => reads, legacyReads: () => legacyReads }
}

test('legacy financial aggregates require the existing verified manager session before any database read', async () => {
  const fixture = historicalRoute({authenticated: false})
  const response = await fixture.route.GET()
  assert.equal(response.status, 401)
  assert.equal(fixture.reads(), 0)
  assert.equal(fixture.legacyReads(), 0)
})

test('authenticated historical API includes legacy aggregates and retains imports with a visible legacy-source error', async () => {
  for (const failLegacy of [false, true]) {
    const fixture = historicalRoute({failLegacy})
    const response = await fixture.route.GET()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const payload = await response.json()
    assert.equal(payload.data.payroll.length, historical.payroll.length)
    if (failLegacy) assert.match(payload.data.legacy_error, /totals are incomplete/)
    else assert.equal(payload.data.legacy_payroll[0].totalPayrollOut, 18061.78)
    assert.equal(fixture.legacyReads(), 1)
  }
})
