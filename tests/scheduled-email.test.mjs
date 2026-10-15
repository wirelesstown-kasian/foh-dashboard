import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { NextRequest } = require('next/server')
function load(file, overrides = {}, env = { CRON_SECRET: 'test-cron', RESEND_API_KEY: 'test-email' }) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(code, {
    exports, process: { env }, Error, Date, URL, Headers, Request, Response,
    require: name => overrides[name] ?? require(name),
  }, { filename: file })
  return exports
}
const cronRequest = (authorized = true) => new NextRequest('http://app.test/api/cron/test', {
  headers: authorized ? { authorization: 'Bearer test-cron' } : {},
})

function scheduleSetup(results = [{ success: true, sent: 2 }], options = {}) {
  const marks = []
  const sends = []
  let queries = 0
  const publications = results.map((_, index) => ({ week_start: `2026-10-${String(5 + index * 7).padStart(2, '0')}`, week_end: '2026-10-11', scheduled_send_at: '2026-10-01T00:00:00Z' }))
  const route = load('src/app/api/cron/send-schedule-emails/route.ts', {
    '@/lib/appSettings': { getEmailSettings: async () => ({ queued_schedule_emails_enabled: options.enabled !== false }) },
    '@/lib/supabaseAdmin': { supabaseAdmin: { from(table) {
      assert.equal(table, 'schedule_publications')
      queries++
      let updating = false
      const query = {
        select() { return this }, lte() { return this }, is() { return this }, order() { return this },
        update() { updating = true; return this },
        eq(key, value) { if (updating) marks.push(value); return this },
        then(resolve) { return Promise.resolve(updating
          ? { error: options.markError ? { message: 'Mark failed' } : null }
          : { data: publications, error: null }).then(resolve) },
      }
      return query
    } } },
    '@/lib/scheduleEmail': { sendWeeklyScheduleEmails: async payload => {
      sends.push(payload)
      const result = results[sends.length - 1]
      if (result instanceof Error) throw result
      return result
    } },
  })
  return { route, sends, marks, queries: () => queries }
}

test('schedule cron requires its secret and respects the queue enable setting', async () => {
  const unauthorized = scheduleSetup()
  assert.equal((await unauthorized.route.GET(cronRequest(false))).status, 401)
  assert.equal(unauthorized.queries(), 0)
  assert.equal(unauthorized.sends.length, 0)
  const disabled = scheduleSetup(undefined, { enabled: false })
  assert.equal((await disabled.route.GET(cronRequest())).status, 200)
  assert.equal(disabled.queries(), 0)
})

test('schedule cron marks a publication sent only after actual recipient sends', async () => {
  const setup = scheduleSetup()
  const response = await setup.route.GET(cronRequest())
  assert.equal(response.status, 200)
  assert.equal((await response.json()).success, true)
  assert.deepEqual(setup.marks, ['2026-10-05'])
})

test('zero recipients and partial email failure leave a queued publication pending', async () => {
  for (const result of [{ success: true, sent: 0, message: 'No employees with email' }, { success: false, sent: 1, errors: ['Provider failure'] }]) {
    const setup = scheduleSetup([result])
    const response = await setup.route.GET(cronRequest())
    assert.equal(response.status, 207)
    assert.equal((await response.json()).success, false)
    assert.equal(setup.marks.length, 0)
  }
})

test('one failed schedule week does not prevent another queued week from sending', async () => {
  const setup = scheduleSetup([new Error('Schedule query failed'), { success: true, sent: 2 }])
  const response = await setup.route.GET(cronRequest())
  assert.equal(response.status, 207)
  assert.equal(setup.sends.length, 2)
  assert.deepEqual(setup.marks, ['2026-10-12'])
})

test('failure to record sent status is reported instead of silently succeeding', async () => {
  const setup = scheduleSetup(undefined, { markError: true })
  const response = await setup.route.GET(cronRequest())
  assert.equal(response.status, 207)
  assert.match((await response.json()).results[0].error, /failed to record sent status/)
})

test('weekly cron authenticates, calls the summary generator, and exposes provider errors', async () => {
  let calls = 0
  const makeRoute = fail => load('src/app/api/cron/send-weekly-summary-email/route.ts', {
    '@/lib/weeklySummaryEmail': { sendPreviousWeekSummaryEmail: async () => {
      calls++
      if (fail) throw new Error('Provider rejected summary')
      return { success: true }
    } },
  })
  assert.equal((await makeRoute(false).GET(cronRequest(false))).status, 401)
  assert.equal(calls, 0)
  assert.equal((await makeRoute(false).GET(cronRequest())).status, 200)
  const failed = await makeRoute(true).GET(cronRequest())
  assert.equal(failed.status, 500)
  assert.equal((await failed.json()).error, 'Provider rejected summary')
})
