import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = fs.readFileSync('src/lib/historicalDashboardTotals.ts', 'utf8')
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const totals = {}
vm.runInNewContext(output, { exports: totals })

test('monthly totals include a full source period while a partial week does not', () => {
  const april = [{ start_date: '2026-04-01', end_date: '2026-04-06', period_kind: 'partial' }]
  assert.equal(totals.periodRows(april, '2026-04-01', '2026-04-30').length, 1)
  assert.equal(totals.periodRows(april, '2026-03-30', '2026-04-05').length, 0)
  assert.equal(totals.periodRows(april, '2026-04-01', '2026-04-06').length, 1)
})

test('yearly chart months reconcile with imported sales and additive payroll totals', () => {
  const sales = totals.monthlyTrendValues(
    [{ date: '2026-04-07', value: 146632.72 }],
    [
      { start_date: '2026-01-01', end_date: '2026-01-31', value: 179728.02 },
      { start_date: '2026-04-01', end_date: '2026-04-06', value: 37878.32 },
    ],
  )
  assert.deepEqual(JSON.parse(JSON.stringify(sales)), [
    { date: '2026-01', value: 179728.02 },
    { date: '2026-04', value: 184511.04 },
  ])

  const payroll = totals.monthlyTrendValues(
    [{ date: '2026-09-16', value: 21266.04 }],
    [{ start_date: '2026-09-01', end_date: '2026-09-15', value: 20008 }],
  )
  assert.equal(Math.round(payroll[0].value * 100), 4127404)
})

test('missing sales are added once and overlapping payroll requires an explicit additive marker', () => {
  const sales = [{
    start_date: '2026-04-01', end_date: '2026-04-06', period_kind: 'partial',
    gross_revenue: 47540.31,
  }]
  assert.equal(totals.nonOverlappingSales(sales, [
    { session_date: '2026-04-01', revenue_total: 0 },
    { session_date: '2026-04-07', revenue_total: 5426.58 },
  ]).length, 1)
  assert.equal(totals.nonOverlappingSales(sales, [
    { session_date: '2026-04-03', revenue_total: 100 },
  ]).length, 0)

  const septemberKitchen = [{
    start_date: '2026-09-01', end_date: '2026-09-15', category: 'kitchen', cash: 18888, check: 1120,
  }]
  assert.equal(totals.nonOverlappingPayroll(septemberKitchen, [
    { start_date: '2026-09-01', end_date: '2026-09-15', department: 'cook' },
  ]).length, 0)
  assert.equal(totals.nonOverlappingPayroll(septemberKitchen, []).length, 1)
  assert.equal(totals.nonOverlappingPayroll([{ ...septemberKitchen[0], additive: true }], [
    { start_date: '2026-09-01', end_date: '2026-09-15', department: 'cook' },
  ]).length, 1)
})

test('imported sales preserve the EOD net, revenue-mix, and tip relationships', () => {
  const result = totals.historicalRevenue([{
    start_date: '2026-04-01', end_date: '2026-04-06', period_kind: 'partial',
    cash: 2441.73, batch_total: 45098.58, gross_revenue: 47540.31,
    sales_tax: 3418, tips_before_house_cut: 6243.99,
    net_revenue: 37878.32, delivery_payment: 4974.85,
  }])
  assert.equal(result.gross, 47540.31)
  assert.equal(result.net, 37878.32)
  assert.equal(Math.round((result.cash + result.card + result.delivery) * 100), 4754031)
  assert.equal(result.collectedTip, 6243.99)
})

test('imported owner wages join manager payroll and the payroll to net sales numerator', () => {
  const result = totals.historicalPayroll([
    { category: 'server', cash_tip: 2053, check_tip: 4830.84, base: 970.2 },
    { category: 'kitchen', cash: 29584, check: 2602.55 },
    { category: 'owner', cash: null, check: 13333.34 },
  ])
  assert.equal(Math.round(result.tipOut * 100), 688384)
  assert.equal(Math.round(result.payrollOut * 100), 4649009)
  assert.equal(Math.round(result.totalPayrollOut * 100), 5337393)
  assert.equal(result.serverWages, 970.2)
  assert.equal(result.kitchen, 32186.55)
  assert.equal(result.manager, 13333.34)
  assert.equal(result.payrollOut, result.serverWages + result.kitchen + result.manager)
})
