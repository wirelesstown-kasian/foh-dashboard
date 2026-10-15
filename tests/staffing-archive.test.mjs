import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import {createRequire} from 'node:module'

const require = createRequire(import.meta.url)
const React = require('react')
const {NextRequest} = require('next/server')
const bcrypt = require('bcryptjs')
const archived = {
  id: 'archived', name: 'Archived Bob', role: 'server', is_active: false,
  pin_code: '9876', pin_hash: bcrypt.hashSync('9876', 4), login_enabled: false, login_password_hash: null,
  phone: '555-0102', email: 'bob@example.invalid', address: 'Archived address',
  primary_department: 'server', schedule_departments: ['server'], hourly_wage: 10,
  guaranteed_hourly: 20, tip_pool_hourly_rate: 30, tip_eligible: true,
  meal_break_threshold_hours: 7.5, commission_enabled: true, commission_note: 'Saved commission',
  payment_method: 'ach', birth_date: '1990-01-01', created_at: '2025-01-01T00:00:00Z',
}
const active = {...archived, id: 'active', name: 'Active Alice', is_active: true, login_enabled: true}

function load(file, overrides = {}, globals = {}) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true},
  }).outputText
  vm.runInNewContext(code, {
    exports, Date, Intl, Error, Object, ...globals,
    require: name => overrides[name] ?? (name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`, overrides, globals) : require(name)),
  }, {filename: file})
  return exports
}

function setup(options = {}) {
  const employees = structuredClone([active, archived])
  const updates = []
  const reads = []
  let updateAttempts = 0
  const db = {from(table) {
    assert.equal(table, 'employees', 'staffing status must not modify connected history tables')
    const filters = []
    let columns = '*', values, one = false
    const query = {
      select(value) {columns = value; return this}, order() {return this},
      eq(key, value) {filters.push(row => row[key] === value); return this},
      update(value) {values = value; return this},
      maybeSingle() {one = true; return this},
      then(resolve) {
        if (values) updateAttempts++
        if (options.missingPinCode && (columns.includes('pin_code') || (values && 'pin_code' in values))) {
          return Promise.resolve({data: null, error: {message: 'column pin_code does not exist'}}).then(resolve)
        }
        if (values && options.updateError) return Promise.resolve({data: null, error: {
          message: options.updateErrorCode === '23505' ? 'duplicate key value violates unique constraint employees_active_pin_code_unique_idx' : 'Write failed',
          code: options.updateErrorCode,
        }}).then(resolve)
        if (!values && options.readError) return Promise.resolve({data: null, error: {message: 'Read failed'}}).then(resolve)
        const rows = employees.filter(row => filters.every(filter => filter(row)))
        if (values) {
          updates.push(structuredClone(values))
          if (options.statusChanged) return Promise.resolve({data: null, error: null}).then(resolve)
          for (const row of rows) Object.assign(row, values)
        } else reads.push(columns)
        const projected = rows.map(row => Object.fromEntries(columns.split(',').map(key => key.trim()).map(key => [key, row[key]])))
        return Promise.resolve({data: one ? projected[0] ?? null : projected, error: null}).then(resolve)
      },
    }
    return query
  }}
  const route = load('src/app/api/employees/route.ts', {
    'next/headers': {cookies: async () => ({get: () => ({value: 'test'})})},
    '@/lib/adminSession': {ADMIN_SESSION_COOKIE: 'manager', hasManagerAccess: async () => options.authorized !== false},
    '@/lib/supabaseAdmin': {supabaseAdmin: db},
    '@/lib/appSettings': {getAppSettings: async () => {throw Error('Reactivation must preserve role and department settings')}},
  })
  const get = (status = '') => route.GET(new NextRequest(`http://app.test/api/employees${status ? `?status=${status}` : ''}`))
  const patch = payload => route.PATCH(new NextRequest('http://app.test/api/employees', {method: 'PATCH', body: JSON.stringify(payload)}))
  return {route, get, patch, employees, updates, reads, updateAttempts: () => updateAttempts}
}

test('employee status views are manager-only and default to active staff', async () => {
  const setupState = setup()
  for (const [status, expected] of [['', ['active']], ['archived', ['archived']], ['all', ['active', 'archived']]]) {
    const response = await setupState.get(status)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.employees.map(row => row.id), expected)
    assert.ok(body.employees.every(row => !('pin_hash' in row) && !('login_password_hash' in row)))
  }
  assert.equal((await setupState.get('invalid')).status, 400)
  const denied = setup({authorized: false})
  assert.equal((await denied.get('all')).status, 401)
  assert.equal((await denied.patch({action: 'reactivate', id: 'archived', pin: '2468'})).status, 401)
  assert.equal(denied.reads.length, 0)
  assert.equal(denied.updates.length, 0)
})

test('reactivation preserves the employee ID, profile, pay settings, and connected history', async () => {
  const state = setup()
  const before = structuredClone(state.employees[1])
  const response = await state.patch({action: 'reactivate', id: 'archived', pin: '2468'})
  assert.equal(response.status, 200)
  assert.equal((await response.json()).reactivated, true)
  const changed = state.employees[1]
  for (const key of Object.keys(before).filter(key => !['is_active', 'pin_code', 'pin_hash'].includes(key))) {
    assert.deepEqual(changed[key], before[key], `${key} must be preserved`)
  }
  assert.equal(changed.is_active, true)
  assert.equal(changed.login_enabled, false)
  assert.equal(changed.login_password_hash, null)
  assert.equal(await bcrypt.compare('2468', changed.pin_hash), true)
  assert.deepEqual(Object.keys(state.updates[0]).sort(), ['is_active', 'login_enabled', 'login_password_hash', 'pin_code', 'pin_hash'].sort())
  assert.deepEqual((await (await state.get()).json()).employees.map(row => row.id), ['active', 'archived'])
  assert.equal((await (await state.get('archived')).json()).employees.length, 0)
})

test('PIN conflicts, including hash-only active PINs, block reactivation without a write', async () => {
  for (const hashOnly of [false, true]) {
    const state = setup()
    if (hashOnly) state.employees[0].pin_code = null
    const response = await state.patch({action: 'reactivate', id: 'archived', pin: '9876'})
    assert.equal(response.status, 409)
    assert.match((await response.json()).error, /PIN already belongs/)
    assert.equal(state.updates.length, 0)
    assert.equal(state.employees[1].is_active, false)
  }
})

test('reactivation rejects invalid requests and does not overwrite an already active employee', async () => {
  for (const [payload, status] of [
    [{action: 'reactivate', id: 'archived', pin: '123'}, 400],
    [{action: 'reactivate', pin: '2468'}, 400],
    [{action: 'reactivate', id: 'missing', pin: '2468'}, 404],
    [{action: 'reactivate', id: 'active', pin: '2468'}, 409],
    [{action: 'reactivate', id: 'archived', pin: '2468', hourly_wage: 99}, 400],
    [{action: 'unknown', id: 'archived'}, 400],
  ]) {
    const state = setup()
    assert.equal((await state.patch(payload)).status, status)
    assert.equal(state.updates.length, 0)
  }
  const changed = setup({statusChanged: true})
  assert.equal((await changed.patch({action: 'reactivate', id: 'archived', pin: '2468'})).status, 409)
  assert.equal(changed.employees[1].is_active, false)
  const concurrentPin = setup({updateError: true, updateErrorCode: '23505'})
  assert.equal((await concurrentPin.patch({action: 'reactivate', id: 'archived', pin: '2468'})).status, 409)
  assert.equal(concurrentPin.employees[1].is_active, false)
  assert.equal(concurrentPin.updateAttempts(), 1, 'a PIN conflict must not retry after stripping the chosen PIN')
})

test('legacy PIN-column fallback and database failures are handled without changing pay or schedules', async () => {
  const legacy = setup({missingPinCode: true})
  assert.equal((await legacy.get('archived')).status, 200)
  assert.equal((await legacy.patch({action: 'reactivate', id: 'archived', pin: '2468'})).status, 200)
  assert.equal(legacy.employees[1].is_active, true)
  assert.equal('pin_code' in legacy.updates[0], false)
  for (const options of [{readError: true}, {updateError: true}]) {
    const state = setup(options)
    assert.equal((await state.patch({action: 'reactivate', id: 'archived', pin: '2468'})).status, 500)
    assert.equal(state.employees[1].is_active, false)
  }
})

// Execute the actual component's event handlers with fixture-backed API routes.
// Browser hooks and presentation components are replaced; no external writes occur.
function tableHarness(state) {
  const states = [], effects = [], calls = []
  let cursor = 0, firstRender = true
  const elements = names => Object.fromEntries(names.map(name => [name, ({children}) => children]))
  const overrides = {
    react: {...React,
      useState(initial) {const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => {states[index] = typeof value === 'function' ? value(states[index]) : value}]},
      useCallback: callback => callback,
      useEffect: effect => {if (firstRender) effects.push(effect)},
    },
    '@/components/useAppSettings': {useAppSettings: () => ({roleDefinitions: [{key: 'server', label: 'Server'}], departmentDefinitions: [{key: 'server', label: 'Server'}]})},
    '@/components/ui/button': elements(['Button']), '@/components/ui/input': elements(['Input']),
    '@/components/ui/label': elements(['Label']), '@/components/ui/badge': elements(['Badge']),
    '@/components/ui/dialog': elements(['Dialog', 'DialogContent', 'DialogHeader', 'DialogTitle']),
    '@/components/ui/select': elements(['Select', 'SelectContent', 'SelectItem', 'SelectTrigger']),
    '@/components/ui/table': elements(['Table', 'TableBody', 'TableCell', 'TableHead', 'TableHeader', 'TableRow']),
  }
  const componentModule = load('src/components/staffing/EmployeeTable.tsx', overrides, {
    confirm: () => true,
    fetch: async (url, options = {}) => {
      calls.push({url, ...options})
      return options.method === 'PATCH' ? state.patch(JSON.parse(options.body)) : state.get('all')
    },
  })
  const render = () => {cursor = 0; const tree = componentModule.EmployeeTable(); firstRender = false; return tree}
  return {render, effects, calls, overrides}
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!React.isValidElement(tree)) return []
  return [tree, ...nodes(tree.props.children)]
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('')
  if (React.isValidElement(tree)) return text(tree.props.children)
  return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : ''
}

