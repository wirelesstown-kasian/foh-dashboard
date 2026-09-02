import { Employee, GoogleReview, RewardRedemption, Task, TaskCompletion } from '@/lib/types'
import { getReviewNamedEmployeeIds } from '@/lib/reviewScoring'

export function getTaskPointValue(task?: Pick<Task, 'points'> | null) {
  const value = Number(task?.points ?? 0)
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

export function getCompletionPoints(completion: TaskCompletion, task?: Pick<Task, 'points'> | null) {
  if (completion.status === 'incomplete') return 0
  const awarded = Number(completion.points_awarded)
  if (Number.isFinite(awarded)) return Math.round(awarded)
  return getTaskPointValue(task ?? completion.task)
}

export function getReviewEmployeeIds(review: Pick<GoogleReview, 'matched_employee_id' | 'matched_employee_ids' | 'attribution_status' | 'assigned_method'>) {
  if (review.attribution_status === 'unassigned' || review.assigned_method === 'manager_clear' || review.assigned_method === 'clear_assignment') {
    return []
  }

  const ids = Array.isArray(review.matched_employee_ids) && review.matched_employee_ids.length > 0
    ? review.matched_employee_ids
    : review.matched_employee_id
      ? [review.matched_employee_id]
      : []
  return Array.from(new Set(ids.filter(Boolean)))
}

export type EmployeeRewardPointRow = {
  employee: Employee
  taskPoints: number
  reviewPoints: number
  redeemedPoints: number
  totalPoints: number
  completedTasks: number
  reviews: number
}

export function buildEmployeeRewardPointRows({
  employees,
  tasks,
  completions,
  reviews,
  redemptions,
}: {
  employees: Employee[]
  tasks: Task[]
  completions: TaskCompletion[]
  reviews: GoogleReview[]
  redemptions: RewardRedemption[]
}) {
  const activeEmployees = employees.filter(employee => employee.is_active)
  const activeEmployeeIds = new Set(activeEmployees.map(employee => employee.id))
  const taskById = new Map(tasks.map(task => [task.id, task]))
  const rows = new Map<string, EmployeeRewardPointRow>()

  for (const employee of activeEmployees) {
    rows.set(employee.id, {
      employee,
      taskPoints: 0,
      reviewPoints: 0,
      redeemedPoints: 0,
      totalPoints: 0,
      completedTasks: 0,
      reviews: 0,
    })
  }

  for (const completion of completions) {
    const row = rows.get(completion.employee_id)
    if (!row || completion.status === 'incomplete') continue
    const points = getCompletionPoints(completion, taskById.get(completion.task_id))
    row.taskPoints += points
    row.completedTasks += 1
  }

  for (const review of reviews) {
    const namedEmployeeIds = new Set(getReviewNamedEmployeeIds(review, activeEmployees))
    const employeeIds = getReviewEmployeeIds(review).filter(employeeId => activeEmployeeIds.has(employeeId) && namedEmployeeIds.has(employeeId))
    if (employeeIds.length === 0) continue
    const points = Math.round(Number(review.points ?? 0))
    for (const employeeId of employeeIds) {
      const row = rows.get(employeeId)
      if (!row) continue
      row.reviewPoints += points
      row.reviews += 1
    }
  }

  for (const redemption of redemptions) {
    const row = rows.get(redemption.employee_id)
    if (!row) continue
    row.redeemedPoints += Number(redemption.points_delta ?? 0)
  }

  return Array.from(rows.values())
    .map(row => ({
      ...row,
      totalPoints: row.taskPoints + row.reviewPoints + row.redeemedPoints,
    }))
    .sort((left, right) => right.totalPoints - left.totalPoints || left.employee.name.localeCompare(right.employee.name))
}
