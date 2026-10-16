import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import {createRequire} from 'node:module'
const require = createRequire(import.meta.url)
const React = require('react')
const {renderToStaticMarkup} = require('react-dom/server')

export function load(file, overrides = {}, globals = {}) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
  }).outputText
  vm.runInNewContext(code, {
    exports, Date, Intl, Error, ...globals,
    require: name => overrides[name] ?? (name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`, overrides, globals) : require(name)),
  }, {filename: file})
  return exports
}

export function dashboardFixture(options = {}) {
  const reports = options.reports ?? Array.from({length: 12}, (_, index) => ({
    id: `fixture-${index}`, session_date: `2026-${String(index + 1).padStart(2, '0')}-14`,
    revenue_total: 2000 + index * 100, sales_tax: 150, tip_total: 300, cash_total: 500,
    batch_total: 1500 + index * 100, delivery_order_amount: 100,
    tip_distributions: [{employee_id: 'fixture-employee', net_tip: 255}],
  }))
  const payrollRuns = options.payrollRuns ?? [{id: 'fixture-run', pay_date: '2026-10-14', total_cash: 0, total_check: 1000, total_ach: 0,
    payroll_run_items: [{tips: 255, payout_amount: 1000, net_pay: 1000, payment_method: 'check', department: 'server'}]}]
  const state = [options.period ?? 'monthly', new Date(options.refDate ?? '2026-10-15T12:00:00'), options.chart ?? 'net',
    options.start ?? '', options.end ?? '', [1], [], options.historical ?? {version: 1, sales: [], payroll: []}, options.historicalError ?? null,
    options.cashLoading ?? false, options.cashError ?? null]
  let cursor = 0, refIndex = 0
  const calls = []
  const Button = ({children, ...props}) => React.createElement('button', props, children)
  const page = load('src/app/reporting/dashboard/page.tsx', {
    react: {...React, useEffect() {}, useMemo: fn => fn(),
      useRef: () => ({current: refIndex++ === 0 ? options.source ?? {} : null}),
      useState: initial => [cursor < state.length ? state[cursor++] : initial, () => {}]},
    '@/components/layout/AdminSubpageHeader': {AdminSubpageHeader: ({title, subtitle, rightSlot}) => React.createElement('header', null, React.createElement('h1', null, title), subtitle, rightSlot)},
    '@/components/reporting/MissingTipDistributionNotice': {MissingTipDistributionNotice: () => null},
    '@/components/reporting/useReportingData': {
      useEodReports: () => ({eodReports: reports, loading: options.eodLoading ?? false, error: options.eodError ?? null}),
      useClockRecords: () => ({clockRecords: []}),
      usePayrollRuns: () => ({payrollRuns, loading: options.payrollLoading ?? false, error: null}),
    },
    '@/lib/dashboardPdf': {exportDashboardToPdf: (...args) => calls.push(args)},
    '@/lib/supabase': {supabase: {from() {throw Error('Fixture rendering must never access the database')}}},
    '@/components/ui/button': {Button},
    '@/components/ui/badge': {Badge: ({children, className}) => React.createElement('span', {className}, children)},
    '@/components/ui/label': {Label: ({children, className}) => React.createElement('label', {className}, children)},
    '@/components/ui/input': {Input: props => React.createElement('input', {...props, readOnly: true})},
  })
  const tree = page.default()
  const html = renderToStaticMarkup(tree)
  return {tree, html, calls}
}

export function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements)
  if (!React.isValidElement(tree)) return []
  return [tree, ...elements(tree.props.children), ...elements(tree.props.rightSlot)]
}
