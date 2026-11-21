import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const { NextRequest } = require('next/server')

function load(path, dependencies = {}) {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  new Function('exports', 'require', code)(exports, name => dependencies[name] ?? require(name))
  return exports
}

test('quick additions use the signed-in manager, while saving and printing require a valid PIN', async () => {
  const calls = []
  let isManager = true
  const supabaseAdmin = {
    rpc: async (name, args) => { calls.push({ name, args }); return { data: [] } },
    from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({
      data: [{ id: 'authorizer', pin_code: '4321' }],
    }) }) }) }),
  }
  const { POST } = load('app/api/check-writer/route.ts', {
    '@/lib/checkWriter': load('lib/checkWriter.ts'),
    '@/lib/validation': load('lib/validation.ts'),
    '@/lib/payroll': {}, '@/lib/appSettings': {}, '@/lib/pin': {},
    '@/lib/routeAuth': { getDashboardViewer: async () => ({ employeeId: 'signed-in', isManager }) },
    '@/lib/supabaseAdmin': { supabaseAdmin },
  })
  const post = (action, data, pin) => POST(new NextRequest('https://test.invalid/api/check-writer', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data, pin }),
  }))
  assert.equal((await post('save', { source: 'app' })).status, 400)
  assert.equal((await post('prepare', {})).status, 400)
  assert.equal((await post('save_and_print', { source: 'app', quick_add: true })).status, 400)
  assert.equal((await post('print', {})).status, 400)
  assert.equal((await post('reprint', {})).status, 400)
  assert.equal((await post('save_vendor', { id: 'existing', quick_add: true })).status, 400)
  assert.equal(calls.length, 0)

  for (const action of ['save_vendor', 'save_category']) {
    assert.equal((await post(action, { name: 'Temporary', quick_add: true, address: 'ignored' })).status, 200)
    assert.deepEqual(calls.at(-1), {
      name: 'check_writer_change',
      args: { p_action: action, p_actor: 'signed-in', p_data: { name: 'Temporary' } },
    })
  }
  assert.equal((await post('save_and_print', { source: 'app' }, '0000')).status, 401)
  assert.equal((await post('save_and_print', { source: 'app' }, '4321')).status, 200)
  assert.equal(calls.at(-1).name, 'check_writer_save_and_print')
  assert.equal(calls.at(-1).args.p_actor, 'authorizer')

  isManager = false
  assert.equal((await post('save_vendor', { name: 'Blocked', quick_add: true })).status, 403)
})
