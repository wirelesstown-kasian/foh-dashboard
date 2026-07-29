import { NextRequest, NextResponse } from 'next/server'
import { reviewPointsFromRating } from '@/lib/reviewScoring'
import { getReviewBoardViewer, normalizeReviewRow, requireViewerSession } from '@/lib/reviewBoard'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { GoogleReview } from '@/lib/types'
import { withTipPoolHourlyRate } from '@/lib/employeeSelect'

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
  const { employee_id, employee_ids, note } = await req.json() as {
    employee_id?: string | null
    employee_ids?: string[]
    note?: string
  }
  const requestedEmployeeIds = Array.from(new Set(
    (Array.isArray(employee_ids) ? employee_ids : employee_id ? [employee_id] : [])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  ))

  const reviewResult = await supabaseAdmin
    .from('google_reviews')
    .select('*')
    .eq('id', id)
    .single()

  if (reviewResult.error || !reviewResult.data) {
    return NextResponse.json({ error: reviewResult.error?.message ?? 'Review not found' }, { status: 404 })
  }

  let employeeNames: string[] = []
  if (requestedEmployeeIds.length > 0) {
    const employeeResult = await supabaseAdmin
      .from('employees')
      .select('id, name')
      .in('id', requestedEmployeeIds)
      .eq('is_active', true)

    if (employeeResult.error) {
      return NextResponse.json({ error: employeeResult.error.message }, { status: 404 })
    }

    const employeesById = new Map((employeeResult.data ?? []).map(employee => [employee.id, employee.name]))
    const missingEmployeeId = requestedEmployeeIds.find(employeeId => !employeesById.has(employeeId))
    if (missingEmployeeId) {
      return NextResponse.json({ error: `Employee not found: ${missingEmployeeId}` }, { status: 404 })
    }
    employeeNames = requestedEmployeeIds.map(employeeId => employeesById.get(employeeId)!)
  }

  const primaryEmployeeId = requestedEmployeeIds[0] ?? null
  const updatePayload = {
    matched_employee_id: primaryEmployeeId,
    matched_employee_ids: requestedEmployeeIds,
    confidence: requestedEmployeeIds.length > 0 ? 100 : null,
    reason: typeof note === 'string' && note.trim()
      ? note.trim()
      : requestedEmployeeIds.length > 0
        ? 'Manager assignment override'
        : 'Manager cleared assignment',
    attribution_status: requestedEmployeeIds.length > 0 ? 'manual' : 'unassigned',
    assigned_method: requestedEmployeeIds.length > 0 ? 'manager_override' : 'manager_clear',
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
    previous_employee_ids: Array.isArray(reviewResult.data.matched_employee_ids)
      ? reviewResult.data.matched_employee_ids
      : reviewResult.data.matched_employee_id
        ? [reviewResult.data.matched_employee_id]
        : [],
    next_employee_id: primaryEmployeeId,
    next_employee_ids: requestedEmployeeIds,
    assigned_by_employee_id: session.employeeId,
    assignment_method: requestedEmployeeIds.length > 0 ? 'manual_override' : 'clear_assignment',
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

  const normalized = normalizeReviewRow(updateResult.data as GoogleReview, withTipPoolHourlyRate(employeesResult.data ?? []))

  return NextResponse.json({
    success: true,
    review: normalized,
    assigned_employee_name: employeeNames[0] ?? null,
    assigned_employee_names: employeeNames,
  })
}
