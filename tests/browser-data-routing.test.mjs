import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createRequire } from 'node:module'

const nodeRequire = createRequire(import.meta.url)

test('browser Supabase client routes table reads through the dashboard without forwarding the public key', async () => {
  const source = fs.readFileSync('src/lib/supabase.ts', 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  let request
  const exports = {}
  vm.runInNewContext(output, {
    exports,
    require: nodeRequire,
    process: { env: {} },
    window: {},
    URL, Headers, Request, Response,
    fetch: async (url, options) => {
      request = { url, options }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    },
  })

  const result = await exports.supabase.from('employees').select('id,name')
  assert.equal(result.error, null)
  assert.equal(request.url, '/api/dashboard-data/employees?select=id%2Cname')
  assert.equal(request.options.credentials, 'same-origin')
  assert.equal(request.options.headers.has('apikey'), false)
  assert.equal(request.options.headers.has('authorization'), false)
})

test('browser Supabase client routes table writes through the signed dashboard endpoint', async () => {
  const source = fs.readFileSync('src/lib/supabase.ts', 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  let request
  const exports = {}
  vm.runInNewContext(output, {
    exports,
    require: nodeRequire,
    process: { env: {} },
    window: {},
    URL, Headers, Request, Response,
    fetch: async (url, options) => {
      request = { url, options }
      return new Response(null, { status: 201 })
    },
  })

  const result = await exports.supabase.from('daily_sessions').insert({ session_date: '2026-10-02', current_phase: 'pre_shift' })
  assert.equal(result.error, null)
  assert.equal(request.url, '/api/dashboard-data/daily_sessions')
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.credentials, 'same-origin')
  assert.equal(request.options.headers.has('apikey'), false)
  assert.equal(request.options.headers.has('authorization'), false)
})
