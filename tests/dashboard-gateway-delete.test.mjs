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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(code, {
    exports, require: name => overrides[name] ?? (name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : require(name)),
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.invalid' } },
    fetch: overrides.fetch, Date, Intl, URL, Headers, Request, Response, Error, ...overrides.globals,
  }, { filename: file })
  return exports
}

const reportId = '00000000-0000-0000-0000-000000000001'
const manager = { employeeId: 'manager', role: 'manager', isManager: true }
const staff = { employeeId: 'server', role: 'server', isManager: false }
function setup(viewer = manager, owner = 'server', reportDate = '2026-10-14', upstreamFetch) {
  const upstreamCalls = []
  const access = load('src/lib/dashboardDataAccess.ts')
  const route = load('src/app/api/dashboard-data/[table]/route.ts', {
    '@/lib/routeAuth': { getDashboardViewer: async () => viewer },
    '@/lib/supabaseAdmin': { getSupabaseAdminKey: () => 'private-test-key', supabaseAdmin: {} },
    '@/lib/dashboardDataAccess': { ...access, businessDateInChicago: () => '2026-10-14' },
    fetch: async (url, options) => {
      upstreamCalls.push({ url: new URL(url), ...options })
      if (upstreamFetch) return upstreamFetch(new URL(url), options)
      if (new URL(url).pathname.endsWith('/eod_reports')) {
        return Response.json([{ id: reportId, session_date: reportDate, closed_by_employee_id: owner, tip_total: 100 }])
      }
      return new Response(null, { status: 204 })
    },
  })
  const request = (method = 'DELETE', body, table = 'tip_distributions', query = `eod_report_id=eq.${reportId}`) => {
    const req = new NextRequest(`http://app.test/api/dashboard-data/${table}?${query}`, {
      method, ...(body === undefined ? {} : { body }), headers: { 'content-type': 'application/json' },
    })
    return route[method](req, { params: Promise.resolve({ table }) })
  }
  return { request, upstreamCalls, route }
}

test('manager tip replacement accepts a DELETE with no JSON body', async () => {
  const { request, upstreamCalls } = setup()
  const response = await request()
  assert.equal(response.status, 204)
  assert.equal(upstreamCalls.length, 1)
  assert.equal(upstreamCalls[0].method, 'DELETE')
  assert.equal(upstreamCalls[0].body, undefined)
  assert.equal(upstreamCalls[0].url.searchParams.get('eod_report_id'), `eq.${reportId}`)
})

// Run the real browser client, gateway, and page handlers against an in-memory
// PostgREST stand-in. No production rows or email providers are touched.
function setupSaveFlow({ failTips = false } = {}) {
  const state = {
    report: { id: reportId, session_date: '2026-10-14' },
    tips: [{ eod_report_id: reportId, employee_id: 'old-server', net_tip: 80 }],
    calls: [], error: null, notice: null, sent: null, currentReportId: null,
  }
  const { route } = setup(manager, 'server', '2026-10-14', async (url, options) => {
    const table = url.pathname.split('/').at(-1)
    state.calls.push(`${options.method} ${table}`)
    if (table === 'eod_reports') {
      if (options.method === 'PATCH') Object.assign(state.report, JSON.parse(options.body))
      if (options.method === 'GET' || options.headers.get('prefer')?.includes('return=representation')) {
        return Response.json({ ...state.report, tip_distributions: state.tips })
      }
      return new Response(null, { status: 204 })
    }
    if (table === 'schedules') return Response.json([])
    if (table === 'tip_distributions') {
      assert.equal(url.searchParams.get('eod_report_id'), options.method === 'DELETE' ? `eq.${reportId}` : null)
      if (options.method === 'DELETE') {
        assert.equal(options.body, undefined)
        state.tips = []
      }
      if (options.method === 'POST') {
        if (failTips) return Response.json({ message: 'Tip write failed' }, { status: 500 })
        state.tips.push(...JSON.parse(options.body))
      }
      return new Response(null, { status: options.method === 'POST' ? 201 : 204 })
    }
    throw new Error(`Unexpected table: ${table}`)
  })
  const { supabase } = load('src/lib/supabase.ts', {
    globals: { window: {} },
    fetch: async (path, options) => {
      assert.ok(String(path).startsWith('/api/dashboard-data/'))
      assert.equal(options.headers.has('authorization'), false)
      const req = new NextRequest(`http://app.test${path}`, options)
      const table = req.nextUrl.pathname.split('/').at(-1)
      return route[req.method](req, { params: Promise.resolve({ table }) })
    },
  })
  const globals = {
    supabase, ...load('src/lib/tipDistributionWrite.ts'),
    fetch: async (url, options) => {
      if (url.startsWith('/api/clock-events?')) return Response.json({ records: [] })
      const payload = JSON.parse(options.body)
      assert.equal(payload.report_id ?? payload.eod_report_id, reportId)
      state.calls.push(url)
      return Response.json(url === '/api/send-eod-email' ? { success: true, sent: 1 } : { success: true })
    },
    window: { localStorage: { removeItem() {} } },
    setSaveError: value => { state.error = value },
    setSaveNotice: value => { state.notice = value },
    setSubmitResult: value => { state.sent = value },
    setCurrentReportId: value => { state.currentReportId = value },
    setSaving() {}, setSubmitting() {}, setFinancialsSaved() {}, setTipDistributionSaved() {},
    setSubmissionComplete() {}, setShowConfirm() {}, load: async () => {},
    getFinancialDraftKey: date => date, getTipDraftKey: date => date,
    isoToTimeValue: value => value,
  }
  return { state, globals }
}

