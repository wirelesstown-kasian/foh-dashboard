import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {load, elements} from './helpers/dashboard-fixture.mjs'
const require = createRequire(import.meta.url)
const React = require('react')
const {renderToStaticMarkup} = require('react-dom/server')
const reconciliation = load('src/lib/wageReportReconciliation.ts')

const employee = (id, department, hourly = 10) => ({id, name: `Fixture ${id}`, role: department === 'cook' ? 'kitchen_staff' : 'server',
  primary_department: department, schedule_departments: [department], hourly_wage: hourly, guaranteed_hourly: null,
  tip_eligible: department === 'server', tip_pool_hourly_rate: null, payment_method: 'cash', is_active: true})
const employees = [employee('server', 'server'), employee('cook', 'cook'), employee('kitchen', 'kitchen'), employee('unmatched', 'cook', 20)]
const shift = (id, date, hours) => ({id: `${id}-${date}`, employee_id: id, session_date: date, approval_status: 'approved',
  clock_in_at: `${date}T12:00:00Z`, clock_out_at: new Date(Date.parse(`${date}T12:00:00Z`) + hours * 3600000).toISOString(),
  auto_clock_out: false, manager_note: `[work_department=${id === 'server' ? 'server' : 'cook'}]`})
const clocks = [shift('server', '2026-09-30', 5), shift('unmatched', '2026-09-18', 5.48)]
const report = (date, tips) => ({id: date, session_date: date, tip_total: tips,
  tip_distributions: [{employee_id: 'server', hours_worked: 5, net_tip: tips * .85, house_deduction: tips * .15}]})
const reports = [report('2026-09-14', 100), report('2026-09-30', 200), report('2026-10-04', 500)]
const saved = (id, employeeId, department, start, end, date, base, tips, commission = 0, method = 'cash') => ({
  id, department, start_date: start, end_date: end, pay_date: date, created_at: `${date}T12:00:00Z`,
  total_net: base + tips + commission, total_cash: method === 'cash' ? Math.floor(base + tips + commission) : 0,
  total_check: method === 'check' ? base + tips + commission : 0, total_ach: 0,
  payroll_run_items: [{id: `${id}-item`, employee_id: employeeId, employee_name: `Fixture ${employeeId}`, department,
    role: 'server', hours: 5, tips, base_wages: base, guarantee_top_up: 0, commission, deductions: 0,
    net_pay: base + tips + commission, payout_amount: method === 'cash' ? Math.floor(base + tips + commission) : base + tips + commission,
    payment_method: method, created_at: `${date}T12:00:00Z`}],
})
const runs = [
  saved('server-early', 'server', 'server', '2026-08-31', '2026-09-06', '2026-09-08', 50.75, 100, 10),
  saved('server-late', 'server', 'server', '2026-09-28', '2026-10-04', '2026-10-06', 70, 200, 0, 'check'),
  saved('cook', 'cook', 'cook', '2026-09-01', '2026-09-30', '2026-10-01', 200.40, 0),
  saved('kitchen', 'kitchen', 'kitchen', '2026-09-01', '2026-09-30', '2026-10-01', 300.65, 0),
  saved('manager', 'unmatched', 'manager', '2026-09-01', '2026-09-15', '2026-09-16', 1000, 0),
]

