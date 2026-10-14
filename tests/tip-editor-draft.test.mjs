import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const date = '2026-10-13'
const server = { id: 'server', name: 'Alice', role: 'server', primary_department: 'server', tip_eligible: true }
const clock = {
  employee_id: 'server', session_date: date, approval_status: 'approved', manager_note: null,
  clock_in_at: '2026-10-13T17:00:00Z', clock_out_at: '2026-10-13T22:00:00Z',
}
const report = { id: 'report', session_date: date, tip_total: 100, tip_distributions: [] }

function load(filename, overrides) {
  const exports = {}
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  vm.runInNewContext(output, {
    exports, Date, Intl, Error,
    require: name => overrides[name] ?? (name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`, overrides) : require(name)),
  }, { filename })
  return exports
}

// Render the actual editor with read-only reporting fixtures. Hooks provide
// data and local state; all writes throw if the page tries to save on load.
function renderEditor({ reports = [report], employees = [server], clocks = [clock], edits = null, totalTipInput = '' } = {}) {
  let stateIndex = 0
  const states = [date, totalTipInput, edits]
  const elements = names => Object.fromEntries(names.map(name => [name, ({ children }) => React.createElement('div', null, children)]))
  const exports = load('src/app/payroll/tip-distribution-editor/page.tsx', {
    react: {
      ...React, useEffect() {}, useMemo: calculate => calculate(),
      useState: initial => [stateIndex < states.length ? states[stateIndex++] : initial, () => {}],
    },
    'next/link': { default: ({ children }) => React.createElement('a', null, children) },
    '@/components/layout/AdminSubpageHeader': { AdminSubpageHeader: () => null },
    '@/components/reporting/useReportingData': {
      useEmployees: () => employees, useClockRecords: () => ({ clockRecords: clocks }),
      useEodReports: () => ({ eodReports: reports }), usePayrollRuns: () => ({ payrollRuns: [] }),
    },
    '@/lib/supabase': { supabase: { from() { throw new Error('Rendering must not write data') } } },
    '@/components/ui/badge': elements(['Badge']),
    '@/components/ui/button': { Button: ({ children, disabled }) => React.createElement('button', { disabled }, children) },
    '@/components/ui/input': { Input: ({ value, placeholder }) => React.createElement('input', { value, placeholder, readOnly: true }) },
    '@/components/ui/label': elements(['Label']),
    '@/components/ui/table': elements(['Table', 'TableBody', 'TableCell', 'TableHead', 'TableHeader', 'TableRow']),
    'lucide-react': Object.fromEntries(['ArrowLeft', 'ChevronLeft', 'ChevronRight', 'Save'].map(name => [name, () => null])),
  })
  return renderToStaticMarkup(React.createElement(exports.default))
}

test('missing distributions show a clock-based draft and allow an explicit save', () => {
  const html = renderEditor()
  assert.match(html, /Alice/)
  assert.match(html, /5\.00/)
  assert.match(html, /\$85\.00/)
  assert.match(html, /No employee tip distributions have been saved/)
  assert.match(html, /<button> Save Distribution<\/button>/)
})

test('saved distribution rows take priority over different current clock hours', () => {
  const html = renderEditor({ reports: [{ ...report, tip_distributions: [{ employee_id: 'server', hours_worked: 3, net_tip: 85 }] }] })
  assert.match(html, /3\.00/)
  assert.doesNotMatch(html, /No employee tip distributions have been saved/)
})

test('clock drafts exclude other dates, open clocks, and ineligible staff', () => {
  const html = renderEditor({
    employees: [server, { ...server, id: 'cook', name: 'Cook', role: 'kitchen', primary_department: 'kitchen', tip_eligible: false }],
    clocks: [
      { ...clock, session_date: '2026-10-12' },
      { ...clock, approval_status: 'open', clock_out_at: null },
      { ...clock, employee_id: 'cook' },
    ],
  })
  assert.match(html, /No tip rows for this date/)
  assert.doesNotMatch(html, /No employee tip distributions have been saved/)
  assert.match(html, /<button disabled=""> Save Distribution<\/button>/)
})

test('clock rows do not create distributions when the date has no EOD report', () => {
  const html = renderEditor({ reports: [] })
  assert.match(html, /No EOD report exists/)
  assert.match(html, /No tip rows for this date/)
  assert.doesNotMatch(html, /Alice/)
})

test('local edits remain visible when saved distributions are absent', () => {
  const html = renderEditor({ edits: [{ employee_id: 'server', name: 'Edited Alice', hours_worked: 4, adjustment: 0, memo: '' }] })
  assert.match(html, /Edited Alice/)
  assert.match(html, /4\.00/)
})

test('saved manual tip allocations are displayed without being rebalanced on open', () => {
  const bob = { ...server, id: 'bob', name: 'Bob' }
  const html = renderEditor({ employees: [server, bob], clocks: [clock, { ...clock, employee_id: 'bob' }],
    reports: [{ ...report, tip_distributions: [
      { employee_id: 'server', hours_worked: 5, net_tip: 60, house_deduction: 7.5 },
      { employee_id: 'bob', hours_worked: 5, net_tip: 25, house_deduction: 7.5 },
    ] }] })
  assert.match(html, /\$60\.00/)
  assert.match(html, /\$25\.00/)
  assert.doesNotMatch(html, /\$42\.50/)
})

test('clock-based tip drafts honor employee hourly tip caps', () => {
  const bob = { ...server, id: 'bob', name: 'Bob' }
  const html = renderEditor({ employees: [{ ...server, tip_pool_hourly_rate: 4 }, bob], clocks: [clock, { ...clock, employee_id: 'bob' }] })
  assert.match(html, /\$20\.00/)
  assert.match(html, /\$65\.00/)
  assert.doesNotMatch(html, /\$42\.50/)
})

test('an entirely capped tip pool shows its unallocated amount without increasing employee tips', () => {
  const bob = { ...server, id: 'bob', name: 'Bob', tip_pool_hourly_rate: 4 }
  const html = renderEditor({ employees: [{ ...server, tip_pool_hourly_rate: 4 }, bob], clocks: [clock, { ...clock, employee_id: 'bob' }] })
  assert.match(html, /\$20\.00/)
  assert.match(html, /\$45\.00 remains unallocated/)
  assert.match(html, /<button> Save Distribution<\/button>/)
})
