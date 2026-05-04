import { endOfDay, endOfMonth, endOfWeek, startOfDay, startOfMonth, startOfWeek, subMonths } from 'date-fns'
import { Employee, GoogleReview, ReviewAttributionStatus, ReviewCategory } from '@/lib/types'

export type ReviewBoardRange = 'week' | 'month' | 'quarter' | 'custom'

export interface ReviewDateRangeFilter {
  mode: ReviewBoardRange
  startDate: string
  endDate: string
}

export interface ReviewLeaderboardEntry {
  employeeId: string
  employeeName: string
  reviewCount: number
  reviewPoints: number
  averageRating: number
  performanceScore: number
  combinedScore: number
}

export interface ReviewCategorySummaryItem {
  category: ReviewCategory
  label: string
  count: number
}

export interface StaffMentionSummaryItem {
  employeeId: string
  employeeName: string
  mentionCount: number
}

export const REVIEW_CATEGORY_LABELS: Record<ReviewCategory, string> = {
  food: 'Food',
  service: 'Service',
  wait_time: 'Wait Time',
  ambiance: 'Ambiance',
  price: 'Price',
}

export function reviewPointsFromRating(rating: number) {
  if (rating >= 5) return 10
  if (rating === 4) return 5
  if (rating === 3) return 0
  if (rating === 2) return -5
  return -10
}

export function getReviewBadgeLabel(status: ReviewAttributionStatus) {
  switch (status) {
    case 'auto_match':
      return 'Auto-Match'
    case 'ai_estimate':
      return 'AI Estimate'
    case 'manual':
      return 'Manual'
    default:
      return 'Unassigned'
  }
}

export function getReviewBadgeClassName(status: ReviewAttributionStatus) {
  switch (status) {
    case 'auto_match':
      return 'border-emerald-300 bg-emerald-50 text-emerald-700'
    case 'ai_estimate':
      return 'border-amber-300 bg-amber-50 text-amber-700'
    case 'manual':
      return 'border-sky-300 bg-sky-50 text-sky-700'
    default:
      return 'border-orange-300 bg-orange-50 text-orange-700'
  }
}

function formatDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function createDefaultReviewDateRange(today = new Date()): ReviewDateRangeFilter {
  return {
    mode: 'quarter',
    startDate: formatDateInputValue(startOfDay(subMonths(today, 3))),
    endDate: formatDateInputValue(endOfDay(today)),
  }
}

export function resolveReviewDateRange(filter: ReviewDateRangeFilter, today = new Date()) {
  if (filter.mode === 'week') {
    return {
      start: startOfWeek(today, { weekStartsOn: 1 }),
      end: endOfWeek(today, { weekStartsOn: 1 }),
      label: 'This Week',
    }
  }

  if (filter.mode === 'month') {
    return {
      start: startOfMonth(today),
      end: endOfMonth(today),
      label: 'This Month',
    }
  }

  if (filter.mode === 'quarter') {
    return {
      start: startOfDay(subMonths(today, 3)),
      end: endOfDay(today),
      label: '3 Months',
    }
  }

  const start = filter.startDate ? startOfDay(new Date(`${filter.startDate}T12:00:00`)) : startOfMonth(today)
  const end = filter.endDate ? endOfDay(new Date(`${filter.endDate}T12:00:00`)) : endOfDay(today)
  const orderedRange = start <= end ? { start, end } : { start: end, end: start }
  return {
    ...orderedRange,
    label: 'Custom Range',
  }
}

export function filterReviewsByRange(reviews: GoogleReview[], filter: ReviewDateRangeFilter, today = new Date()) {
  const { start, end } = resolveReviewDateRange(filter, today)

  return reviews.filter(review => {
    const reviewDate = new Date(`${review.review_date}T12:00:00`)
    return reviewDate >= start && reviewDate <= end
  })
}