function fixture(department, filter = 'all', options = {}) {
  const pdfCalls = []
  const states = [department, 'monthly', new Date('2026-09-15T12:00:00'), '', '', 'earnings', filter]
  let cursor = 0
  const blocks = names => Object.fromEntries(names.map(name => [name, ({children}) => React.createElement('div', null, children)]))
  const tableBlocks = load('src/components/ui/table.tsx')
  const overrides = {
    react: {...React, useMemo: fn => fn(), useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], value => {states[index] = typeof value === 'function' ? value(states[index]) : value}]
    }},
    '@/components/reporting/useReportingData': {
      useEmployees: () => employees, useEodReports: () => ({eodReports: reports}), useClockRecords: () => ({clockRecords: clocks}),
      usePayrollRuns: () => ({payrollRuns: options.runs ?? runs}), useTaskCompletions: () => ({completions: []}),
      useScheduledDepartmentIds: () => new Map(), useSchedulesByRange: () => [],
    },
    '@/components/useAppSettings': {useAppSettings: () => ({roleDefinitions: [], departmentDefinitions: []})},
    '@/components/layout/AdminSubpageHeader': {AdminSubpageHeader: () => null},
    '@/components/reporting/DepartmentTabs': {DepartmentTabs: () => null},
    '@/components/reporting/ReportingNav': {ReportingNav: () => null},
    '@/components/reporting/ReportingToolbar': {ReportingToolbar: () => null},
    '@/components/reporting/MissingTipDistributionNotice': {MissingTipDistributionNotice: () => null},
    '@/lib/reportExport': {exportReportToPdf: (...args) => pdfCalls.push(args)},
    '@/components/ui/button': {Button: ({children, ...props}) => React.createElement('button', props, children)},
    '@/components/ui/table': tableBlocks,
    '@/components/ui/badge': blocks(['Badge']),
    '@/components/ui/dialog': {...blocks(['DialogContent', 'DialogHeader', 'DialogTitle']), Dialog: ({open, children}) => open ? children : null},
    '@/components/ui/select': blocks(['Select', 'SelectContent', 'SelectItem', 'SelectTrigger', 'SelectValue']),
  }
  const page = load('src/app/reporting/wages/page.tsx', overrides)
  const render = () => {cursor = 0; const tree = page.default(); return {tree, html: renderToStaticMarkup(tree)}}
  return {render, pdfCalls}
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('')
  if (React.isValidElement(node)) return text(node.props.children)
  return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}
function card(tree, label) {
  return elements(tree).find(node => node.type === 'div' && React.Children.toArray(node.props.children).some(child => React.isValidElement(child) && child.type === 'p' && child.props.children === label))
}

test('restaurant September allocations stay constant across Server, Cook, Kitchen, and employee filters', () => {
  for (const [department, filter] of [['server', 'all'], ['cook', 'all'], ['kitchen', 'all'], ['cook', 'cook']]) {
    const {tree} = fixture(department, filter).render()
    assert.match(text(card(tree, 'Tips collected')), /\$300\.00/)
    assert.match(text(card(tree, 'Allocated to house')), /\$45\.00/)
    assert.match(text(card(tree, 'Allocated to staff')), /\$255\.00/)
    assert.match(text(tree), /Staff \+ house allocations \$300\.00/)
  }
})

test('saved pay periods, commissions, cash rounding, and selected table tips remain explicit', () => {
  const {tree, html} = fixture('server').render()
  assert.match(html, /Saved pay periods cross this date range/)
  assert.match(html, /8\/31\/2026/)
  assert.match(html, /10\/4\/2026/)
  const equation = elements(tree).find(node => 'data-wage-reconciliation' in node.props)
  assert.match(text(equation), /Recorded payouts\$430\.00Rounding \/ payout adjustment\$0\.75Unmatched earnings\$0\.00Total earnings\$430\.75/)
  assert.match(text(equation), /Tips in this table: \$300\.00/)
  const footer = elements(tree).find(node => node.type === 'tfoot')
  assert.match(text(footer), /\$430\.75$/)
  assert.match(text(footer), /\$10\.00/)
})

test('unmatched Cook work stays visible alongside saved payouts and can be traced to employee and date', () => {
  const ui = fixture('cook')
  let {tree, html} = ui.render()
  assert.match(html, /Fixture unmatched/)
  assert.match(text(card(tree, 'Unmatched earnings')), /\$109\.60/)
  const equation = elements(tree).find(node => 'data-wage-reconciliation' in node.props)
  assert.match(text(equation), /Recorded payouts\$200\.00Rounding \/ payout adjustment\$0\.40Unmatched earnings\$109\.60Total earnings\$310\.00/)
  assert.match(text(elements(tree).find(node => node.type === 'tfoot')), /\$310\.00$/)
  elements(tree).find(node => node.props.onClick && text(node) === 'Review unmatched work').props.onClick()
  ;({html} = ui.render())
  assert.match(html, /2026-09-18/)
  assert.match(html, /5\.48/)
  assert.match(html, /Check for external payments/)
})

