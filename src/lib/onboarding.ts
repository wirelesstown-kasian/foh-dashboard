import { createHash, randomBytes } from 'crypto'
import { cookies } from 'next/headers'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { ADMIN_SESSION_COOKIE, getAdminSessionEmployeeId, hasManagerAccess } from '@/lib/adminSession'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { verifyPin } from '@/lib/pin'
import { getAppSettings } from '@/lib/appSettings'
import { escapeHtml, sendEmail } from '@/lib/emailUtils'

export const ONBOARDING_BUCKET = 'onboarding-private'
export const RESTAURANT_TIME_ZONE = 'America/Chicago'

export function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function newInviteToken() {
  return randomBytes(32).toString('base64url')
}

export async function managerId() {
  const cookieStore = await cookies()
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value
  return await hasManagerAccess(token) ? getAdminSessionEmployeeId(token) : null
}

export async function findInvite(token: string) {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) return null
  const { data, error } = await supabaseAdmin.from('onboarding_cases').select('*')
    .eq('invite_hash', tokenHash(token)).gt('invite_expires_at', new Date().toISOString())
    .neq('status', 'cancelled').maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function pinInUse(pin: string, excludeCaseId?: string) {
  const [active, pending] = await Promise.all([
    supabaseAdmin.from('employees').select('id,pin_hash,pin_code').eq('is_active', true),
    supabaseAdmin.from('onboarding_cases').select('id,pending_pin_code').not('status', 'in', '(active,cancelled)'),
  ])
  if (active.error) throw new Error(active.error.message)
  if (pending.error) throw new Error(pending.error.message)
  if ((pending.data ?? []).some(row => row.id !== excludeCaseId && row.pending_pin_code === pin)) return true
  for (const row of active.data ?? []) {
    if (row.pin_code === pin || (row.pin_hash && await verifyPin(pin, row.pin_hash))) return true
  }
  return false
}

export function chicagoDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: RESTAURANT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export function materialAssigned(departments: string[] | null | undefined, employeeDepartments: string[] | null | undefined, primaryDepartment: string | null | undefined) {
  return !departments?.length || departments.some(department => employeeDepartments?.includes(department) || primaryDepartment === department)
}

export function applicationLines(row: Record<string, unknown>) {
  const contact = (row.emergency_contact ?? {}) as Record<string, string>
  const availability = (row.availability ?? {}) as Record<string, unknown>
  return [
    'Initial employment application',
    `Applicant: ${row.first_name ?? ''} ${row.last_name ?? ''}`,
    `Email: ${row.email ?? ''}`,
    `Phone: ${row.phone ?? ''}`,
    `Address: ${row.address ?? ''}, ${row.address_city ?? ''}, ${row.address_state ?? ''} ${row.address_postal_code ?? ''}`,
    `Submitted: ${row.submitted_at ?? new Date().toISOString()}`,
    `Employment sought: ${row.employment_type ?? 'Not specified'}`,
    '', 'Availability', JSON.stringify(availability, null, 2),
    '', 'Previous employment', String(row.employment_history ?? ''),
    '', 'Emergency contact',
    `${contact.name ?? ''} | ${contact.relationship ?? ''} | ${contact.phone ?? ''}`,
  ]
}

export async function makeApplicationPdf(row: Record<string, unknown>) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  let page = pdf.addPage([612, 792])
  let y = 750
  for (const line of applicationLines(row)) {
    const words = line.split(/\s+/)
    let part = ''
    const wrapped: string[] = []
    for (const word of words) {
      const next = part ? `${part} ${word}` : word
      if (font.widthOfTextAtSize(next, 10) > 510 && part) {
        wrapped.push(part)
        part = word
      } else part = next
    }
    wrapped.push(part)
    for (const text of wrapped) {
      if (y < 45) { page = pdf.addPage([612, 792]); y = 750 }
      page.drawText(text.replace(/[^\x20-\x7e]/g, '?'), { x: 50, y, size: 10, font })
      y -= 17
    }
  }
  return Buffer.from(await pdf.save())
}

export async function makeAcknowledgmentPdf(name: string, lines: string[]) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  let page = pdf.addPage([612, 792])
  let y = 750
  for (const line of [`Onboarding acknowledgment record: ${name}`, '', ...lines]) {
    if (y < 50) { page = pdf.addPage([612, 792]); y = 750 }
    page.drawText(line.replace(/[^\x20-\x7e]/g, '?').slice(0, 90), { x: 45, y, font, size: 10 })
    y -= 19
  }
  return Buffer.from(await pdf.save())
}

