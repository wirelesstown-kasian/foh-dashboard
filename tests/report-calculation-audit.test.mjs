import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { NextRequest } = require('next/server')
function load(file, overrides = {}) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  vm.runInNewContext(code, {
    exports, require: name => overrides[name] ?? (name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`, overrides) : require(name)),
    process: { env: { RESEND_API_KEY: 'fake-test-key' } }, Error, Date, Intl, URL, Headers, Request, Response,
    setTimeout: callback => callback(),
  }, { filename: file })
  return exports
}
function extract(file, names, globals = {}) {
  const source = fs.readFileSync(file, 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations = new Map()
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
      declarations.set(node.name.text, node.getText(ast))
    }
    if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(ast))) {
      declarations.set(node.name.getText(ast), `const ${node.getText(ast)}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(declarations.size, names.length)
  const output = ts.transpileModule([...declarations.values()].join('\n') + `\nexport { ${names.join(',')} }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  vm.runInNewContext(output, { exports, Error, Date, ...globals })
  return exports
}

const daily = load('src/lib/dailyTips.ts')
const payroll = load('src/lib/payroll.ts')
const clockUtils = load('src/lib/clockUtils.ts')
const alice = { id: 'alice', name: 'Alice', email: 'alice@example.invalid', role: 'server', primary_department: 'server', schedule_departments: ['server'], tip_eligible: true, hourly_wage: 10, guaranteed_hourly: 20, tip_pool_hourly_rate: null, payment_method: 'ach', is_active: true }
const bob = { ...alice, id: 'bob', name: 'Bob', email: 'bob@example.invalid', guaranteed_hourly: 0 }
const employees = [alice, bob]
const clock = (employee, date, hours = 5) => ({
  id: `${employee.id}-${date}`, employee_id: employee.id, employee, session_date: date,
  clock_in_at: `${date}T17:00:00Z`, clock_out_at: `${date}T${17 + hours}:00:00Z`,
  approval_status: 'approved', auto_clock_out: false, manager_note: null,
})
const clocks = ['2026-10-13', '2026-10-14'].flatMap(date => employees.map(employee => clock(employee, date)))
const report = (date, totalTip, saved = false) => ({
  id: `report-${date}`, session_date: date, tip_total: totalTip, cc_tip: totalTip, cash_tip: 0,
  cash_total: 100, batch_total: 1000 + totalTip, revenue_total: 1100 + totalTip,
  sales_tax: 100, delivery_order_amount: 200, cash_deposit: 100, actual_cash_on_hand: 100,
  tip_distributions: saved ? employees.map(employee => ({ employee_id: employee.id, employee, hours_worked: 5, net_tip: totalTip * 0.85 / 2, house_deduction: totalTip * 0.15 / 2 })) : [],
})
const reports = [report('2026-10-13', 100), report('2026-10-14', 400, true)]

test('missing tips use the full eligible pool, while saved adjustments and hourly caps are respected', () => {
  const missing = daily.getDailyReportTips({ report: reports[0], employees, clockRecords: clocks })
  assert.equal(missing.source, 'calculated')
  assert.equal(missing.tips.get('alice').tips, 42.5)
  const adjusted = { ...reports[1], tip_distributions: [
    { employee_id: 'alice', hours_worked: 5, net_tip: 160 },
    { employee_id: 'bob', hours_worked: 5, net_tip: 180 },
  ] }
  assert.equal(daily.getDailyReportTips({ report: adjusted, employees, clockRecords: clocks }).tips.get('alice').tips, 160)
  const capped = daily.getDailyReportTips({ report: reports[0], employees: [{ ...alice, tip_pool_hourly_rate: 4 }, bob], clockRecords: clocks })
  assert.equal(capped.tips.get('alice').tips, 20)
  assert.equal(capped.tips.get('bob').tips, 65)
})

test('only approved/adjusted completed eligible shifts earn pool tips, after unpaid breaks', () => {
  const cook = { ...alice, id: 'cook', primary_department: 'kitchen', tip_eligible: false }
  const result = daily.calculateDailyTipPreview({ report: reports[0], employees: [...employees, cook], clockRecords: [
    { ...clock(alice, '2026-10-13'), break_minutes: 30 },
    { ...clock(bob, '2026-10-13'), approval_status: 'pending_review' },
    clock(cook, '2026-10-13'), clock(bob, '2026-10-12'),
  ] })
  assert.equal(result.size, 1)
  assert.equal(result.get('alice').hours, 4.5)
  assert.equal(result.get('alice').tips, 85)
})

test('daily guarantee totals match Wage Report and Payroll Worksheet without offsetting a low-tip day', () => {
  const rows = payroll.buildPayrollDraftRows({ employees, clockRecords: clocks, eodReports: reports, department: 'server', startDate: '2026-10-13', endDate: '2026-10-14' })
  const aliceRow = rows.find(row => row.employee_id === 'alice')
  assert.equal(aliceRow.hours, 10)
  assert.equal(aliceRow.tips, 212.5)
  assert.equal(aliceRow.guarantee_top_up, 7.5)
  assert.equal(aliceRow.net_pay, 320)
  const wage = extract('src/app/reporting/wages/page.tsx', ['getClockRecordEmployee', 'recordMatchesDepartment', 'getDailyWageDetail'], { ...clockUtils, ...payroll })
  const byEmployeeDate = new Map(clocks.map(record => [`${record.employee_id}:${record.session_date}`, [record]]))
  let wageTotal = 0
  for (const report of reports) {
    const calculatedTip = daily.calculateDailyTipPreview({ report, employees, clockRecords: clocks }).get('alice')
    const savedTip = daily.getSavedDailyTips(report).get('alice')
    const row = wage.getDailyWageDetail({ emp: alice, date: report.session_date, employees, department: 'server', schedules: [], report,
      clockRecordsByEmployeeDate: byEmployeeDate, calculatedTip, savedTip, useCalculatedTips: report.tip_distributions.length === 0 })
    wageTotal += row.totalEarnings
  }
  assert.equal(wageTotal, aliceRow.net_pay)
})

test('already paid employee-days are excluded after full-pool allocation', () => {
  const rows = payroll.buildPayrollDraftRows({ employees, clockRecords: clocks.filter(record => record.id !== 'alice-2026-10-13'),
    tipClockRecords: clocks, excludedTipEmployeeDates: new Set(['alice|2026-10-13']),
    eodReports: reports, department: 'server', startDate: '2026-10-13', endDate: '2026-10-14' })
  assert.equal(rows.find(row => row.employee_id === 'alice').tips, 170)
  assert.equal(rows.find(row => row.employee_id === 'bob').tips, 212.5)
})

test('performance reports keep the whole tip pool even when viewing just one employee', () => {
  const { buildPerformanceRows } = load('src/lib/performanceReporting.ts')
  const stats = buildPerformanceRows({ employees: [alice], tipEmployees: employees, completions: [], eodReports: reports, clockRecords: clocks,
    startDate: '2026-10-13', endDate: '2026-10-14', monthStart: '2026-10-01', monthEnd: '2026-10-31' })
  assert.equal(stats.employeeMonthStats[0].totalTips, 212.5)
  assert.equal(stats.employeeMonthStats[0].hours, 10)
})

test('dashboard revenue includes incomplete EODs while paid tips only reflect saved payouts', () => {
  const dashboard = extract('src/app/reporting/dashboard/page.tsx', ['getNetRevenue', 'getCardRevenue', 'sumTipDistributions', 'getPayrollRunTotal', 'summarizePayrollRuns', 'sumReports'], payroll)
  const empty = dashboard.summarizePayrollRuns([])
  const totals = dashboard.sumReports(reports, [], empty, 0, true)
  assert.equal(totals.net, 2000)
  assert.equal(totals.collectedTip, 500)
  assert.equal(totals.tipOut, 0)
  assert.equal(totals.cash + totals.card + totals.delivery, 2700)
  const paid = dashboard.summarizePayrollRuns([{ total_cash: 0, total_check: 0, total_ach: 320,
    payroll_run_items: [{ hours: 10, tips: 212.5, payout_amount: 320, net_pay: 320, payment_method: 'ach', commission: 0 }] }])
  assert.equal(dashboard.sumReports(reports, [], paid, 0, true).tipOut, 212.5)
  assert.equal(paid.totalPayrollOut, paid.payrollOut + paid.tipOut)
})

function fakeDatabase(tables) {
  return { from(table) {
    const filters = []
    let single = false
    const builder = {
      select() { return this }, order() { return this },
      eq(key, value) { filters.push(row => row[key] === value); return this },
      gte(key, value) { filters.push(row => row[key] >= value); return this },
      lte(key, value) { filters.push(row => row[key] <= value); return this },
      gt(key, value) { filters.push(row => row[key] > value); return this },
      in(key, values) { filters.push(row => values.includes(row[key])); return this },
      single() { single = true; return this }, maybeSingle() { single = true; return this },
      then(resolve) {
        const data = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)))
        return Promise.resolve(tables.errorTable === table ? { data: null, error: { message: 'Test database error' } } : { data: single ? data[0] ?? null : data, error: null }).then(resolve)
      },
    }
    return builder
  } }
}
function emailSetup(file, tables = {}) {
  const emails = []
  let sheetRows
  const supabaseAdmin = fakeDatabase({ employees, eod_reports: reports, shift_clocks: clocks, schedules: [], ...tables })
  const settings = { eod_tip_emails_enabled: true, wage_report_emails_enabled: true, weekly_summary_emails_enabled: true, weekly_summary_recipient: 'manager@example.invalid', from_name: 'Test', role_definitions: [] }
  const loadedModule = load(file, {
    '@/lib/supabaseAdmin': { supabaseAdmin },
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'test-manager' }) }) },
    '@/lib/adminSession': { ADMIN_SESSION_COOKIE: 'manager', hasManagerAccess: async () => true },
    '@/lib/routeAuth': { getDashboardViewer: async () => ({ isManager: true }) },
    '@/lib/appSettings': { getEmailSettings: async () => settings, getAppSettings: async () => settings },
    '@/lib/emailUtils': { buildEmailDocument: (logo, title, html) => html, renderEmailShell: (logo, html) => html, escapeHtml: value => String(value), formatTime: value => value ?? '', sendEmail: async email => { emails.push(email) } },
    '@/lib/eodGoogleSheet': { resetWageReportSheetInGoogleSheet: async (rows) => { sheetRows = rows; return { success: true } } },
  })
  const post = payload => loadedModule.POST(new NextRequest('http://app.test/api/test', { method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' } }))
  return { module: loadedModule, post, emails, sheetRows: () => sheetRows }
}

test('server wage email includes calculated tips and approved wages on days without an EOD', async () => {
  const setup = emailSetup('src/app/api/send-wage-report-email/route.ts', { shift_clocks: [...clocks, clock(alice, '2026-10-12')] })
  const response = await setup.post({ employee_id: 'alice', ref_date: '2026-10-13', period: 'weekly', view: 'earnings', start_date: '2026-10-12', end_date: '2026-10-14' })
  assert.equal(response.status, 200)
  assert.equal(setup.emails.length, 1)
  assert.match(setup.emails[0].html, /\$212\.50/)
  assert.match(setup.emails[0].html, /\$57\.50/)
  assert.match(setup.emails[0].html, /15\.00 hrs/)
  assert.match(setup.emails[0].html, /2026-10-13 are calculated/)
})

test('server performance email uses the same shared performance calculation as its page', async () => {
  const setup = emailSetup('src/app/api/send-performance-report-email/route.ts')
  assert.equal((await setup.post({ employee_id: 'alice', start_date: '2026-10-13', end_date: '2026-10-14', department: 'server' })).status, 200)
  assert.equal(setup.emails.length, 1)
  assert.match(setup.emails[0].html, /\$21\.25/)
})

test('weekly summary includes employees from a missing distribution day', async () => {
  const setup = emailSetup('src/lib/weeklySummaryEmail.ts', { eod_reports: [reports[0]], shift_clocks: clocks.filter(clock => clock.session_date === '2026-10-13') })
  await setup.module.sendPreviousWeekSummaryEmail({ resendKey: 'fake', appUrl: 'http://app.test', referenceDate: new Date('2026-10-19T12:00:00Z') })
  assert.equal(setup.emails.length, 1)
  assert.match(setup.emails[0].html, /Alice/)
  assert.match(setup.emails[0].html, /\$42\.50/)
  assert.match(setup.emails[0].html, /\$85\.00/)
  assert.match(setup.emails[0].html, /2026-10-13 are calculated/)
})

test('wage sheet export uses daily guarantee top-ups matching payroll', async () => {
  const setup = emailSetup('src/app/api/wage-sheet-sync/route.ts')
  assert.equal((await setup.post({ start_date: '2026-10-13', end_date: '2026-10-14', view: 'earnings' })).status, 200)
  const row = setup.sheetRows().find(row => row.employeeName === 'Alice')
  assert.equal(row.guaranteeTopUp, 7.5)
  assert.equal(row.totalEarnings, 320)
})

test('EOD email weekly totals include its unsaved distribution day', async () => {
  const setup = emailSetup('src/app/api/send-eod-email/route.ts')
  assert.equal((await setup.post({ eod_report_id: reports[0].id })).status, 200)
  const email = setup.emails.find(email => email.to === alice.email)
  assert.ok(email)
  assert.match(email.html, /\$212\.50/)
})

test('worksheet employee refresh and add keep the full pool and select the intended employee', () => {
  const base = payroll.buildPayrollDraftRows({ employees, clockRecords: clocks, eodReports: reports, department: 'server', startDate: '2026-10-13', endDate: '2026-10-14' })
  let rows = [...base]
  const page = extract('src/app/payroll/worksheet/page.tsx', ['refreshWorksheetRow', 'addEmployee'], {
    ...payroll, employees, clockRecords: clocks, unpaidClockRecords: clocks, eodReports: reports,
    paidClockRecordIdsForRange: new Set(), paidEmployeeDateKeysForRange: new Set(),
    department: 'server', startDate: '2026-10-13', endDate: '2026-10-14', schedules: [],
    worksheetMode: 'draft', employeeToAdd: 'bob', rows: [], sortPayrollRows: rows => rows,
    setRows: update => { rows = update(rows) }, setExcludedEmployeeIds() {}, setEmployeeToAdd() {},
  })
  page.refreshWorksheetRow('alice')
  assert.equal(rows.find(row => row.employee_id === 'alice').tips, 212.5)
  rows = []
  page.addEmployee()
  assert.equal(rows[0].employee_id, 'bob')
  assert.equal(rows[0].tips, 212.5)
})

test('post-payout clock correction changes daily guarantee only for affected days and never doubles missing tips', () => {
  const base = payroll.buildPayrollDraftRows({ employees, clockRecords: clocks, eodReports: reports, department: 'server', startDate: '2026-10-13', endDate: '2026-10-14' })
    .map(row => ({ ...row, id: row.employee_id }))
  const page = extract('src/app/reporting/payroll-payouts/page.tsx', ['getPayrollItemEmployee', 'getClockRecordEmployee', 'calculateSavedPayrollItem', 'appendMemo', 'getEditedClockHours', 'clockEditChanged', 'recalculateRowsForClockTimeChanges'], {
    ...payroll, ...clockUtils, ...daily, ...load('src/lib/tipCalc.ts'), ...load('src/lib/tipEligibility.ts'),
    format: require('date-fns').format,
    isoToTimeInput: value => value?.slice(11, 16) ?? '',
    timeInputToIso: (date, value) => value ? `${date}T${value}:00Z` : null,
  })
  const result = page.recalculateRowsForClockTimeChanges({ rows: base, selectedItem: base[0], selectedClockRecords: clocks.filter(clock => clock.employee_id === 'alice'),
    clockRecords: clocks, clockEdits: { 'alice-2026-10-13': { clockIn: '17:00', clockOut: '23:00' }, 'alice-2026-10-14': { clockIn: '17:00', clockOut: '22:00' } },
    employees, eodReports: reports, schedules: [], adjustmentNote: '' })
  const next = result.rows.find(row => row.employee_id === 'alice')
  assert.equal(next.hours, 11)
  assert.equal(next.tips, 216.36)
  assert.equal(next.guarantee_top_up, 13.64)
  assert.equal(next.net_pay, 340)
  assert.equal(base[0].net_pay, 320)
  assert.equal(reports[0].tip_distributions.length, 0)
  const manual = page.calculateSavedPayrollItem(base[0], { tips: 200 }, employees)
  assert.equal(manual.guarantee_top_up, 7.5)
})

test('missing-tip notices are scoped to the displayed dates and link to the editor', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const { MissingTipDistributionNotice } = load('src/components/reporting/MissingTipDistributionNotice.tsx', {
    'next/link': { default: ({ href, children }) => React.createElement('a', { href }, children) },
  })
  const render = (startDate, endDate) => renderToStaticMarkup(React.createElement(MissingTipDistributionNotice, { reports, startDate, endDate }))
  assert.match(render('2026-10-13', '2026-10-14'), /2026-10-13/)
  assert.match(render('2026-10-13', '2026-10-14'), /href="\/payroll\/tip-distribution-editor"/)
  assert.equal(render('2026-10-14', '2026-10-14'), '')
})

test('weekly tip summaries include missing distributions on the previous side of a month boundary', async () => {
  const priorReport = report('2026-09-29', 100)
  const setup = emailSetup('src/lib/weeklySummaryEmail.ts', { eod_reports: [priorReport], shift_clocks: employees.map(employee => clock(employee, '2026-09-29')) })
  await setup.module.sendPreviousWeekSummaryEmail({ resendKey: 'fake', appUrl: 'http://app.test', referenceDate: new Date('2026-10-05T12:00:00Z') })
  assert.equal(setup.emails.length, 1)
  assert.match(setup.emails[0].html, /\$42\.50/)
})

test('a failed EOD clock query cannot silently send a report with missing employee tips', async () => {
  const setup = emailSetup('src/app/api/send-eod-email/route.ts', { errorTable: 'shift_clocks' })
  assert.equal((await setup.post({ eod_report_id: reports[0].id })).status, 500)
  assert.equal(setup.emails.length, 0)
})

test('paid clock details stay in the worked department for staff assigned to multiple departments', () => {
  const flex = { ...alice, schedule_departments: ['server', 'kitchen'] }
  const serverClock = clock(flex, '2026-10-13')
  const kitchenClock = { ...clock(flex, '2026-10-14'), manager_note: '[work_department=kitchen]' }
  const page = extract('src/app/reporting/payroll-payouts/page.tsx', ['getClockRecordEmployee', 'getEmployeeClockRecords'], clockUtils)
  const records = page.getEmployeeClockRecords({ employeeId: 'alice', clockRecords: [serverClock, kitchenClock], employees: [flex],
    department: 'server', startDate: '2026-10-13', endDate: '2026-10-14', schedules: [] })
  assert.equal(records.length, 1)
  assert.equal(records[0].session_date, '2026-10-13')
})
