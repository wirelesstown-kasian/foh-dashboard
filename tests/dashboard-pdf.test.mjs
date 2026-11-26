import test from 'node:test'
import assert from 'node:assert/strict'
import {dashboardFixture, elements, load} from './helpers/dashboard-fixture.mjs'

test('dashboard PDF uses the selected date range, chart, and closed-day settings', () => {
  for (const [settings, start, end, chart] of [
    [{period: 'weekly'}, '2026-10-12', '2026-10-18', 'Net Revenue'],
    [{period: 'monthly'}, '2026-10-01', '2026-10-31', 'Net Revenue'],
    [{period: 'yearly', chart: 'totalPayrollRatio'}, '2026-01-01', '2026-12-31', 'Total Payroll / (Net Sales + Tips)'],
    [{period: 'custom', start: '2026-10-14', end: '2026-10-13'}, '2026-10-13', '2026-10-14', 'Net Revenue'],
  ]) {
    const source = {}
    const fixture = dashboardFixture({...settings, source})
    const button = elements(fixture.tree).find(node => node.props.title?.includes('save the current dashboard'))
    assert.equal(button.props.disabled, false)
    button.props.onClick()
    assert.equal(fixture.calls.length, 1)
    assert.equal(fixture.calls[0][0], source)
    const options = fixture.calls[0][1]
    assert.equal(options.startDate, start)
    assert.equal(options.endDate, end)
    assert.equal(options.chartLabel, chart)
    assert.deepEqual(Array.from(options.closedDays), ['Mon'])
    assert.match(fixture.html, /Actual Net Revenue/)
    assert.match(fixture.html, /Payroll by Department/i)
  }
})

test('dashboard PDF waits for report, payroll, and cash reads and retains data warnings', () => {
  for (const settings of [{eodLoading: true}, {payrollLoading: true}, {cashLoading: true}]) {
    const fixture = dashboardFixture(settings)
    assert.equal(elements(fixture.tree).find(node => node.props.title?.includes('save the current dashboard')).props.disabled, true)
  }
  const fixture = dashboardFixture({eodError: 'EOD totals are incomplete', cashError: 'Cash entries could not be loaded'})
  assert.match(fixture.html, /EOD totals are incomplete/)
  assert.match(fixture.html, /Cash entries could not be loaded/)
})

test('PDF print mode flows across pages and restores the document title after printing', () => {
  for (const flow of [false, true]) {
    const timers = [], listeners = {}, head = [], body = []
    let prints = 0
    const document = {title: 'Dashboard app', getElementById: () => null,
      createElement: () => ({style: {}, remove() {this.removed = true}}),
      head: {appendChild: element => head.push(element)}, body: {appendChild: element => body.push(element)}}
    const window = {setTimeout: callback => timers.push(callback), print: () => prints++,
      addEventListener: (name, callback) => {listeners[name] = callback}, removeEventListener: name => {delete listeners[name]}}
    const helper = load('src/lib/reportExport.ts', {}, {document, window})
    helper.exportReportToPdf('Dashboard_2026-10-01_to_2026-10-31', '<p>Visible totals</p>', {flow})
    assert.equal(document.title, 'Dashboard_2026-10-01_to_2026-10-31')
    assert.match(head[0].textContent, flow ? /position: static/ : /position: fixed/)
    if (flow) assert.match(head[0].textContent, /height: auto !important; overflow: visible !important/)
    timers.shift()()
    assert.equal(prints, 1)
    listeners.afterprint()
    assert.equal(document.title, 'Dashboard app')
    timers.shift()()
    assert.equal(head[0].removed, true)
    assert.equal(body[0].removed, true)
  }
})

test('November gross sums recorded EOD gross once and explains tax/tips and date coverage', () => {
 const fixture = dashboardFixture({period:'monthly',refDate:'2026-11-26T12:00:00',reports:[
  {id:'nov-1',session_date:'2026-11-01',revenue_total:100,sales_tax:10,tip_total:20,tip_distributions:[]},
  {id:'nov-2',session_date:'2026-11-24',revenue_total:200,sales_tax:20,tip_total:40,tip_distributions:[]},
  {id:'oct',session_date:'2026-10-31',revenue_total:999,sales_tax:0,tip_total:0,tip_distributions:[]},
 ],payrollRuns:[]})
 assert.match(fixture.html,/Gross Revenue<\/p>[\s\S]*?\$300\.00/)
 assert.match(fixture.html,/Net revenue \+ sales tax \+ tips collected/)
 assert.match(fixture.html.replace(/<!--.*?-->/g,''),/latest 2026-11-24/)
})