export async function maybeSendOnboardingRecord(caseId: string) {
  const [caseResult, materials, acknowledgments, documents, company] = await Promise.all([
    supabaseAdmin.from('onboarding_cases').select('*').eq('id', caseId).single(),
    supabaseAdmin.from('onboarding_materials').select('id,title,version,required,departments,is_current,effective_date'),
    supabaseAdmin.from('onboarding_acknowledgments').select('material_id,signed_name,acknowledged_at,quiz_score').eq('case_id', caseId),
    supabaseAdmin.from('onboarding_documents').select('kind,storage_path,file_name,manager_verified_at').eq('case_id', caseId),
    supabaseAdmin.from('onboarding_company').select('records_email,dba').eq('id', true).single(),
  ])
  for (const result of [caseResult, materials, acknowledgments, documents, company]) if (result.error) throw new Error(result.error.message)
  const row = caseResult.data
  if (!row || row.record_email_sent_at || !company.data?.records_email || !process.env.RESEND_API_KEY || !row.application_path) return false
  const required = (materials.data ?? []).filter(m => m.is_current && m.effective_date <= chicagoDate() && m.required && (row.selected_documents ?? []).includes(m.id) && materialAssigned(m.departments, row.schedule_departments, row.primary_department))
  if (required.some(m => !(acknowledgments.data ?? []).some(a => a.material_id === m.id))) return false
  for (const kind of ['w4', 'i9']) if ((row.selected_documents ?? []).includes(kind) && !(documents.data ?? []).some(d => d.kind === kind && d.manager_verified_at)) return false
  const claim = await supabaseAdmin.from('onboarding_cases').update({ record_email_claimed_at: new Date().toISOString() })
    .eq('id', caseId).is('record_email_sent_at', null).is('record_email_claimed_at', null).select('id').maybeSingle()
  if (claim.error) throw new Error(claim.error.message)
  if (!claim.data) return false
  try {
    const attachments: Array<{ filename: string; content: string }> = []
    const files = [{ storage_path: row.application_path, file_name: 'initial-application.pdf' }, ...(documents.data ?? []).filter(d => d.manager_verified_at)]
    let total = 0
    for (const file of files) {
      const result = await supabaseAdmin.storage.from(ONBOARDING_BUCKET).download(file.storage_path)
      if (result.error || !result.data) throw new Error(`Could not attach ${file.file_name}`)
      const bytes = Buffer.from(await result.data.arrayBuffer())
      total += bytes.length
      if (total > 20 * 1024 * 1024) throw new Error('Onboarding record exceeds email attachment limit')
      attachments.push({ filename: file.file_name, content: bytes.toString('base64') })
    }
    const receipt = await makeAcknowledgmentPdf(`${row.first_name} ${row.last_name}`, (acknowledgments.data ?? []).map(a => {
      const material = (materials.data ?? []).find(m => m.id === a.material_id)
      return `${material?.title ?? 'Material'} v${material?.version ?? '?'} | ${a.signed_name ?? 'Manager verified'} | ${a.acknowledged_at}${a.quiz_score == null ? '' : ` | ${a.quiz_score}%`}`
    }))
    attachments.push({ filename: 'signed-acknowledgments.pdf', content: receipt.toString('base64') })
    const settings = await getAppSettings()
    const ackSummary = (acknowledgments.data ?? []).map(a => {
      const material = (materials.data ?? []).find(m => m.id === a.material_id)
      return `<li>${escapeHtml(material?.title ?? 'Archived material')} v${material?.version ?? '?'} — ${escapeHtml(a.signed_name ?? 'manager verified')} — ${escapeHtml(a.acknowledged_at)}</li>`
    }).join('')
    await sendEmail({ resendKey: process.env.RESEND_API_KEY!, to: company.data.records_email,
      subject: `Completed onboarding record: ${row.first_name} ${row.last_name}`,
      html: `<p>Completed onboarding for ${escapeHtml(`${row.first_name} ${row.last_name}`)}. The initial application, signed or reviewed forms, and acknowledgment record are attached. These files may contain sensitive personal information; keep this email restricted to authorized managers.</p><ul>${ackSummary}</ul>`,
      attachments,
      fromName: settings.from_name, fromEmail: settings.from_email, replyTo: settings.reply_to })
    const saved = await supabaseAdmin.from('onboarding_cases').update({ record_email_sent_at: new Date().toISOString() }).eq('id', caseId)
    if (saved.error) throw new Error(saved.error.message)
    return true
  } catch (error) {
    await supabaseAdmin.from('onboarding_cases').update({ record_email_claimed_at: null }).eq('id', caseId)
    throw error
  }
}
