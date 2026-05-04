import { NextRequest, NextResponse } from 'next/server'
import { reviewPointsFromRating } from '@/lib/reviewScoring'
import { getReviewBoardViewer, normalizeReviewRow, requireViewerSession } from '@/lib/reviewBoard'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { GoogleReview } from '@/lib/types'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, managerUnlocked } = await getReviewBoardViewer()
  if (!requireViewerSession(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!managerUnlocked) {
    return NextResponse.json({ error: 'Manager PIN required' }, { status: 401 })
  }

  const { id } = await params
  const { employee_id, note } = await req.json() as { employee_id?: string | null; note?: string }

  const reviewResult = await supabaseAdmin
    .from('google_reviews')
    .select('*')
    .eq('id', id)
    .single()

  if (reviewResult.error || !reviewResult.data) {
    return NextResponse.json({ error: reviewResult.error?.message ?? 'Review not found' }, { status: 404 })
  }

  let employeeName: string | null = null
  if (employee_id) {
    const employeeResult = await supabaseAdmin
      .from('employees')
      .select('id, name')
      .eq('id', employee_id)
      .eq('is_active', true)
      .single()

    if (employeeResult.error || !employeeResult.data) {
      return NextResponse.json({ error: employeeResult.error?.message ?? 'Employee not found' }, { status: 404 })
    }
    employeeName = employeeResult.data.name
  }

  const updatePayload = {
    matched_employee_id: employee_id ?? null,
    confidence: employee_id ? 100 : null,
    reason: typeof note === 'string' && note.trim()
      ? note.trim()
      : employee_id
        ? 'Manager assignment override'
        : 'Manager cleared assignment',
    attribution_status: employee_id ? 'manual' : 'unassigned',
    assigned_method: employee_id ? 'manager_override' : 'manager_clear',
    assigned_by_employee_id: session.employeeId,
    points: reviewPointsFromRating(reviewResult.data.rating),
    updated_at: new Date().toISOString(),
  }

  const updateResult = await supabaseAdmin
    .from('google_reviews')
    .update(updatePayload)
    .eq('id', id)
    .select('*')
    .single()

  if (updateResult.error || !updateResult.data) {
    return NextResponse.json({ error: updateResult.error?.message ?? 'Failed to update review' }, { status: 500 })
  }

  const auditResult = await supabaseAdmin.from('review_assignments').insert({
    review_id: id,
    previous_employee_id: reviewResult.data.matched_employee_id,
    next_employee_id: employee_id ?? null,
    assigned_by_employee_id: session.employeeId,
    assignment_method: employee_id ? 'manual_override' : 'clear_assignment',
    note: typeof note === 'string' && note.trim() ? note.trim() : null,
  })

  if (auditResult.error) {
    return NextResponse.json({ error: auditResult.error.message }, { status: 500 })
  }

  const employeesResult = await supabaseAdmin
    .from('employees')
    .select('id, name, phone, email, role, primary_department, hourly_wage, guaranteed_hourly, birth_date, login_enabled, is_active, created_at')
    .eq('is_active', true)
    .order('name')

  if (employeesResult.error) {
    return NextResponse.json({ error: employeesResult.error.message }, { status: 500 })
  }

  const normalized = normalizeReviewRow(updateResult.data as GoogleReview, employeesResult.data ?? [])

  return NextResponse.json({
    success: true,
    review: normalized,
    assigned_employee_name: employeeName,
  })
}
