import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const xlsx = require('xlsx')
const cache = new Map()
function load(filename) {
  if (cache.has(filename)) return cache.get(filename)
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(code, {
    exports, require: name => name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : require(name),
    Date, Intl, process, Buffer, structuredClone, Error,
  }, { filename })
  cache.set(filename, exports)
  return exports
}
const { buildReportWorkbook } = load('src/lib/reportExcel.ts')
const { getRoleLabel, getDepartmentLabel } = load('src/lib/organization.ts')
const { formatPayrollPaymentSummary, paymentMethodLabel } = load('src/lib/payroll.ts')
const { format } = require('date-fns')

// Exercise the actual page export handler without rendering the report or
// connecting to a production database. Decode the emitted XLSX bytes again.
function setupHandler(filename, globals) {
  const source = fs.readFileSync(filename, 'utf8')
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let handler
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleExcelExport') handler = node.initializer.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(handler, 'report has an Excel export handler')
  const output = ts.transpileModule(`export const handler = ${handler}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const result = { busy: [], message: null, workbook: null, filename: null }
  const exports = {}
  vm.runInNewContext(output, {
    exports, getRoleLabel, getDepartmentLabel, formatPayrollPaymentSummary, paymentMethodLabel, format, Error,
    setExportingExcel: value => result.busy.push(value),
    setRefreshMessage: value => { result.message = value },
    setMessage: value => { result.message = value },
    exportReportToExcel: async (filename, sheets) => {
      const wb = buildReportWorkbook(xlsx, sheets)
      const bytes = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true })
      result.workbook = xlsx.read(bytes, { type: 'buffer', cellNF: true })
      result.filename = filename
    },
    ...globals,
  })
  return { handler: exports.handler, result }
}
const wageRow = name => ({
  emp: { id: name, name, role: 'server', pin_hash: 'not-for-export' },
  hours: 6.125, mealBreakMinutes: 30, tips: 65.25, baseWages: 40, guaranteeTopUp: 5,
  commission: 2.5, deductions: 1.25, totalEarnings: 111.5, tipRate: null,
  paymentBreakdown: { cash: 10, check: 101.5, ach: 0, unknown: 0 }, hasOpenClock: false, hasAutoClockOut: false,
})
const alice = wageRow('=Alice')
const bob = wageRow('Bob')
const wageGlobals = {
  displayedRows: [alice], rows: [alice, bob], selectedEmployeeName: '=Alice',
  view: 'earnings', department: 'server', payoutStatus: 'partial',
  startDate: '2026-10-01', endDate: '2026-10-07',
  roleDefinitions: [{ key: 'server', label: 'Server' }], departmentDefinitions: [{ key: 'server', label: 'Servers' }],
  formatPaymentBreakdown: () => 'Cash $10.00 + Check $101.50',
  detailRowsByEmployeeId: new Map([[alice.emp.id, [{ ...alice, date: '2026-10-02' }]], [bob.emp.id, [{ ...bob, date: '2026-10-03' }]]]),
}
function dataRows(sheet) {
  const range = xlsx.utils.decode_range(sheet['!autofilter'].ref)
  return xlsx.utils.sheet_to_json(sheet, { header: 1, range: range.s.r, raw: true, defval: null })
}

test('wage Excel preserves filtered staff, numeric earnings, totals, dates and literal names', async () => {
  const { handler, result } = setupHandler('src/app/reporting/wages/page.tsx', wageGlobals)
  await handler()
  assert.deepEqual(result.workbook.SheetNames, ['Wage Summary', 'Daily Details'])
  const sheet = result.workbook.Sheets['Wage Summary']
  const [headers, row, total] = dataRows(sheet)
  assert.equal(row[0], '=Alice')
  assert.equal(row[headers.indexOf('Paid By')], 'Cash + Check')
  assert.equal(row[headers.indexOf('Cash Amount')], 10)
  assert.equal(row[headers.indexOf('Check Amount')], 101.5)
  assert.equal(row[headers.indexOf('ACH Amount')], 0)
  assert.equal(total[headers.indexOf('Check Amount')], 101.5)
  assert.equal(row[headers.indexOf('Tips')], 65.25)
  assert.equal(row[headers.indexOf('Total Earnings')], 111.5)
  assert.equal(total[headers.indexOf('Total Earnings')], 111.5)
  assert.equal(total[headers.indexOf('Tips / Hr')], null)
  const start = xlsx.utils.decode_range(sheet['!autofilter'].ref).s.r + 1
  assert.equal(sheet[xlsx.utils.encode_cell({ r: start, c: 0 })].t, 's')
  assert.equal(sheet[xlsx.utils.encode_cell({ r: start, c: 0 })].f, undefined)
  const cashCell = sheet[xlsx.utils.encode_cell({ r: start, c: headers.indexOf('Cash Amount') })]
  assert.equal(cashCell.t, 'n')
  assert.match(cashCell.z, /0\.00/)
  const daily = dataRows(result.workbook.Sheets['Daily Details'])
  assert.equal(daily[1][1], '2026-10-02')
  assert.equal(daily.length, 3)
  assert.ok(!JSON.stringify(result.workbook).includes('not-for-export'))
  assert.deepEqual(result.busy, [true, false])
})

test('wage payment methods remain filterable for ACH, mixed unknown, and unpaid rows', async () => {
  const exportRows = [
    { ...alice, paymentBreakdown: { cash: 0, check: 0, ach: 50, unknown: 0 } },
    { ...bob, paymentBreakdown: { cash: 10, check: 0, ach: 0, unknown: 20 } },
    { ...bob, paymentBreakdown: { cash: 0, check: 0, ach: 0, unknown: 0 } },
  ]
  const { handler, result } = setupHandler('src/app/reporting/wages/page.tsx', { ...wageGlobals, displayedRows: exportRows })
  await handler()
  const [headers, ach, mixed, unpaid, total] = dataRows(result.workbook.Sheets['Wage Summary'])
  const method = headers.indexOf('Paid By')
  assert.equal(ach[method], 'ACH')
  assert.equal(mixed[method], 'Cash + Unknown')
  assert.equal(unpaid[method], 'Not recorded')
  assert.equal(total[headers.indexOf('ACH Amount')], 50)
  assert.equal(total[headers.indexOf('Unknown Amount')], 20)
})

test('Tip Only exports omit wage and earnings columns from both sheets', async () => {
  const { handler, result } = setupHandler('src/app/reporting/wages/page.tsx', { ...wageGlobals, view: 'tips' })
  await handler()
  for (const sheet of Object.values(result.workbook.Sheets)) {
    const headers = dataRows(sheet)[0]
    assert.ok(headers.includes('Tips'))
    assert.ok(!headers.includes('Base Wages'))
    assert.ok(!headers.includes('Total Earnings'))
  }
})

test('individual wage export scopes summary and daily details to the selected employee', async () => {
  const { handler, result } = setupHandler('src/app/reporting/wages/page.tsx', { ...wageGlobals, displayedRows: [alice, bob] })
  await handler([bob], 'Bob')
  assert.equal(dataRows(result.workbook.Sheets['Wage Summary'])[1][0], 'Bob')
  assert.equal(dataRows(result.workbook.Sheets['Daily Details'])[1][0], 'Bob')
  assert.equal(dataRows(result.workbook.Sheets['Wage Summary']).length, 3)
})

test('payout Excel includes every matching saved payout beyond the 50-row screen limit', async () => {
  const runs = Array.from({ length: 60 }, (_, index) => ({
    id: `run-${index}`, department: 'kitchen', pay_date: '2026-10-09', start_date: '2026-10-01', end_date: '2026-10-07',
    total_cash: 10, total_check: 20, total_ach: 0, total_net: 30, memo: '=memo', created_at: '2026-10-09T12:00:00Z',
    payroll_run_items: [{ employee_name: `Staff ${index}`, department: 'kitchen', display_order: 1,
      hours: 5.5, tips: 10, base_wages: 20.33, guarantee_top_up: 0, commission: 0, deductions: 0,
      net_pay: 30.33, payout_amount: 30, payment_method: 'cash', payment_allocations: { cash: 10.33, check: 20, ach: 0 }, memo: '=literal' }],
  }))
  const { handler, result } = setupHandler('src/app/reporting/payroll-payouts/page.tsx', {
    matchingRuns: runs, filteredRuns: runs.slice(0, 50), department: 'kitchen', rangeStart: '2026-10-01', rangeEnd: '2026-10-31',
    departmentOptions: [{ key: 'kitchen', label: 'Kitchen' }],
  })
  await handler()
  const summary = dataRows(result.workbook.Sheets['Payout Summary'])
  const details = dataRows(result.workbook.Sheets['Employee Details'])
  assert.equal(summary.length, 62)
  assert.equal(details.length, 62)
  assert.equal(summary.at(-1)[summary[0].indexOf('Total')], 1800)
  assert.equal(details.at(-1)[details[0].indexOf('Payout')], 1800)
  assert.equal(details[1][details[0].indexOf('Paid By')], 'Cash $10.00 + Check $20.00')
  assert.equal(details[1][details[0].indexOf('Department')], 'Kitchen')
  assert.equal(details[1][details[0].indexOf('Memo')], '=literal')
})

test('invalid financial numbers fail the export and clear its busy state', async () => {
  const { handler, result } = setupHandler('src/app/reporting/wages/page.tsx', { ...wageGlobals, displayedRows: [{ ...alice, tips: Infinity }] })
  await handler()
  assert.equal(result.workbook, null)
  assert.match(result.message, /invalid number/)
  assert.deepEqual(result.busy, [true, false])
})
