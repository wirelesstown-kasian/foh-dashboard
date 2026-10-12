import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'

const nodeRequire = createRequire(import.meta.url)

function loadTypeScript(filename, imports, globals = {}) {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  vm.runInNewContext(output, {
    exports,
    require: (name) => imports[name] ?? nodeRequire(name),
    Buffer,
    process: { env: globals.env ?? {} },
    Date: globals.Date ?? Date,
  }, { filename })
  return exports
}

function setup(env = { APP_SESSION_SECRET: 'a-private-test-secret' }, employee = { id: 'manager-id' }) {
  const appAuth = loadTypeScript('src/lib/appAuth.ts', {}, { env })
  const supabaseAdmin = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: employee, error: null }) }),
          }),
        }),
      }),
    }),
  }
  const adminSession = loadTypeScript('src/lib/adminSession.ts', {
    '@/lib/appAuth': appAuth,
    '@/lib/supabaseAdmin': { supabaseAdmin },
  }, { env })
  return { appAuth, adminSession }
}

test('arbitrary old-style manager cookies are rejected', () => {
  const { adminSession } = setup()
  assert.equal(adminSession.isValidAdminSession('a'.repeat(64)), false)
  assert.equal(adminSession.isValidAdminSession('1000000000000'), false)
})

test('manager session requires a valid signature, expiry, and active manager', async () => {
  const { adminSession } = setup()
  const token = adminSession.createAdminSessionValue('manager-id')
  assert.equal(adminSession.isValidAdminSession(token), true)
  assert.equal(await adminSession.hasManagerAccess(token), true)
  const wrongLastCharacter = token.endsWith('x') ? 'y' : 'x'
  assert.equal(adminSession.isValidAdminSession(`${token.slice(0, -1)}${wrongLastCharacter}`), false)

  const demoted = setup(undefined, null).adminSession
  assert.equal(await demoted.hasManagerAccess(token), false)

  const originalNow = Date.now
  try {
    Date.now = () => originalNow() + 9 * 60 * 60 * 1000
    assert.equal(adminSession.isValidAdminSession(token), false)
  } finally {
    Date.now = originalNow
  }
})

test('app sessions refuse a public-only or missing secret', () => {
  const publicOnly = setup({ NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-key' })
  assert.throws(() => publicOnly.appAuth.createAppSessionValue({ employeeId: 'a', role: 'manager', name: 'A', email: null }))
  assert.throws(() => setup({}).appAuth.createAppSessionValue({ employeeId: 'a', role: 'manager', name: 'A', email: null }))
})

test('dashboard permissions use current employee role and reject inactive or disabled logins', async () => {
  const env = { APP_SESSION_SECRET: 'a-private-test-secret' }
  const appAuth = loadTypeScript('src/lib/appAuth.ts', {}, { env })
  const cookie = appAuth.createAppSessionValue({ employeeId: 'employee-id', role: 'manager', name: 'Test', email: null })
  let employee = { id: 'employee-id', role: 'server', is_active: true, login_enabled: true }
  const supabaseAdmin = { from: () => {
    const filters = []
    const query = {
      select: () => query,
      eq: (key, value) => { filters.push([key, value]); return query },
      maybeSingle: async () => ({ data: filters.every(([key, value]) => employee[key] === value) ? employee : null, error: null }),
    }
    return query
  } }
  const auth = loadTypeScript('src/lib/routeAuth.ts', {
    'next/headers': { cookies: async () => ({ get: name => name === appAuth.APP_SESSION_COOKIE ? { value: cookie } : undefined }) },
    '@/lib/appAuth': appAuth,
    '@/lib/adminSession': { ADMIN_SESSION_COOKIE: 'foh_admin_session', getAdminSessionEmployeeId: () => null },
    '@/lib/supabaseAdmin': { supabaseAdmin },
  }, { env })
  assert.equal((await auth.getDashboardViewer()).isManager, false)
  employee = { ...employee, is_active: false }
  assert.equal(await auth.getDashboardViewer(), null)
  employee = { ...employee, is_active: true, login_enabled: false }
  assert.equal(await auth.getDashboardViewer(), null)
  employee = { ...employee, login_enabled: true, role: 'manager' }
  assert.equal((await auth.getDashboardViewer()).isManager, true)
})