test('Staffing supports archived search, read-only profiles, PIN errors, and successful reactivation', async () => {
  const state = setup()
  const ui = tableHarness(state)
  ui.render()
  ui.effects.forEach(effect => effect())
  await new Promise(setImmediate)
  const table = tree => nodes(tree).find(node => node.type === ui.overrides['@/components/ui/table'].Table)
  let tree = ui.render()
  assert.match(text(table(tree)), /Active Alice/)
  assert.doesNotMatch(text(table(tree)), /Archived Bob/)
  nodes(tree).find(node => node.props['aria-pressed'] === false && text(node).startsWith('Archived')).props.onClick()
  tree = ui.render()
  assert.match(text(table(tree)), /Archived Bob/)
  assert.doesNotMatch(text(table(tree)), /Active Alice/)
  nodes(tree).find(node => node.props['aria-label'] === 'Search employees').props.onChange({target: {value: 'bob@example.invalid'}})
  tree = ui.render()
  assert.match(text(table(tree)), /Archived Bob/)
  nodes(tree).find(node => node.props.title === 'View archived profile').props.onClick()
  tree = ui.render()
  const profile = nodes(tree).find(node => node.type === ui.overrides['@/components/ui/dialog'].Dialog && node.props.open)
  assert.match(text(profile), /Archived Employee Profile/)
  assert.ok(nodes(profile).find(node => node.type === 'fieldset' && node.props.disabled))
  assert.ok(nodes(profile).some(node => node.props.value === 'Archived address'))
  assert.ok(nodes(profile).some(node => node.props.value === '20.00'))
  assert.doesNotMatch(text(profile), /Save Changes/)
  assert.equal(state.updates.length, 0)
  nodes(profile).find(node => text(node) === 'Close' && node.props.onClick).props.onClick()
  tree = ui.render()
  nodes(table(tree)).find(node => node.props.onClick && text(node).includes('Reactivate')).props.onClick()
  tree = ui.render()
  let dialog = nodes(tree).find(node => node.type === ui.overrides['@/components/ui/dialog'].Dialog && node.props.open)
  await nodes(dialog).find(node => node.props.onClick && text(node) === 'Reactivate Employee').props.onClick()
  tree = ui.render()
  assert.ok(nodes(tree).find(node => node.props.role === 'alert' && text(node).includes('PIN already belongs')))
  assert.equal(state.employees[1].is_active, false)
  nodes(tree).find(node => node.props.id === 'reactivate-pin').props.onChange({target: {value: '2468'}})
  tree = ui.render()
  dialog = nodes(tree).find(node => node.type === ui.overrides['@/components/ui/dialog'].Dialog && node.props.open)
  await nodes(dialog).find(node => node.props.onClick && text(node) === 'Reactivate Employee').props.onClick()
  tree = ui.render()
  assert.match(text(table(tree)), /Archived Bob/)
  assert.ok(nodes(tree).find(node => node.props.role === 'status' && text(node).includes('is active again')))
  assert.equal(state.employees[1].is_active, true)
  assert.ok(ui.calls.every(call => !call.method || call.method === 'PATCH'))
  assert.ok(ui.calls.filter(call => call.method === 'PATCH').every(call => Object.keys(JSON.parse(call.body)).sort().join() === 'action,id,pin'))
})
