import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const { NextRequest } = require('next/server')
const employee = 'a7854b92-5cd2-43bc-b229-9bbce3d16eef'
const material = {
  id: 'handbook', kind: 'handbook', acknowledgment_type: 'signature', effective_date: '2026-01-01',
  is_current: true, storage_path: 'materials/handbook.pdf', file_name: 'handbook.pdf', mime_type: 'application/pdf',
}

function load(file, dependencies) {
  const exports = {}
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(output, {
    exports, File, Uint8Array, Buffer, URL, process, crypto,
    require: name => dependencies[name] ?? require(name),
  })
  return exports
}

test('handbook signatures require a preview receipt and an explicit reading confirmation', async () => {
  const acknowledgments = []
  const invite = { id: 'case', status: 'submitted', first_name: 'Taylor', last_name: 'Example', selected_documents: [material.id] }
  const onboarding = {
    findInvite: async () => invite,
    chicagoDate: () => '2026-11-21',
    materialAssigned: () => true,
    materialReadCookie: id => `read_${id}`,
    materialReadReceipt: (token, caseId, id) => `${token}:${caseId}:${id}`,
    managerId: async () => null,
  }
  const lookup = async () => ({ data: material })
  const supabaseAdmin = {
    storage: { from: () => ({ download: async () => ({ data: new File(['%PDF-fixture'], 'handbook.pdf') }) }) },
    from(table) {
      if (table === 'onboarding_materials') return {
        select: () => ({ eq: () => ({ maybeSingle: lookup, eq: () => ({ single: lookup }) }) }),
      }
      if (table === 'onboarding_acknowledgments') return {
        insert: async values => { acknowledgments.push(values); return { error: null } },
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }
  const { POST } = load('app/api/onboarding/portal/route.ts', {
    '@/lib/onboarding': onboarding,
    '@/lib/supabaseAdmin': { supabaseAdmin },
    '@/lib/pin': {}, '@/lib/appSettings': {}, '@/lib/emailUtils': {}, '@/lib/onboardingEmail': {},
  })
  const { GET: preview } = load('app/api/onboarding/file/route.ts', {
    '@/lib/onboarding': onboarding, '@/lib/supabaseAdmin': { supabaseAdmin },
  })
  const sign = (reviewed, cookie) => POST(new NextRequest('https://example.invalid/api/onboarding/portal', {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
    body: JSON.stringify({ action: 'acknowledge', token: 'test-token', material_id: material.id, signed_name: 'Taylor Example', reviewed }),
  }))
  assert.equal((await sign(true)).status, 409)
  const fileUrl = 'https://example.invalid/api/onboarding/file?token=test-token&material_id=handbook'
  const download = await preview(new NextRequest(fileUrl))
  assert.equal(download.headers.get('set-cookie'), null)
  const opened = await preview(new NextRequest(`${fileUrl}&preview=1`))
  assert.equal(opened.status, 200)
  const cookie = opened.headers.get('set-cookie').split(';')[0]
  assert.equal((await sign(false, cookie)).status, 409)
  assert.equal((await sign(true, 'read_handbook=another-token:case:handbook')).status, 409)
  assert.equal(acknowledgments.length, 0)
  assert.equal((await sign(true, cookie)).status, 200)
  assert.equal(acknowledgments.length, 1)
})

test('staff legal file routes require a manager and keep files scoped to the employee folder', async () => {
  let isManager = false
  const files = new Map()
  const bucket = {
    async upload(key, file) { files.set(key, file); return { error: null } },
    async list(folder) {
      return { data: [...files.keys()].filter(key => key.startsWith(`${folder}/`))
        .map(key => ({ id: key, name: key.split('/').at(-1), created_at: '2026-11-21' })) }
    },
    async download(key) { return { data: files.get(key) } },
  }
  const supabaseAdmin = {
    storage: { from: () => bucket },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: employee } }) }) }) }),
  }
  const { GET, POST } = load('app/api/staff/legal-documents/route.ts', {
    '@/lib/onboarding': { ONBOARDING_BUCKET: 'onboarding-private' },
    '@/lib/routeAuth': { getDashboardViewer: async () => ({ isManager }) },
    '@/lib/supabaseAdmin': { supabaseAdmin },
  })
  const listUrl = `https://example.invalid/api/staff/legal-documents?employee_id=${employee}`
  assert.equal((await GET(new NextRequest(listUrl))).status, 403)
  assert.equal((await POST(new NextRequest(listUrl, { method: 'POST' }))).status, 403)
  isManager = true
  const body = new FormData()
  body.set('employee_id', employee)
  body.set('file', new File(['%PDF-fixture'], 'Signed form.pdf', { type: 'application/pdf' }))
  const uploaded = await POST(new NextRequest(listUrl, { method: 'POST', body }))
  assert.equal(uploaded.status, 201)
  const { document } = await uploaded.json()
  assert.equal((await (await GET(new NextRequest(listUrl))).json()).documents[0].name, 'Signed_form.pdf')
  const fileUrl = `${listUrl}&document=${document.id}`
  const download = await GET(new NextRequest(fileUrl))
  assert.equal(download.headers.get('Cache-Control'), 'private, no-store')
  assert.match(download.headers.get('Content-Disposition'), /^attachment/)
  assert.equal(await download.text(), '%PDF-fixture')
  assert.equal((await GET(new NextRequest(fileUrl.replace(employee, 'b7854b92-5cd2-43bc-b229-9bbce3d16eef')))).status, 404)
})
