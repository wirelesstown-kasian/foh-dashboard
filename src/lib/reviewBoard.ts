import { cookies } from 'next/headers'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { AppSessionPayload, APP_SESSION_COOKIE, parseAppSessionValue } from '@/lib/appAuth'
import { Employee, GoogleReview, ReviewCategory, ReviewSentiment } from '@/lib/types'
import { employeeMatchesScheduleDepartment } from '@/lib/organization'

type ReviewRow = Omit<GoogleReview, 'matched_employee' | 'assigned_by_employee'>

export async function getReviewBoardViewer() {
  const cookieStore = await cookies()
  const session = parseAppSessionValue(cookieStore.get(APP_SESSION_COOKIE)?.value)
  const managerUnlocked = isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)

  return {
    session,
    managerUnlocked,
  }
}

export function requireViewerSession(session: AppSessionPayload | null) {
  return !!session
}

function normalizeCategories(value: unknown): ReviewCategory[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().toLowerCase())
    .filter((item): item is ReviewCategory =>
      item === 'food' || item === 'service' || item === 'wait_time' || item === 'ambiance' || item === 'price'
    )
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
}

export function normalizeReviewRow(row: ReviewRow, employees: Employee[]): GoogleReview {
  const matchedEmployee = row.matched_employee_id
    ? employees.find(employee => employee.id === row.matched_employee_id) ?? null
    : null
  const assignedByEmployee = row.assigned_by_employee_id
    ? employees.find(employee => employee.id === row.assigned_by_employee_id) ?? null
    : null

  return {
    ...row,
    sentiment: row.sentiment as ReviewSentiment | null,
    categories: normalizeCategories(row.categories),
    staff_mentions: normalizeStringArray(row.staff_mentions),
    matched_employee: matchedEmployee,
    assigned_by_employee: assignedByEmployee,
  }
}

export function getReviewBoardEmployees(employees: Employee[]) {
  return employees.filter(employee => employee.is_active && employeeMatchesScheduleDepartment(employee, 'foh'))
}

export function isReviewBoardSetupMissingError(error: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null | undefined) {
  if (!error) return false

  const code = error.code ?? ''
  const combinedText = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase()

  if (code === '42P01' || code === 'PGRST205') {
    return true
  }

  return combinedText.includes('google_reviews') && (
    combinedText.includes('could not find') ||
    combinedText.includes('does not exist') ||
    combinedText.includes('not found')
  )
}
