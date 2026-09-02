import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { Employee, GoogleReview, Task, TaskCompletion } from '@/lib/types'
import { getReviewBoardEmployees, getReviewBoardViewer, isReviewBoardSetupMissingError, normalizeReviewRow } from '@/lib/reviewBoard'
import { withTipPoolHourlyRate } from '@/lib/employeeSelect'
import { getCompletionPoints } from '@/lib/rewards'

type ReviewRouteResponse = {
  employees: Employee[]
  reviews: GoogleReview[]
  taskPoints: Record<string, number>
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

  const [
    employeesResult,
    reviewsResult,
    completionsResult,
    tasksResult,
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
      .select('*, task:tasks(*)'),
    supabaseAdmin
      .from('tasks')
      .select('*')
  ])

  if (employeesResult.error) {
    return NextResponse.json({ error: employeesResult.error.message }, { status: 500 })
  }

  if (reviewsResult.error) {
    if (isReviewBoardSetupMissingError(reviewsResult.error)) {
      const response: ReviewRouteResponse = {
        employees: getReviewBoardEmployees(withTipPoolHourlyRate(employeesResult.data ?? [])),
        reviews: [],
        taskPoints: {},
        manager_unlocked: managerUnlocked,
        viewer: {
          employee_id: session?.employeeId ?? '',
          name: session?.name ?? 'Manager',
          role: session?.role ?? 'manager',
        },
        setup_required: true,
      }
      return NextResponse.json(response)
    }

    return NextResponse.json({ error: reviewsResult.error.message }, { status: 500 })
  }

  if (completionsResult.error || tasksResult.error) {
    return NextResponse.json({
      error: completionsResult.error?.message
        ?? tasksResult.error?.message
        ?? 'Failed to load review board data',
    }, { status: 500 })
  }

  const employees = getReviewBoardEmployees(withTipPoolHourlyRate(employeesResult.data ?? []))
  const reviews = (reviewsResult.data ?? []).map(row => normalizeReviewRow(row as GoogleReview, employees))
  const taskById = new Map(((tasksResult.data ?? []) as Task[]).map(task => [task.id, task]))
  const taskPoints = ((completionsResult.data ?? []) as TaskCompletion[])
    .reduce<Record<string, number>>((totals, completion) => {
      totals[completion.employee_id] = (totals[completion.employee_id] ?? 0) + getCompletionPoints(completion, taskById.get(completion.task_id))
      return totals
    }, {})

  const response: ReviewRouteResponse = {
    employees,
    reviews,
    taskPoints,
    manager_unlocked: managerUnlocked,
    viewer: {
      employee_id: session?.employeeId ?? '',
      name: session?.name ?? 'Manager',
      role: session?.role ?? 'manager',
    },
  }

  return NextResponse.json(response)
}
