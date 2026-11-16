import { NextRequest, NextResponse } from 'next/server'
import { inflateRawSync } from 'node:zlib'
import { findInvite, managerId, ONBOARDING_BUCKET } from '@/lib/onboarding'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

const allowed = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'image/jpeg', 'image/png'])

function validFile(file: File) {
  return allowed.has(file.type) && file.size > 0 && file.size <= 10 * 1024 * 1024
}

function docxText(bytes: Buffer) {
  let offset = 0
  while (offset + 46 < bytes.length) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) { offset++; continue }
    const nameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const commentLength = bytes.readUInt16LE(offset + 32)
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    if (name === 'word/document.xml') {
      const local = bytes.readUInt32LE(offset + 42)
      if (bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid Word file')
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28)
      const compressed = bytes.subarray(start, start + bytes.readUInt32LE(offset + 20))
      const xml = (bytes.readUInt16LE(offset + 10) === 8 ? inflateRawSync(compressed) : compressed).toString('utf8')
      return xml.split(/<\/w:p>/).map(paragraph => [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(match => match[1]).join('')).filter(Boolean)
        .map(line => line.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  throw new Error('Word document text is missing')
}

export async function POST(req: NextRequest) {
  const manager = await managerId()
  const form = await req.formData()
  const token = String(form.get('token') ?? '')
  const invite = !manager && token ? await findInvite(token) : null
  if (!manager && !invite) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const file = form.get('file')
  if (!(file instanceof File) || !validFile(file)) return NextResponse.json({ error: 'PDF, Word, text, or image file up to 10 MB required' }, { status: 400 })
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (file.type === 'application/pdf' && new TextDecoder().decode(bytes.slice(0, 4)) !== '%PDF') return NextResponse.json({ error: 'Invalid PDF' }, { status: 400 })
  const kind = String(form.get('kind') ?? '')
  if (kind === 'handbook' || kind === 'training') {
    if (!manager) return NextResponse.json({ error: 'Manager access required' }, { status: 403 })
    const title = kind === 'handbook' ? 'Employee Handbook' : String(form.get('title') ?? '').trim().slice(0, 120)
    if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    const previous = await supabaseAdmin.from('onboarding_materials').select('id,version').eq('kind', kind).eq('title', title).order('version', { ascending: false }).limit(1)
    if (previous.error) return NextResponse.json({ error: previous.error.message }, { status: 500 })
    const version = (previous.data?.[0]?.version ?? 0) + 1
    const path = `materials/${kind}/${crypto.randomUUID()}/${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const uploaded = await supabaseAdmin.storage.from(ONBOARDING_BUCKET).upload(path, bytes, { contentType: file.type })
    if (uploaded.error) return NextResponse.json({ error: uploaded.error.message }, { status: 500 })
    let quiz: unknown = null
    try { quiz = form.get('quiz') ? JSON.parse(String(form.get('quiz'))) : null } catch { return NextResponse.json({ error: 'Invalid quiz JSON' }, { status: 400 }) }
    const acknowledgmentType = String(form.get('acknowledgment_type') ?? 'signature')
    if (!['signature', 'quiz', 'manager_demo'].includes(acknowledgmentType)) return NextResponse.json({ error: 'Invalid acknowledgment type' }, { status: 400 })
    if (kind === 'handbook' && acknowledgmentType !== 'signature') return NextResponse.json({ error: 'Handbook requires a signature' }, { status: 400 })
    if (acknowledgmentType === 'quiz') {
      const questions = (quiz as { questions?: Array<{ prompt?: unknown; options?: unknown; correctIndex?: unknown }> } | null)?.questions
      if (!Array.isArray(questions) || questions.length < 1 || questions.some(q => typeof q.prompt !== 'string' || !q.prompt.trim() || !Array.isArray(q.options) || q.options.length < 2 || q.options.some(option => typeof option !== 'string' || !option.trim()) || !Number.isInteger(q.correctIndex) || Number(q.correctIndex) < 0 || Number(q.correctIndex) >= q.options.length)) return NextResponse.json({ error: 'Quiz needs valid questions and answers' }, { status: 400 })
    }
    const departments = String(form.get('departments') ?? '').split(',').map(x => x.trim()).filter(Boolean)
    const inserted = await supabaseAdmin.from('onboarding_materials').insert({ kind, title, version, storage_path: path, file_name: file.name, mime_type: file.type, required: form.get('required') !== 'false', acknowledgment_type: acknowledgmentType, quiz, departments, effective_date: String(form.get('effective_date') ?? new Date().toISOString().slice(0, 10)), is_current: false, created_by: manager }).select('id').single()
    if (inserted.error) return NextResponse.json({ error: inserted.error.message }, { status: 500 })
    return NextResponse.json({ success: true, id: inserted.data.id, version })
  }
  if (!['w4', 'i9', 'i9_id', 'other'].includes(kind)) return NextResponse.json({ error: 'Invalid document kind' }, { status: 400 })
  if (invite?.status === 'invited') return NextResponse.json({ error: 'Submit your application first' }, { status: 409 })
  if (invite && ['w4', 'i9', 'i9_id'].includes(kind) && !(invite.selected_documents ?? []).includes(kind === 'i9_id' ? 'i9' : kind)) return NextResponse.json({ error: 'This document was not assigned to you' }, { status: 403 })
  const caseId = manager ? String(form.get('case_id') ?? '') : invite!.id
  if (!caseId) return NextResponse.json({ error: 'Case is required' }, { status: 400 })
  const path = `${caseId}/documents/${crypto.randomUUID()}/${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const uploaded = await supabaseAdmin.storage.from(ONBOARDING_BUCKET).upload(path, bytes, { contentType: file.type })
  if (uploaded.error) return NextResponse.json({ error: uploaded.error.message }, { status: 500 })
  const inserted = await supabaseAdmin.from('onboarding_documents').insert({ case_id: caseId, kind, storage_path: path, file_name: file.name, mime_type: file.type, uploaded_by: manager ? 'manager' : 'employee' })
  if (inserted.error) return NextResponse.json({ error: inserted.error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function GET(req: NextRequest) {
  const manager = await managerId()
  const invite = !manager ? await findInvite(req.nextUrl.searchParams.get('token') ?? '') : null
  if (!manager && !invite) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const materialId = req.nextUrl.searchParams.get('material_id')
  const documentId = req.nextUrl.searchParams.get('document_id')
  const applicationCaseId = req.nextUrl.searchParams.get('application_case_id')
  let file: { storage_path: string; file_name: string; mime_type: string } | null = null
  if (materialId) {
    const result = await supabaseAdmin.from('onboarding_materials').select('storage_path,file_name,mime_type,is_current').eq('id', materialId).maybeSingle()
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
    if (result.data && (manager || (result.data.is_current && (invite?.status === 'active' || (invite?.selected_documents ?? []).includes(materialId))))) file = result.data
  } else if (documentId) {
    const result = await supabaseAdmin.from('onboarding_documents').select('case_id,storage_path,file_name,mime_type').eq('id', documentId).maybeSingle()
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
    if (result.data && (manager || result.data.case_id === invite?.id)) file = result.data
  } else if (applicationCaseId && manager) {
    const result = await supabaseAdmin.from('onboarding_cases').select('application_path').eq('id', applicationCaseId).maybeSingle()
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
    if (result.data?.application_path) file = { storage_path: result.data.application_path, file_name: 'initial-application.pdf', mime_type: 'application/pdf' }
  }
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 })
  const download = await supabaseAdmin.storage.from(ONBOARDING_BUCKET).download(file.storage_path)
  if (download.error || !download.data) return NextResponse.json({ error: 'Could not read file' }, { status: 500 })
  const bytes = Buffer.from(await download.data.arrayBuffer())
  if (req.nextUrl.searchParams.get('preview') === '1' && file.mime_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const paragraphs = docxText(bytes).map(line => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</p>`).join('')
    return new NextResponse(`<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 20px;color:#172033}p{white-space:pre-wrap;margin:0 0 1em}</style></head><body>${paragraphs}</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } })
  }
  return new NextResponse(new Uint8Array(bytes), { headers: {
    'Content-Type': file.mime_type,
    'Content-Disposition': `inline; filename="${file.file_name.replace(/["\r\n]/g, '_')}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  } })
}
