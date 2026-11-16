import { NextRequest, NextResponse } from 'next/server'
import { managerId } from '@/lib/onboarding'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function GET(req: NextRequest) {
  if (!await managerId()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const employeeId = req.nextUrl.searchParams.get('employee_id')
  if (!employeeId) return NextResponse.json({ error: 'Employee is required' }, { status: 400 })
  const result = await supabaseAdmin.from('onboarding_cases').select('id,application_path').eq('employee_id', employeeId).maybeSingle()
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
  if (!result.data) return NextResponse.json({ application_case_id: null, documents: [] })
  const documents = await supabaseAdmin.from('onboarding_documents').select('id,kind,file_name,uploaded_at').eq('case_id', result.data.id)
  if (documents.error) return NextResponse.json({ error: documents.error.message }, { status: 500 })
  return NextResponse.json({ application_case_id: result.data.application_path ? result.data.id : null, documents: documents.data }, { headers: { 'Cache-Control': 'no-store' } })
}
