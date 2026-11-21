import { onboardingDocumentLinks, onboardingEmailLogo } from '@/lib/onboardingEmail'
import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getAppSettings } from '@/lib/appSettings'
import { sendEmail, escapeHtml } from '@/lib/emailUtils'
import { chicagoDate, managerId, materialAssigned, maybeSendOnboardingRecord, newInviteToken, tokenHash } from '@/lib/onboarding'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { ONBOARDING_BUCKET } from '@/lib/onboarding'
import { verifyPin } from '@/lib/pin'

export const dynamic = 'force-dynamic'

async function ensureInitialHandbook() {
  const existing = await supabaseAdmin.from('onboarding_materials').select('id').eq('kind', 'handbook').limit(1)
  if (existing.error) throw new Error(existing.error.message)
  if (existing.data?.length) return
  const bytes = await readFile(path.join(process.cwd(), 'private-assets', 'initial-handbook.docx'))
  const storagePath = 'materials/handbook/initial-v1.docx'
  const upload = await supabaseAdmin.storage.from(ONBOARDING_BUCKET).upload(storagePath, bytes, {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', upsert: false,
  })
  if (upload.error && !upload.error.message.toLowerCase().includes('already exists')) throw new Error(upload.error.message)
  const inserted = await supabaseAdmin.from('onboarding_materials').upsert({
    kind: 'handbook', title: 'Employee Handbook', version: 1, storage_path: storagePath,
    file_name: 'New_Village_Handbook_EN_Updated_with_Hatwear_POS_Final.docx',
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    required: true, acknowledgment_type: 'signature', is_current: false,
  }, { onConflict: 'kind,title,version', ignoreDuplicates: true })
  if (inserted.error) throw new Error(inserted.error.message)
}

async function sendInvite(req: NextRequest, caseId: string, email: string, stage: 'application' | 'documents' | 'reissue', materialId?: string) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured')
  if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_APP_URL) throw new Error('NEXT_PUBLIC_APP_URL is required for invitation emails')
  const token = newInviteToken()
  const saved = await supabaseAdmin.from('onboarding_cases').update({ invite_hash: tokenHash(token), invite_expires_at: new Date(Date.now() + 30 * 86400000).toISOString() }).eq('id', caseId)
  if (saved.error) throw new Error(saved.error.message)
  const settings = await getAppSettings()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
  const link = `${appUrl.replace(/\/$/, '')}/onboarding/${token}${materialId ? `?material=${encodeURIComponent(materialId)}` : ''}`
  const due = new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'long', day: 'numeric' })
  const docs = stage === 'documents' ? await onboardingDocumentLinks(caseId, link) : ''
  await sendEmail({ resendKey: process.env.RESEND_API_KEY, to: email,
    subject: stage === 'application' ? 'Complete your New Village onboarding' : stage === 'reissue' ? 'Updated New Village handbook or training' : 'Your New Village onboarding documents are ready',
    html: `<div style="font-family:Arial,sans-serif;max-width:580px;margin:auto">${onboardingEmailLogo(appUrl)}<h2>New Village onboarding</h2><p>${stage === 'application' ? 'Please complete your application. Your assigned documents will appear after you submit it.' : stage === 'reissue' ? 'A handbook or training document has been updated. Please open it, read it, and complete the acknowledgment.' : 'Please review and sign the assigned handbook and training, then complete your tax and work authorization forms.'}</p><p><a href="${escapeHtml(link)}">${stage === 'reissue' ? 'Open updated document' : 'Open your secure onboarding page'}</a></p>${docs}<p>Please complete this by ${escapeHtml(due)} (within 7 days). Your private link expires in 30 days. Do not forward it.</p></div>`,
    fromName: settings.from_name, fromEmail: settings.from_email, replyTo: settings.reply_to })
  const recorded = await supabaseAdmin.from('onboarding_cases').update({ last_invite_sent_at: new Date().toISOString(), last_invite_email: email }).eq('id', caseId)
  if (recorded.error) throw new Error(recorded.error.message)
}

const errorResponse = (error: unknown, status = 500) => NextResponse.json({
  error: error instanceof Error ? error.message : 'Onboarding request failed',
}, { status })

