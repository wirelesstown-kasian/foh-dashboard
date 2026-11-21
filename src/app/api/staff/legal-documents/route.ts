import { NextRequest, NextResponse } from 'next/server'
import { ONBOARDING_BUCKET } from '@/lib/onboarding'
import { getDashboardViewer } from '@/lib/routeAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i
const fileId = /^[\da-f-]{36}--[\w.-]{1,160}$/i
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
const maxBytes = 4 * 1024 * 1024
const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: privateHeaders })
}

function storage() {
  return supabaseAdmin.storage.from(ONBOARDING_BUCKET)
}

export async function GET(request: NextRequest) {
  if (!(await getDashboardViewer())?.isManager) return failure('Manager access required.', 403)
  const employee = request.nextUrl.searchParams.get('employee_id') ?? ''
  const document = request.nextUrl.searchParams.get('document')
  if (!uuid.test(employee)) return failure('Invalid employee.', 400)
  const folder = `staff-legal/${employee}`

  if (document !== null) {
    if (!fileId.test(document)) return failure('Invalid document.', 400)
    const { data, error } = await storage().download(`${folder}/${document}`)
    if (error || !data) return failure('Document could not be opened.', 404)
    return new NextResponse(data, { headers: {
      ...privateHeaders,
      'Content-Type': data.type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${document.slice(38)}"`,
    } })
  }

  const documents: Array<{ id: string; name: string; uploadedAt: string }> = []
  const limit = 100
  for (let offset = 0; ; offset += limit) {
    const { data, error } = await storage().list(folder, { limit, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) return failure('Could not list legal documents.', 500)
    for (const item of data) {
      if (item.id && fileId.test(item.name)) {
        documents.push({ id: item.name, name: item.name.slice(38), uploadedAt: item.created_at ?? '' })
      }
    }
    if (data.length < limit) break
  }
  return NextResponse.json({ documents: documents.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)) }, { headers: privateHeaders })
}

export async function POST(request: NextRequest) {
  if (!(await getDashboardViewer())?.isManager) return failure('Manager access required.', 403)
  if (request.headers.get('sec-fetch-site') === 'cross-site') return failure('Invalid request.', 400)
  const form = await request.formData().catch(() => null)
  const employee = form?.get('employee_id')
  const file = form?.get('file')
  if (typeof employee !== 'string' || !uuid.test(employee)) return failure('Invalid employee.', 400)
  if (!(file instanceof File) || file.size < 1 || file.size > maxBytes || !allowedTypes.has(file.type)) {
    return failure('Choose a PDF, Word, JPG, or PNG file up to 4 MB.', 400)
  }
  const { data: employeeRecord, error: employeeError } = await supabaseAdmin.from('employees')
    .select('id').eq('id', employee).maybeSingle()
  if (employeeError) return failure('Could not verify the employee.', 500)
  if (!employeeRecord) return failure('Employee not found.', 404)

  const name = file.name.replace(/[^\w.-]+/g, '_').slice(0, 160) || 'document'
  const id = `${crypto.randomUUID()}--${name}`
  const { error } = await storage().upload(`staff-legal/${employee}/${id}`, file, { contentType: file.type, upsert: false })
  if (error) return failure('Could not upload the legal document.', 500)
  return NextResponse.json({ document: { id, name, uploadedAt: new Date().toISOString() } }, { status: 201, headers: privateHeaders })
}