test('Kitchen and individual employee totals use the same payout scope as their table', () => {
  for (const [department, filter, expected] of [['kitchen', 'all', '300.65'], ['cook', 'cook', '200.40']]) {
    const {tree} = fixture(department, filter).render()
    const equation = elements(tree).find(node => 'data-wage-reconciliation' in node.props)
    assert.ok(text(equation).includes(`Total earnings$${expected}`))
    assert.match(text(card(tree, 'Unmatched earnings')), /\$0\.00/)
    assert.ok(text(elements(tree).find(node => node.type === 'tfoot')).endsWith(`$${expected}`))
  }
  const {tree} = fixture('all').render()
  assert.match(text(card(tree, 'Unmatched earnings')), /\$109\.60/)
  assert.match(text(elements(tree).find(node => node.type === 'tfoot')), /\$2041\.40$/)
  const selectedUnmatched = fixture('cook', 'unmatched').render()
  assert.match(text(card(selectedUnmatched.tree, 'Unmatched earnings')), /\$109\.60/)
  assert.match(selectedUnmatched.html, /No saved payout matches this selection/)
  assert.doesNotMatch(selectedUnmatched.html, /Saved payouts included/)
})

test('payday itself and another department do not falsely mark a worked day paid', () => {
  const run = runs[0]
  assert.equal(reconciliation.wageDetailMatchesPayroll({date: run.pay_date, workDepartment: 'server'}, 'server', run, 'all'), false)
  assert.equal(reconciliation.wageDetailMatchesPayroll({date: '2026-09-01', workDepartment: 'cook'}, 'server', run, 'all'), false)
  assert.equal(reconciliation.wageDetailMatchesPayroll({date: '2026-09-01', workDepartment: 'server'}, 'server', run, 'server'), true)
  assert.equal(reconciliation.wageDetailMatchesPayroll({date: run.pay_date, sourceRunId: run.id}, 'server', run, 'server'), true)
})

test('restaurant allocation uses saved house deductions and exposes unallocated capped tips', () => {
  const summarize = (reportRows, staff = employees) => reconciliation.summarizeRestaurantTips({reports: reportRows, employees: staff,
    clocks: [shift('server', '2026-09-30', 5)], schedules: [], startDate: '2026-09-01', endDate: '2026-09-30'})
  const manual = summarize([{...report('2026-09-30', 100), tip_distributions: [{employee_id: 'server', net_tip: 88, house_deduction: 12}]}])
  assert.equal(manual.houseTip, 12)
  assert.equal(manual.difference, 0)
  const capped = summarize([{...report('2026-09-30', 300), tip_distributions: []}], [{...employees[0], tip_pool_hourly_rate: 10}])
  assert.equal(capped.totalTipOut, 50)
  assert.equal(capped.houseTip, 45)
  assert.equal(capped.difference, 205)
})


function staffTable(tree) {
  return elements(tree).find(node => 'data-wage-staff-table' in node.props)
}
function staffOrder(tree) {
  return elements(staffTable(tree)).filter(node => node.type === 'button' && !node.props['aria-label']).map(text)
}

test('Paid By shows method names only and opens the saved commission breakdown', () => {
  const ui = fixture('server')
  let {tree} = ui.render()
  const paidBy = elements(staffTable(tree)).find(node => node.props['aria-label'] === 'View payout details for Fixture server')
  assert.equal(text(paidBy), 'Cash + Check')
  assert.ok(!text(paidBy).includes('$'))
  paidBy.props.onClick()
  let rendered = ui.render()
  assert.match(rendered.html, /Fixture server Wage Detail/)
  const earlyPayout = elements(rendered.tree).find(node => node.props['data-payout-group'] === 'server-early')
  assert.match(text(earlyPayout), /\$50\.75\$100\.00\$0\.00\$10\.00\$0\.00\$160\.75/)
  const latePayout = elements(rendered.tree).find(node => node.props['data-payout-group'] === 'server-late')
  assert.match(text(latePayout), /\$70\.00\$200\.00/)
  // The saved late payout includes the full pay period; daily EOD work remains a separate estimate.
  elements(latePayout).find(node => node.props['aria-expanded'] === false).props.onClick()
  rendered = ui.render()
  assert.match(rendered.html, /9\/30\/2026/)
  assert.match(rendered.html, /Daily estimate/)
  elements(rendered.tree).find(node => node.props.onClick && text(node) === 'PDF Export').props.onClick()
  assert.equal(ui.pdfCalls.length, 1)
  assert.match(ui.pdfCalls[0][1], /Saved payout details/)
  assert.match(ui.pdfCalls[0][1], /<td class="right">\$10\.00<\/td>/)
})