export async function GET() {
  if (!await managerId()) return errorResponse(new Error('Unauthorized'), 401)
  try { await ensureInitialHandbook() } catch (error) { return errorResponse(error) }
  const [company, cases, materials, documents, acknowledgments, employees] = await Promise.all([
    supabaseAdmin.from('onboarding_company').select('*').eq('id', true).single(),
    supabaseAdmin.from('onboarding_cases').select('id,email,status,first_name,last_name,phone,address,role,primary_department,schedule_departments,hourly_wage,guaranteed_hourly,tip_pool_hourly_rate,tip_eligible,commission_enabled,commission_note,activation_date,application_path,employee_id,created_at,submitted_at,approved_at,activated_at,record_email_sent_at,selected_documents,last_invite_sent_at,last_invite_email').order('created_at', { ascending: false }),
    supabaseAdmin.from('onboarding_materials').select('*').order('created_at', { ascending: false }),
    supabaseAdmin.from('onboarding_documents').select('id,case_id,kind,file_name,uploaded_at,uploaded_by,manager_verified_at'),
    supabaseAdmin.from('onboarding_acknowledgments').select('id,case_id,material_id,signed_name,quiz_score,acknowledged_at,verified_by'),
    supabaseAdmin.from('employees').select('id,name,email,primary_department,schedule_departments').eq('is_active', true).not('email', 'is', null).order('name'),
  ])
  for (const result of [company, cases, materials, documents, acknowledgments, employees]) {
    if (result.error) return errorResponse(new Error(result.error.message))
  }
  return NextResponse.json({ company: company.data, cases: cases.data, materials: materials.data, documents: documents.data, acknowledgments: acknowledgments.data, employees: employees.data }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(req: NextRequest) {
  const manager = await managerId()
  if (!manager) return errorResponse(new Error('Unauthorized'), 401)
  try {
    const body = await req.json()
    if (body.action === 'company') {
      const managerRow = await supabaseAdmin.from('employees').select('pin_hash,pin_code').eq('id', manager).single()
      if (managerRow.error) throw new Error(managerRow.error.message)
      if (!/^\d{4}$/.test(body.manager_pin ?? '') || !(managerRow.data.pin_code === body.manager_pin || (managerRow.data.pin_hash && await verifyPin(body.manager_pin, managerRow.data.pin_hash)))) return errorResponse(new Error('Manager PIN is incorrect'), 403)
      const fields = ['legal_name', 'dba', 'street', 'city', 'state', 'postal_code', 'ein', 'records_email'] as const
      const values = Object.fromEntries(fields.map(field => [field, String(body[field] ?? '').trim()]))
      if (!values.legal_name || !values.dba || !values.street || !values.city || !values.state) return errorResponse(new Error('Company name and address are required'), 400)
      if (values.records_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.records_email)) return errorResponse(new Error('Invalid records email'), 400)
      const current = await supabaseAdmin.from('onboarding_company').select('*').eq('id', true).single()
      if (current.error) throw new Error(current.error.message)
      const history = await supabaseAdmin.from('onboarding_company_history').insert({ snapshot: current.data, changed_by: manager })
      if (history.error) throw new Error(history.error.message)
      const saved = await supabaseAdmin.from('onboarding_company').update({ ...values, updated_at: new Date().toISOString(), updated_by: manager }).eq('id', true)
      if (saved.error) throw new Error(saved.error.message)
      return NextResponse.json({ success: true })
    }
    if (body.action === 'approve') {
      const { id, role, primary_department, schedule_departments, activation_date } = body
      if (typeof id !== 'string' || typeof role !== 'string' || typeof primary_department !== 'string' || !Array.isArray(schedule_departments) || !schedule_departments.includes(primary_department) || !/^\d{4}-\d{2}-\d{2}$/.test(activation_date)) return errorResponse(new Error('Role, departments and activation date are required'), 400)
      const settings = await getAppSettings()
      if (!settings.role_definitions.some(item => item.key === role && item.is_active) || !schedule_departments.every((value: unknown) => typeof value === 'string' && settings.primary_department_definitions.some(item => item.key === value && item.is_active))) return errorResponse(new Error('Invalid role or department'), 400)
      const payFields = ['hourly_wage', 'guaranteed_hourly', 'tip_pool_hourly_rate'] as const
      const pay = Object.fromEntries(payFields.map(field => [field, body[field] === '' || body[field] == null ? null : Number(body[field])]))
      if (Object.values(pay).some(value => value !== null && (!Number.isFinite(value) || Number(value) < 0))) return errorResponse(new Error('Pay values must be nonnegative'), 400)
      const result = await supabaseAdmin.from('onboarding_cases').update({
        status: 'approved', role, primary_department, schedule_departments,
        ...pay, tip_eligible: body.tip_eligible === true,
        commission_enabled: body.commission_enabled === true,
        commission_note: typeof body.commission_note === 'string' ? body.commission_note.trim() : null,
        activation_date, approved_at: new Date().toISOString(),
      }).eq('id', id).eq('status', 'submitted').select('id,email').maybeSingle()
      if (result.error) throw new Error(result.error.message)
      if (!result.data) return errorResponse(new Error('Application is not ready for approval'), 409)
      return NextResponse.json({ success: true })
    }
    if (body.action === 'activate') {
      const result = await supabaseAdmin.rpc('activate_onboarding_case', { p_case_id: body.id })
      if (result.error) return errorResponse(new Error(result.error.message), 409)
      return NextResponse.json({ success: true, employee_id: result.data })
    }
    if (body.action === 'update_activation') {
      if (typeof body.id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.activation_date)) return errorResponse(new Error('Valid activation date is required'), 400)
      const result = await supabaseAdmin.from('onboarding_cases').update({ activation_date: body.activation_date }).eq('id', body.id).eq('status', 'approved').select('id').maybeSingle()
      if (result.error) throw new Error(result.error.message)
      if (!result.data) return errorResponse(new Error('Only approved cases can change activation date'), 409)
      return NextResponse.json({ success: true })
    }
    if (body.action === 'verify_document') {
      const result = await supabaseAdmin.from('onboarding_documents').update({ manager_verified_at: new Date().toISOString(), manager_verified_by: manager }).eq('id', body.id).select('id').maybeSingle()
      if (result.error) throw new Error(result.error.message)
      if (!result.data) return errorResponse(new Error('Document not found'), 404)
      return NextResponse.json({ success: true })
    }
    if (body.action === 'publish_material') {
      const result = await supabaseAdmin.rpc('publish_onboarding_material', { p_material_id: body.id })
      if (result.error) throw new Error(result.error.message)
      return NextResponse.json({ success: true })
    }
    if (body.action === 'reissue_material') {
      if (typeof body.employee_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.employee_id)) return errorResponse(new Error('Select one employee before sending'), 400)
      const material = await supabaseAdmin.from('onboarding_materials').select('id,kind,title,is_current,departments,effective_date').eq('id', body.id).maybeSingle()
      if (material.error) throw new Error(material.error.message)
      if (!material.data?.is_current) return errorResponse(new Error('Publish the material before reissuing it'), 409)
      if (material.data.effective_date > chicagoDate()) return errorResponse(new Error('Material is not effective yet'), 409)
      const [employeeResult, company] = await Promise.all([
        supabaseAdmin.from('employees').select('id,name,email,phone,address,primary_department,schedule_departments').eq('id', body.employee_id).eq('is_active', true).maybeSingle(),
        supabaseAdmin.from('onboarding_company').select('*').eq('id', true).single(),
      ])
      if (employeeResult.error) throw new Error(employeeResult.error.message)
      if (company.error) throw new Error(company.error.message)
      const employee = employeeResult.data
      if (!employee?.email) return errorResponse(new Error('Active employee with an email was not found'), 404)
      if (!materialAssigned(material.data.departments, employee.schedule_departments, employee.primary_department)) return errorResponse(new Error('This material is not assigned to the selected employee'), 409)
      const existing = await supabaseAdmin.from('onboarding_cases').select('id,status,selected_documents').eq('employee_id', employee.id).maybeSingle()
      if (existing.error) throw new Error(existing.error.message)
      let caseId = existing.data?.id
      if (caseId && existing.data?.status === 'cancelled') {
        const reopened = await supabaseAdmin.from('onboarding_cases').update({ status: 'active' }).eq('id', caseId)
        if (reopened.error) throw new Error(reopened.error.message)
      }
      if (caseId) {
        const updated = await supabaseAdmin.from('onboarding_cases').update({ primary_department: employee.primary_department, schedule_departments: employee.schedule_departments, selected_documents: [...new Set([...(existing.data?.selected_documents ?? []), material.data.id])] }).eq('id', caseId)
        if (updated.error) throw new Error(updated.error.message)
      } else {
        const created = await supabaseAdmin.from('onboarding_cases').insert({
          email: employee.email, company_snapshot: company.data, invite_hash: tokenHash(newInviteToken()),
          invite_expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), status: 'active',
          employee_id: employee.id, first_name: employee.name, last_name: null,
          selected_documents: [material.data.id],
          phone: employee.phone, address: employee.address,
          primary_department: employee.primary_department, schedule_departments: employee.schedule_departments,
        }).select('id').single()
        if (created.error) throw new Error(created.error.message)
        caseId = created.data.id
      }
      await sendInvite(req, caseId, employee.email, 'reissue', material.data.id)
      return NextResponse.json({ success: true, sent_to: employee.email })
    }
    if (body.action === 'cancel_invite') {
      if (typeof body.id !== 'string') return errorResponse(new Error('Choose an invitation'), 400)
      const cancelled = await supabaseAdmin.from('onboarding_cases').update({ status: 'cancelled', invite_hash: tokenHash(newInviteToken()), invite_expires_at: new Date().toISOString(), pending_pin_code: null, ssn: null }).eq('id', body.id).in('status', ['invited','submitted','approved']).select('id').maybeSingle()
      if (cancelled.error) throw new Error(cancelled.error.message)
      if (!cancelled.data) return errorResponse(new Error('Only unfinished invitations can be cancelled'), 409)
      return NextResponse.json({ success: true })
    }
    if (body.action === 'issue_material') {
      if (typeof body.id !== 'string' || typeof body.material_id !== 'string') return errorResponse(new Error('Select a case and material'), 400)
      const [caseResult, materialResult] = await Promise.all([
        supabaseAdmin.from('onboarding_cases').select('id,email,status,selected_documents,primary_department,schedule_departments').eq('id', body.id).maybeSingle(),
        supabaseAdmin.from('onboarding_materials').select('id,is_current,effective_date,departments').eq('id', body.material_id).maybeSingle(),
      ])
      if (caseResult.error || materialResult.error) throw new Error(caseResult.error?.message ?? materialResult.error?.message)
      const target = caseResult.data
      const material = materialResult.data
      if (!target || target.status === 'cancelled' || !material?.is_current || material.effective_date > chicagoDate()) return errorResponse(new Error('Case or material is not available'), 409)
      if (!materialAssigned(material.departments, target.schedule_departments, target.primary_department)) return errorResponse(new Error('Material is not assigned to this department'), 409)
      const selected = [...new Set([...(target.selected_documents ?? []), material.id])]
      const updated = await supabaseAdmin.from('onboarding_cases').update({ selected_documents: selected }).eq('id', target.id)
      if (updated.error) throw new Error(updated.error.message)
      try { await sendInvite(req, target.id, target.email, target.status === 'invited' ? 'application' : 'reissue', target.status === 'invited' ? undefined : material.id) }
      catch (error) { return NextResponse.json({ success: true, email_error: error instanceof Error ? error.message : 'Material email failed' }) }
      return NextResponse.json({ success: true, sent_to: target.email })
    }
    if (body.action === 'verify_training') {
      const result = await supabaseAdmin.from('onboarding_acknowledgments').insert({ case_id: body.case_id, material_id: body.material_id, verified_by: manager })
      if (result.error) throw new Error(result.error.message)
      return NextResponse.json({ success: true })
    }
    if (body.action === 'resend_invite') {
      const result = await supabaseAdmin.from('onboarding_cases').select('id,email,status').eq('id', body.id).maybeSingle()
      if (result.error) throw new Error(result.error.message)
      if (!result.data || !['invited', 'submitted', 'approved'].includes(result.data.status)) return errorResponse(new Error('Case is not open'), 409)
      await sendInvite(req, result.data.id, result.data.email, result.data.status === 'invited' ? 'application' : 'documents')
      return NextResponse.json({ success: true })
    }
    if (body.action === 'email_record') {
      const sent = await maybeSendOnboardingRecord(body.id)
      if (!sent) return errorResponse(new Error('Required acknowledgments, reviewed forms, or records email are missing'), 409)
      return NextResponse.json({ success: true })
    }
    return errorResponse(new Error('Invalid action'), 400)
  } catch (error) { return errorResponse(error) }
}

