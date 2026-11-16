import { NextRequest, NextResponse } from 'next/server'
import { hashPin } from '@/lib/pin'
import { chicagoDate, findInvite, makeApplicationPdf, materialAssigned, ONBOARDING_BUCKET, pinInUse } from '@/lib/onboarding'
import { encryptSsn } from '@/lib/onboardingSsn'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getAppSettings } from '@/lib/appSettings'
import { escapeHtml, sendEmail } from '@/lib/emailUtils'

export const dynamic = 'force-dynamic'

function failure(message: string, status = 400) { return NextResponse.json({ error: message }, { status }) }

export async function GET(req: NextRequest) {
  try {
    const row = await findInvite(req.nextUrl.searchParams.get('token') ?? '')
    if (!row) return failure('This invitation is invalid or expired', 404)
    const [materials, acknowledgments, documents] = await Promise.all([
      supabaseAdmin.from('onboarding_materials').select('id,kind,title,version,file_name,mime_type,required,acknowledgment_type,quiz,departments,effective_date').eq('is_current', true).lte('effective_date', chicagoDate()),
      supabaseAdmin.from('onboarding_acknowledgments').select('material_id,acknowledged_at,quiz_score').eq('case_id', row.id),
      supabaseAdmin.from('onboarding_documents').select('kind,file_name,uploaded_at,manager_verified_at').eq('case_id', row.id),
    ])
    for (const result of [materials, acknowledgments, documents]) if (result.error) throw new Error(result.error.message)
    const visibleMaterials = (materials.data ?? []).filter(material => materialAssigned(material.departments, row.schedule_departments, row.primary_department) && (row.status === 'active' || (row.selected_documents ?? []).includes(material.id)))
      .map(material => ({ ...material, quiz: material.quiz ? { questions: ((material.quiz as { questions?: Array<{ prompt: string; options: string[] }> }).questions ?? []).map(q => ({ prompt: q.prompt, options: q.options })) } : null }))
    return NextResponse.json({ case: { id: row.id, email: row.email, status: row.status, first_name: row.first_name, last_name: row.last_name, phone: row.phone, address: row.address, activation_date: row.activation_date, selected_documents: row.selected_documents ?? [], due_date: row.last_invite_sent_at ? new Date(new Date(row.last_invite_sent_at).getTime() + 7 * 86400000).toISOString().slice(0, 10) : null }, materials: visibleMaterials, acknowledgments: acknowledgments.data, documents: documents.data }, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
  } catch (error) { return failure(error instanceof Error ? error.message : 'Could not load invitation', 500) }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const row = await findInvite(body.token ?? '')
    if (!row) return failure('This invitation is invalid or expired', 404)
    if (body.action === 'submit') {
      if (row.status !== 'invited') return failure('Application has already been submitted', 409)
      const fields = ['first_name', 'last_name', 'phone', 'address', 'address_city', 'address_state', 'address_postal_code'] as const
      const values = Object.fromEntries(fields.map(field => [field, typeof body[field] === 'string' ? body[field].trim() : '']))
      if (fields.some(field => !values[field])) return failure('Name, phone, and address are required')
      if (fields.some(field => values[field].length > 250)) return failure('Application field is too long')
      if (!/^[A-Za-z]{2}$/.test(values.address_state)) return failure('Use a two-letter state abbreviation')
      if (!/^\d{4}$/.test(body.pin ?? '')) return failure('PIN must be four digits')
      const normalizedSsn = typeof body.ssn === 'string' ? body.ssn.replace(/\D/g, '') : ''
      if (!/^\d{9}$/.test(normalizedSsn)) return failure('SSN must contain nine digits')
      if (body.filing_status && !['single', 'married_joint', 'head_of_household'].includes(body.filing_status)) return failure('Choose a valid W-4 filing status')
      const step3 = body.w4_step3_amount === '' || body.w4_step3_amount == null ? null : Number(body.w4_step3_amount)
      if (step3 !== null && (!Number.isFinite(step3) || step3 < 0)) return failure('W-4 Step 3 amount must be nonnegative')
      if (await pinInUse(body.pin, row.id)) return failure('That PIN is already in use', 409)
      const submittedAt = new Date().toISOString()
      const update = {
        ...values, availability: typeof body.availability === 'object' && body.availability !== null ? body.availability : {},
        employment_type: ['full_time', 'part_time'].includes(body.employment_type) ? body.employment_type : null,
        employment_history: typeof body.employment_history === 'string' ? body.employment_history.slice(0, 10000) : '',
        emergency_contact: typeof body.emergency_contact === 'object' && body.emergency_contact !== null ? body.emergency_contact : {},
        pin_hash: await hashPin(body.pin), pending_pin_code: body.pin,
        filing_status: body.filing_status || null, w4_step3_amount: step3,
        ssn_ciphertext: encryptSsn(normalizedSsn),
        login_password_hash: null, status: 'submitted', submitted_at: submittedAt,
      }
      const pdf = await makeApplicationPdf({ ...row, ...update })
      const path = `${row.id}/application-${Date.now()}.pdf`
      const uploaded = await supabaseAdmin.storage.from(ONBOARDING_BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: false })
      if (uploaded.error) throw new Error(uploaded.error.message)
      const saved = await supabaseAdmin.from('onboarding_cases').update({ ...update, application_path: path }).eq('id', row.id).eq('status', 'invited').select('id').maybeSingle()
      if (saved.error) throw new Error(saved.error.message)
      if (!saved.data) return failure('Application changed while saving', 409)
      try {
        if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured')
        const settings = await getAppSettings()
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
        const link = `${appUrl.replace(/\/$/, '')}/onboarding/${body.token}`
        const due = new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'long', day: 'numeric' })
        await sendEmail({ resendKey: process.env.RESEND_API_KEY, to: row.email,
          subject: 'Your New Village onboarding documents are ready',
          html: `<div style="font-family:Arial,sans-serif;max-width:580px;margin:auto"><img src="${escapeHtml(appUrl.replace(/\/$/, ''))}/new-village-foh-logo.svg" alt="New Village" style="max-width:180px;height:auto"><h2>Your onboarding documents are ready</h2><p>Thank you for submitting your application. Open your private page to read and sign the assigned handbook and training, and complete the selected forms.</p><p><a href="${escapeHtml(link)}">Open your onboarding documents</a></p><p>Please complete them by ${escapeHtml(due)}. Do not forward this link.</p></div>`,
          fromName: settings.from_name, fromEmail: settings.from_email, replyTo: settings.reply_to })
        await supabaseAdmin.from('onboarding_cases').update({ last_invite_sent_at: new Date().toISOString(), last_invite_email: row.email }).eq('id', row.id)
      } catch (error) {
        return NextResponse.json({ success: true, email_error: error instanceof Error ? error.message : 'Document email failed' })
      }
      return NextResponse.json({ success: true })
    }
    if (body.action === 'acknowledge') {
      if (row.status === 'invited' || row.status === 'cancelled') return failure('Submit your application first', 409)
      const result = await supabaseAdmin.from('onboarding_materials').select('*').eq('id', body.material_id).eq('is_current', true).single()
      if (result.error) return failure('Material not found', 404)
      const material = result.data
      if (material.effective_date > chicagoDate() || !materialAssigned(material.departments, row.schedule_departments, row.primary_department) || (row.status !== 'active' && !(row.selected_documents ?? []).includes(material.id))) return failure('Material is not assigned to you', 403)
      if (material.acknowledgment_type === 'manager_demo') return failure('A manager must verify this training', 403)
      const fullName = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim()
      if (typeof body.signed_name !== 'string' || body.signed_name.trim().toLowerCase() !== fullName.toLowerCase()) return failure('Type your full name to sign')
      let score: number | null = null
      if (material.acknowledgment_type === 'quiz') {
        const questions = (material.quiz as { questions?: Array<{ correctIndex: number }> } | null)?.questions ?? []
        if (!questions.length || !Array.isArray(body.answers) || body.answers.length !== questions.length) return failure('Complete every quiz question')
        score = Math.round(100 * questions.filter((q, i) => q.correctIndex === body.answers[i]).length / questions.length)
        if (score < 80) return NextResponse.json({ error: 'Quiz score must be at least 80%. Review the material and try again.', score }, { status: 400 })
      }
      const saved = await supabaseAdmin.from('onboarding_acknowledgments').insert({ case_id: row.id, material_id: material.id, signed_name: body.signed_name.trim(), quiz_answers: material.acknowledgment_type === 'quiz' ? body.answers : null, quiz_score: score })
      if (saved.error?.code === '23505') return failure('Already acknowledged', 409)
      if (saved.error) throw new Error(saved.error.message)
      return NextResponse.json({ success: true, score })
    }
    if (body.action === 'change_pin') {
      if (!['submitted', 'approved'].includes(row.status)) return failure('PIN can no longer be changed', 409)
      if (!/^\d{4}$/.test(body.pin ?? '')) return failure('PIN must be four digits')
      if (await pinInUse(body.pin, row.id)) return failure('That PIN is already in use', 409)
      const saved = await supabaseAdmin.from('onboarding_cases').update({ pin_hash: await hashPin(body.pin), pending_pin_code: body.pin }).eq('id', row.id)
      if (saved.error?.code === '23505') return failure('That PIN is already in use', 409)
      if (saved.error) throw new Error(saved.error.message)
      return NextResponse.json({ success: true })
    }
    return failure('Invalid action')
  } catch (error) { return failure(error instanceof Error ? error.message : 'Could not save onboarding', 500) }
}