test('employee details retain a separate salary payout despite existing clocks and department filters', () => {
  const ui = fixture('all', 'unmatched')
  let {tree} = ui.render()
  elements(staffTable(tree)).find(node => node.type === 'button' && text(node) === 'Fixture unmatched').props.onClick()
  ;({tree} = ui.render())
  const salary = elements(tree).find(node => node.props['data-payout-group'] === 'manager')
  assert.ok(salary, 'salary-only manager payout must be present even though employee has Cook clocks')
  assert.match(text(salary), /Manager/)
  assert.match(text(salary), /\$1,000\.00/)
  assert.ok(elements(tree).some(node => node.props['data-payout-group'] === 'unmatched'))
  const cookUi = fixture('cook', 'unmatched')
  ;({tree} = cookUi.render())
  elements(staffTable(tree)).find(node => node.type === 'button' && text(node) === 'Fixture unmatched').props.onClick()
  ;({tree} = cookUi.render())
  assert.ok(!elements(tree).some(node => node.props['data-payout-group'] === 'manager'), 'another department must not leak into selected payout details')
})

test('numeric and payment-method sorting reorder staff without changing financial totals', () => {
  const ui = fixture('all')
  let {tree} = ui.render()
  assert.deepEqual(staffOrder(tree), ['Fixture cook', 'Fixture kitchen', 'Fixture server', 'Fixture unmatched'])
  const setSort = (value) => {
    elements(tree).find(node => node.props.value && node.props.onValueChange && ['name', 'totalEarnings', 'hours', 'commission', 'paymentMethod'].includes(node.props.value)).props.onValueChange(value)
    ;({tree} = ui.render())
  }
  setSort('totalEarnings')
  assert.deepEqual(staffOrder(tree), ['Fixture cook', 'Fixture kitchen', 'Fixture server', 'Fixture unmatched'])
  elements(tree).find(node => node.props['aria-label'] === 'Toggle sort direction').props.onClick()
  ;({tree} = ui.render())
  assert.deepEqual(staffOrder(tree), ['Fixture unmatched', 'Fixture server', 'Fixture kitchen', 'Fixture cook'])
  setSort('commission')
  assert.equal(staffOrder(tree)[0], 'Fixture server')
  setSort('paymentMethod')
  assert.match(text(elements(tree).find(node => node.type === 'tfoot')), /\$2041\.40$/)
  assert.match(text(card(tree, 'Unmatched earnings')), /\$109\.60/)
})

test('saved payout receipts preserve deductions, manual splits, zero hours and historical employee names', () => {
  const {buildWagePayoutGroups} = load('src/lib/wageReportDetails.ts')
  const salaried = saved('salary', 'server', 'manager', '2026-09-01', '2026-09-30', '2026-10-03', 500.75, 0, 75, 'check')
  Object.assign(salaried.payroll_run_items[0], {hours: 0, deductions: 10, net_pay: 565.75,
    payout_amount: 565, payment_allocations: {cash: 65.75, check: 400, ach: 100}, commission_payment_method: 'ach'})
  const employee = {id: 'server', name: 'Fixture server'}
  const groups = buildWagePayoutGroups({runs: [salaried], employee, department: 'all', details: [], legacyCutoff: null})
  assert.equal(groups.length, 1)
  assert.equal(groups[0].totals.commission, 75)
  assert.equal(groups[0].totals.deductions, 10)
  assert.equal(groups[0].totals.totalEarnings, 565.75)
  assert.equal(groups[0].payout, 565)
  assert.equal(groups[0].adjustment, .75)
  assert.equal(groups[0].payments.cash, 65)
  assert.equal(groups[0].payments.ach, 100)
  salaried.payroll_run_items[0].employee_id = null
  assert.equal(buildWagePayoutGroups({runs: [salaried], employee, department: 'all', details: [], legacyCutoff: null}).length, 1)
  assert.equal(buildWagePayoutGroups({runs: [salaried], employee, department: 'server', details: [], legacyCutoff: null}).length, 0)
})