function pageHandlers(filename, names, globals) {
  const source = fs.readFileSync(filename, 'utf8')
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations = new Map()
  function visit(node) {
    if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(ast))) {
      declarations.set(node.name.getText(ast), node.initializer.getText(ast))
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  for (const name of names) assert.ok(declarations.has(name), `Missing ${name}`)
  const code = ts.transpileModule([...declarations].map(([name, value]) => `export const ${name} = ${value}`).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, Error, Date, ...globals }, { filename })
  return exports
}

function eodHandlers(globals, timing) {
  return pageHandlers('src/app/eod/page.tsx', ['handleSave', 'saveTipDistributions', 'sendEodEmails'], {
    ...globals, eodSendTiming: timing, today: '2026-10-14', existing: { id: reportId },
    form: { closed_by: 'server', cc_tip: '100', cash_tip: '0', memo: '' },
    batchTotal: 1000, cashTotal: 100, grossRevenue: 1100, startingCash: 200,
    tipTotal: 100, totalCashDeposit: 100, salesTax: 0,
    tipRows: [{ employee_id: 'server', hours_worked: 5 }],
    tipResults: [{ employee_id: 'server', tip_share: 100, house_deduction: 0, net_tip: 100 }],
  })
}

test('EOD re-save replaces tips on the same report and reaches the configured email handoff', async () => {
  for (const timing of ['after_save', 'manual']) {
    const { state, globals } = setupSaveFlow()
    const handlers = eodHandlers(globals, timing)
    await handlers.handleSave()
    assert.equal(state.error, null)
    assert.equal(state.report.id, reportId)
    assert.equal(state.currentReportId, reportId)
    assert.equal(state.tips.length, 1)
    assert.equal(state.tips[0].net_tip, 100)
    assert.deepEqual(state.calls.slice(0, 4), ['PATCH eod_reports', 'DELETE tip_distributions', 'POST tip_distributions', '/api/eod-sheet-sync'])
    assert.equal(state.calls.includes('/api/send-eod-email'), timing === 'after_save')
    if (timing === 'manual') await handlers.sendEodEmails(reportId)
    assert.equal(state.sent.success, true)
  }
})

test('EOD never sends an email when tip replacement fails', async () => {
  const { state, globals } = setupSaveFlow({ failTips: true })
  await eodHandlers(globals, 'after_save').handleSave()
  assert.equal(state.error, 'Tip write failed')
  assert.equal(state.calls.includes('/api/send-eod-email'), false)
  assert.equal(state.calls.includes('/api/eod-sheet-sync'), false)
})

test('manual EOD report edit replaces tips and completes without Invalid JSON', async () => {
  const { state, globals } = setupSaveFlow()
  const handlers = pageHandlers('src/app/reporting/eod-history/page.tsx', ['handleSave'], {
    ...globals, editingReportId: reportId,
    form: {
      session_date: '2026-10-14', closed_by_employee_id: 'server', cash_total: '100', batch_total: '1000',
      net_revenue: '1000', delivery_payment: '0', sales_tax: '0', cc_tip: '100', cash_tip: '0',
      actual_cash_on_hand: '100', variance_note: '', memo: '',
    },
    isFiniteCurrencyInput: value => Number.isFinite(Number(value)),
    getExpectedCashDeposit: cash => cash, getCashVariance: (actual, cash) => actual - cash,
    employees: [{ id: 'server' }], EMPLOYEE_PUBLIC_SELECT: 'id,name',
    aggregateClockRowsByEmployee: () => [{ employee_id: 'server', hours_worked: 5, start_time: '17:00', end_time: '22:00' }],
    calculateTips: () => [{ employee_id: 'server', tip_share: 100, house_deduction: 0, net_tip: 100 }],
    setReports() {}, notifyReportingDataChanged() {}, setDialogOpen() {}, setEditingReportId() {}, setForm() {},
    EMPTY_FORM: {}, formatCurrency: amount => `$${amount}`,
  })
  await handlers.handleSave('Manager')
  assert.equal(state.error, null)
  assert.match(state.notice, /EOD report saved/)
  assert.equal(state.report.id, reportId)
  assert.equal(state.tips.length, 1)
  assert.equal(state.tips[0].employee_id, 'server')
  assert.deepEqual(state.calls, ['PATCH eod_reports', 'GET schedules', 'DELETE tip_distributions', 'POST tip_distributions', 'GET eod_reports', '/api/eod-sheet-sync'])
})

test('staff can replace only their own current-day tips using a bodyless DELETE', async () => {
  const own = setup(staff)
  assert.equal((await own.request()).status, 204)
  assert.equal(own.upstreamCalls.at(-1).method, 'DELETE')
  for (const denied of [setup(staff, 'someone-else'), setup(staff, 'server', '2026-10-13')]) {
    assert.equal((await denied.request()).status, 403)
    assert.equal(denied.upstreamCalls.filter(call => call.method === 'DELETE').length, 0)
  }
})

test('missing auth, malformed JSON, and empty inserts or updates never reach a DB write', async () => {
  const anonymous = setup(null)
  assert.equal((await anonymous.request()).status, 401)
  assert.equal(anonymous.upstreamCalls.length, 0)
  for (const [method, body] of [['POST', undefined], ['PATCH', undefined], ['DELETE', '{bad'], ['POST', '{bad']]) {
    const { request, upstreamCalls } = setup()
    assert.equal((await request(method, body)).status, 400)
    assert.equal(upstreamCalls.length, 0)
  }
})