function normalizeReviewCategory(value: string): ReviewCategory | null {
  if (value === 'food' || value === 'service' || value === 'wait_time' || value === 'ambiance' || value === 'price') {
    return value
  }
  return null
}

function normalizeText(value: string) {
  return value.trim().toLowerCase()
}

function matchMentionToEmployee(mention: string, employees: Employee[]) {
  const normalizedMention = normalizeText(mention)
  if (!normalizedMention) return null

  return employees.find(employee => {
    const normalizedName = normalizeText(employee.name)
    if (normalizedName === normalizedMention) return true

    const nameParts = normalizedName.split(/\s+/).filter(Boolean)
    return nameParts.some(part => part === normalizedMention) || normalizedName.includes(normalizedMention)
  }) ?? null
}

export function buildReviewBoardSummary({
  reviews,
  employees,
  performanceScores,
}: {
  reviews: GoogleReview[]
  employees: Employee[]
  performanceScores: Map<string, number>
}) {
  const categoryCounts = new Map<ReviewCategory, number>()
  const mentionCounts = new Map<string, number>()
  const leaderboard = new Map<string, { employee: Employee; reviewCount: number; reviewPoints: number; ratingTotal: number }>()

  for (const review of reviews) {
    for (const rawCategory of review.categories ?? []) {
      const category = normalizeReviewCategory(rawCategory)
      if (!category) continue
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1)
    }

    const uniqueMentions = new Set<string>()
    for (const mention of review.staff_mentions ?? []) {
      const employee = matchMentionToEmployee(mention, employees)
      if (!employee || uniqueMentions.has(employee.id)) continue
      uniqueMentions.add(employee.id)
      mentionCounts.set(employee.id, (mentionCounts.get(employee.id) ?? 0) + 1)
    }

    if (!review.matched_employee_id) continue
    const employee = employees.find(item => item.id === review.matched_employee_id)
    if (!employee) continue

    const existing = leaderboard.get(employee.id) ?? {
      employee,
      reviewCount: 0,
      reviewPoints: 0,
      ratingTotal: 0,
    }

    existing.reviewCount += 1
    existing.reviewPoints += review.points
    existing.ratingTotal += review.rating
    leaderboard.set(employee.id, existing)
  }

  const categorySummary: ReviewCategorySummaryItem[] = (Object.keys(REVIEW_CATEGORY_LABELS) as ReviewCategory[])
    .map(category => ({
      category,
      label: REVIEW_CATEGORY_LABELS[category],
      count: categoryCounts.get(category) ?? 0,
    }))

  const staffMentionSummary: StaffMentionSummaryItem[] = Array.from(mentionCounts.entries())
    .map(([employeeId, mentionCount]) => {
      const employee = employees.find(item => item.id === employeeId)
      return employee ? { employeeId, employeeName: employee.name, mentionCount } : null
    })
    .filter((item): item is StaffMentionSummaryItem => item !== null)
    .sort((left, right) => right.mentionCount - left.mentionCount || left.employeeName.localeCompare(right.employeeName))

  const reviewLeaderboard: ReviewLeaderboardEntry[] = Array.from(leaderboard.values())
    .map(item => {
      const performanceScore = performanceScores.get(item.employee.id) ?? 0
      return {
        employeeId: item.employee.id,
        employeeName: item.employee.name,
        reviewCount: item.reviewCount,
        reviewPoints: item.reviewPoints,
        averageRating: item.reviewCount > 0 ? item.ratingTotal / item.reviewCount : 0,
        performanceScore,
        combinedScore: performanceScore + item.reviewPoints,
      }
    })
    .sort((left, right) =>
      right.combinedScore - left.combinedScore ||
      right.reviewPoints - left.reviewPoints ||
      right.reviewCount - left.reviewCount ||
      left.employeeName.localeCompare(right.employeeName)
    )

  return {
    categorySummary,
    staffMentionSummary,
    reviewLeaderboard,
  }
}
