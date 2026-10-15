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
    assert.match(fixture.html, /Payroll by department/)
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