export async function POST(req: NextRequest) {
  if (!await managerId()) return errorResponse(new Error('Unauthorized'), 401)
  try {
    const { email, selected_documents } = await req.json()
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return errorResponse(new Error('Valid email is required'), 400)
    const company = await supabaseAdmin.from('onboarding_company').select('*').eq('id', true).single()
    if (company.error) throw new Error(company.error.message)
    if (!company.data.postal_code || !company.data.ein || !company.data.records_email) return errorResponse(new Error('Complete company ZIP, EIN, and records email before inviting employees'), 409)
    const normalized = email.trim().toLowerCase()
    const allowedDocuments = ['w4', 'i9', ...(await supabaseAdmin.from('onboarding_materials').select('id').eq('is_current', true)).data?.map(row => row.id) ?? []]
    if (!Array.isArray(selected_documents) || selected_documents.some(value => typeof value !== 'string' || !allowedDocuments.includes(value))) return errorResponse(new Error('Choose valid onboarding documents'), 400)
    const existing = await supabaseAdmin.from('onboarding_cases').select('id').eq('email', normalized).not('status', 'in', '(active,cancelled)').maybeSingle()
    if (existing.error) throw new Error(existing.error.message)
    if (existing.data) return errorResponse(new Error('An open onboarding already exists for this email'), 409)
    const token = newInviteToken()
    const inserted = await supabaseAdmin.from('onboarding_cases').insert({ email: normalized, company_snapshot: company.data, selected_documents, invite_hash: tokenHash(token), invite_expires_at: new Date(Date.now() + 30 * 86400000).toISOString() }).select('id').single()
    if (inserted.error) throw new Error(inserted.error.message)
    await sendInvite(req, inserted.data.id, normalized, 'application')
    return NextResponse.json({ success: true, id: inserted.data.id })
  } catch (error) { return errorResponse(error) }
}
