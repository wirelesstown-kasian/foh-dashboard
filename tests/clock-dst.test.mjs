import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createRequire } from 'node:module'
import { load } from './helpers/dashboard-fixture.mjs'

const require = createRequire(import.meta.url)
const clock = load('src/lib/clockUtils.ts')
const { calculateDailyTipPreview, getClockTipRecalculationDates } = load('src/lib/dailyTips.ts')
const { buildPayrollDraftRows } = load('src/lib/payroll.ts')

function pageFunctions(file, names) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const source = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    .map(node => node.getText(ast)).join('\n')
  const exports = {}
  vm.runInNewContext(ts.transpileModule(`${source}\nexport { ${names.join(',')} }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Date, ...clock })
  return exports
}

const employee = id => ({ id, name: id, role: 'server', primary_department: 'server',
  schedule_departments: ['server'], tip_eligible: true, hourly_wage: 10,
  guaranteed_hourly: 0, is_active: true, payment_method: 'ach' })
const shift = (id, out = '2026-11-01T07:15:16.046Z') => ({
  id, employee_id: id, session_date: '2026-10-31',
  clock_in_at: '2026-10-31T22:09:07.390Z', clock_out_at: out,
  approval_status: 'approved', auto_clock_out: false, manager_note: '[work_department=server]',
  break_started_at: null, break_ended_at: null, break_minutes: 0,
})

test('Chicago clock conversion, labels and business cutoffs are independent of device timezone', () => {
  const originalTz = process.env.TZ
  try {
    for (const zone of ['UTC', 'America/Chicago', 'America/Los_Angeles', 'Asia/Seoul']) {
      process.env.TZ = zone
      assert.equal(clock.isoToTimeInput('2026-11-01T07:15:16.046Z'), '01:15', zone)
      assert.equal(clock.isoToTimeValue('2026-11-01T06:15:16Z'), '01:15:16', zone)
      assert.match(clock.formatClockTime('2026-11-01T06:15:00Z'), /CDT/, zone)
      assert.match(clock.formatClockTime('2026-11-01T07:15:00Z'), /CST/, zone)
      assert.equal(clock.timeInputToIso('2026-10-31', '02:15'), '2026-11-01T08:15:00.000Z', zone)
      assert.equal(clock.timeInputToIso('2026-10-31', '17:09'), '2026-10-31T22:09:00.000Z', zone)
      assert.equal(clock.getSessionCutoffIso('2026-10-31'), '2026-11-01T09:00:00.000Z', zone)
      assert.equal(clock.getSessionCutoffIso('2026-03-07'), '2026-03-08T08:00:00.000Z', zone)
    }
  } finally {
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  }
})

test('both repeated hours are selectable; untouched timestamps keep their exact original instant', () => {
  assert.deepEqual(Array.from(clock.getClockTimeOptions('2026-10-31', '01:15')), [
    '2026-11-01T06:15:00.000Z', '2026-11-01T07:15:00.000Z',
  ])
  for (const original of ['2026-11-01T06:15:16.046Z', '2026-11-01T07:15:16.046+00:00']) {
    assert.equal(clock.timeInputToIso('2026-10-31', '01:15', original), original)
  }
  assert.equal(clock.timeInputToIso('2026-10-31', '01:15', null, 'later'), '2026-11-01T07:15:00.000Z')
  assert.equal(clock.timeInputToIso('2026-10-31', '01:15', '2026-11-01T07:15:00Z', 'earlier'), '2026-11-01T06:15:00.000Z')
  assert.equal(clock.timeInputToIso('2026-10-31', '01:20', '2026-11-01T07:15:16Z'), '2026-11-01T07:20:00.000Z')
  assert.equal(clock.timeInputToIso('2026-03-07', '02:15'), null)
  assert.equal(clock.timeInputToIso('2026-02-30', '17:00'), null)
  assert.equal(clock.timeInputToIso('2026-10-31', ''), null)
})

test('hours and unpaid breaks use elapsed time across fall and spring transitions', () => {
  assert.equal(clock.calculateClockHours('2026-10-31T17:00:00-05:00', '2026-11-01T01:15:00-05:00'), 8.25)
  assert.equal(clock.calculateClockHours('2026-10-31T17:00:00-05:00', '2026-11-01T01:15:00-06:00'), 9.25)
  assert.equal(clock.calculateClockHoursAfterBreak('2026-10-31T17:00:00-05:00', '2026-11-01T02:15:00-06:00', 30), 9.75)
  assert.equal(clock.calculateClockHours('2026-03-07T23:00:00-06:00', '2026-03-08T03:00:00-05:00'), 3)
  assert.equal(clock.getMealBreakState({ break_started_at: '2026-11-01T01:45:00-05:00',
    break_ended_at: '2026-11-01T01:15:00-06:00' }).minutes, 30)
})

test('Clock Records preview preserves second 1 AM, seconds, and recorded break deduction on unrelated edits', () => {
  const page = pageFunctions('src/app/reporting/clock-records/page.tsx',
    ['getBreakMinutes', 'getClockEditIso', 'getEditedBreakMinutes', 'getClockEditHours', 'getQuickMealBreakEdit'])
  const record = { ...shift('a'), break_started_at: '2026-10-31T23:00:01Z',
    break_ended_at: '2026-10-31T23:30:59Z', break_minutes: 30 }
  const edit = { sessionDate: record.session_date, clockIn: '17:09', clockOut: '01:15',
    mealBreakStart: '18:00', mealBreakEnd: '18:30', regularBreakStart: '', regularBreakEnd: '', note: 'Checked' }
  assert.equal(page.getClockEditIso(record, edit, 'clockOut'), record.clock_out_at)
  assert.equal(page.getEditedBreakMinutes(record, edit), 30)
  assert.equal(page.getClockEditHours(record, edit), clock.getEffectiveClockHours(record))
  assert.equal(page.getClockEditHours(record, { ...edit, occurrences: { clockOut: 'earlier' } }), 7.6)
  const fallMeal = page.getQuickMealBreakEdit(record, edit, '01:45', 'earlier')
  assert.equal(fallMeal.mealBreakEnd, '01:15')
  assert.equal(fallMeal.occurrences.mealBreakEnd, 'later')
  assert.equal(page.getEditedBreakMinutes(record, fallMeal), 30)
})

test('Payroll Payouts keeps original punches on open/save and detects explicit DST occurrence changes', () => {
  const page = pageFunctions('src/app/reporting/payroll-payouts/page.tsx', ['getEditedClockHours', 'clockEditChanged'])
  const record = shift('a')
  const edit = { clockIn: '17:09', clockOut: '01:15' }
  assert.equal(page.clockEditChanged(record, edit), false)
  assert.equal(page.getEditedClockHours(record, edit), clock.getEffectiveClockHours(record))
  const earlier = { ...edit, occurrences: { clockOut: 'earlier' } }
  assert.equal(page.clockEditChanged(record, earlier), true)
  assert.equal(page.getEditedClockHours(record, earlier), 8.1)
})

test('editing one employee changes shared tips but preserves every other employee clock and wage hours', () => {
  const employees = [employee('a'), employee('b')]
  const records = [shift('a'), shift('b', '2026-11-01T06:15:16.046Z')]
  const before = JSON.stringify(records)
  const updated = records.map(record => record.id === 'a'
    ? { ...record, clock_out_at: clock.timeInputToIso(record.session_date, '01:30', record.clock_out_at) }
    : record)
  const report = { id: 'report', session_date: '2026-10-31', tip_total: 200, tip_distributions: [] }
  const originalTips = calculateDailyTipPreview({ employees, clockRecords: records, report })
  const nextTips = calculateDailyTipPreview({ employees, clockRecords: updated, report })
  assert.notEqual(nextTips.get('b').tips, originalTips.get('b').tips)
  assert.equal(nextTips.get('b').hours, originalTips.get('b').hours)
  assert.equal(updated[1], records[1])
  assert.equal(JSON.stringify(records), before)
  const args = { employees, eodReports: [report], department: 'server', startDate: '2026-10-31', endDate: '2026-10-31' }
  const oldWage = buildPayrollDraftRows({ ...args, clockRecords: records }).find(row => row.employee_id === 'b')
  const newWage = buildPayrollDraftRows({ ...args, clockRecords: updated }).find(row => row.employee_id === 'b')
  assert.equal(newWage.hours, oldWage.hours)
  assert.equal(newWage.base_wages, oldWage.base_wages)
})

test('notes, unchanged hours, and kitchen clocks never rebuild the shared server tip distribution', () => {
  const employees = [employee('a'), { ...employee('cook'), tip_eligible: false, primary_department: 'cook' }]
  const record = shift('a')
  const dates = (previous, next) => Array.from(getClockTipRecalculationDates({ previous, next, employees }))
  assert.deepEqual(dates(record, { ...record, manager_note: 'Photo checked [work_department=server]' }), [])
  assert.deepEqual(dates(record, { ...record, clock_in_at: '2026-10-31T22:10:07.390Z', clock_out_at: '2026-11-01T07:16:16.046Z' }), [])
  const cook = { ...shift('cook'), manager_note: '[work_department=cook]' }
  assert.deepEqual(dates(cook, { ...cook, clock_out_at: '2026-11-01T08:00:00Z' }), [])
  assert.deepEqual(dates(null, cook), [])
  assert.deepEqual(dates(cook, null), [])
  assert.deepEqual(dates(record, { ...record, clock_out_at: '2026-11-01T07:30:00Z' }), ['2026-10-31'])
  assert.deepEqual(dates(record, { ...record, session_date: '2026-11-01' }), ['2026-10-31', '2026-11-01'])
  assert.deepEqual(dates(null, record), ['2026-10-31'])
  assert.deepEqual(dates(record, null), ['2026-10-31'])
})

test('time editor shows both named DST occurrences and selects the original second occurrence', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const { ClockTimeInput } = load('src/components/reporting/ClockTimeInput.tsx', {
    '@/components/ui/input': { Input: props => React.createElement('input', props) },
  })
  const html = renderToStaticMarkup(React.createElement(ClockTimeInput, { sessionDate: '2026-10-31',
    value: '01:15', originalIso: '2026-11-01T07:15:16Z', label: 'Clock out', onChange() {}, onOccurrenceChange() {} }))
  assert.match(html, /CDT.*first/)
  assert.match(html, /CST.*second/)
  assert.match(html, /value="later" selected=""/)
  assert.match(html, /aria-label="Clock out daylight saving occurrence"/)
})
