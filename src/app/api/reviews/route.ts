import { format, startOfMonth } from 'date-fns'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { buildPerformanceRows } from '@/lib/performanceReporting'
import { Employee, EodReport, GoogleReview, ShiftClock, TaskCompletion, TipDistribution } from '@/lib/types'
import { getReviewBoardEmployees, getReviewBoardViewer, isReviewBoardSetupMissingError, normalizeReviewRow, requireViewerSession } from '@/lib/reviewBoard'

type ReviewRouteResponse = {
  employees: Employee[]
  reviews: GoogleReview[]
  performanceScores: Record<string, number>
  manager_unlocked: boolean
  viewer: {
    employee_id: string
    name: string
    role: string
  }
  setup_required?: boolean
}

export async function GET() {
  const { session, managerUnlocked } = await getReviewBoardViewer()
  if (!requireViewerSession(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = format(new Date(), 'yyyy-MM-dd')
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')

  const [
    employeesResult,
    reviewsResult,
    completionsResult,
    eodReportsResult,
    clockRecordsResult,
  ] = await Promise.all([
    supabaseAdmin
      .from('employees')
      .select('id, name, phone, email, role, primary_department, hourly_wage, guaranteed_hourly, birth_date, login_enabled, is_active, created_at')
      .eq('is_active', true)
      .order('name'),
    supabaseAdmin
      .from('google_reviews')
      .select('*')
      .order('review_date', { ascending: false }),
    supabaseAdmin
      .from('task_completions')
      .select('*')
      .gte('session_date', monthStart)
      .lte('session_date', today),
    supabaseAdmin
      .from('eod_reports')
      .select('*, tip_distributions(*, employee:employees(*))')
      .gte('session_date', monthStart)
      .lte('session_date', today),
    supabaseAdmin
      .from('shift_clocks')
      .select('*')
      .gte('session_date', monthStart)
      .lte('session_date', today),
  ])

  if (employeesResult.error) {
    return NextResponse.json({ error: employeesResult.error.message }, { status: 500 })
  }

  if (reviewsResult.error) {
    if (isReviewBoardSetupMissingError(reviewsResult.error)) {
      const response: ReviewRouteResponse = {
        employees: getReviewBoardEmployees(employeesResult.data ?? []),
        reviews: [],
        performanceScores: {},
        manager_unlocked: managerUnlocked,
        viewer: {
          employee_id: session.employeeId,
          name: session.name,
          role: session.role,
        },
        setup_required: true,
      }
      return NextResponse.json(response)
    }

    return NextResponse.json({ error: reviewsResult.error.message }, { status: 500 })
  }

  if (completionsResult.error || eodReportsResult.error || clockRecordsResult.error) {
    return NextResponse.json({
      error: completionsResult.error?.message
        ?? eodReportsResult.error?.message
        ?? clockRecordsResult.error?.message
        ?? 'Failed to load review board data',
    }, { status: 500 })
  }

  const employees = getReviewBoardEmployees(employeesResult.data ?? [])
  const reviews = (reviewsResult.data ?? []).map(row => normalizeReviewRow(row as GoogleReview, employees))
  const { perfRows } = buildPerformanceRows({
    employees,
    completions: (completionsResult.data ?? []) as TaskCompletion[],
    eodReports: (eodReportsResult.data ?? []) as (EodReport & { tip_distributions?: (TipDistribution & { employee?: Employee })[] })[],
    clockRecords: (clockRecordsResult.data ?? []) as ShiftClock[],
    startDate: monthStart,
    endDate: today,
    monthStart,
    monthEnd: today,
  })

  const performanceScores = Object.fromEntries(
    perfRows.map(row => [row.emp.id, row.monthly?.score ?? 0])
  )

  const response: ReviewRouteResponse = {
    employees,
    reviews,
    performanceScores,
    manager_unlocked: managerUnlocked,
    viewer: {
      employee_id: session.employeeId,
      name: session.name,
      role: session.role,
    },
  }

  return NextResponse.json(response)
}
