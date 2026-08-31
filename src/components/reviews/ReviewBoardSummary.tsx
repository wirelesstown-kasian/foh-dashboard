'use client'

import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ReviewBoardRange,
  ReviewCategorySummaryItem,
  ReviewDateRangeFilter,
  ReviewLeaderboardEntry,
} from '@/lib/reviewScoring'
import { GoogleReview, RewardCatalogItem } from '@/lib/types'
import { cn } from '@/lib/utils'

interface ReviewBoardSummaryProps {
  dateFilter: ReviewDateRangeFilter
  onRangeChange: (range: ReviewBoardRange) => void
  onCustomDateChange: (field: 'startDate' | 'endDate', value: string) => void
  categorySummary: ReviewCategorySummaryItem[]
  recentReviews: GoogleReview[]
  reviewLeaderboard: ReviewLeaderboardEntry[]
  rewards: RewardCatalogItem[]
  selectedEmployeeId: string | null
  onSelectEmployee: (employeeId: string) => void
  collapsedSections: {
    categories: boolean
    recentReviews: boolean
    leaderboard: boolean
    rewards: boolean
  }
  onToggleSection: (section: 'categories' | 'recentReviews' | 'leaderboard' | 'rewards') => void
}

const rangeOptions: Array<{ value: ReviewBoardRange; label: string }> = [
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'quarter', label: '3 Months' },
  { value: 'all', label: 'All-Time' },
  { value: 'custom', label: 'Custom Range' },
]

const sectionDetails = {
  recentReviews: {
    number: '01',
    title: 'Recent Reviews',
    description: 'Newest filtered reviews in a scrollable list.',
  },
  leaderboard: {
    number: '02',
    title: 'Ranking Board',
    description: 'Staff ranking, review points, and combined score.',
  },
  categories: {
    number: '03',
    title: 'Content Summary',
    description: 'Review themes by service, food, wait time, and more.',
  },
  rewards: {
    number: '04',
    title: 'Rewards List',
    description: 'Point costs for redeemable staff rewards.',
  },
} as const

const getReviewEmployeeNames = (review: GoogleReview) => {
  const matchedEmployees = (review.matched_employees ?? []).length > 0
    ? review.matched_employees ?? []
    : review.matched_employee
      ? [review.matched_employee]
      : []

  return matchedEmployees.map(employee => employee.name)
}

export function ReviewBoardSummary({
  dateFilter,
  onRangeChange,
  onCustomDateChange,
  categorySummary,
  recentReviews,
  reviewLeaderboard,
  rewards,
  selectedEmployeeId,
  onSelectEmployee,
  collapsedSections,
  onToggleSection,
}: ReviewBoardSummaryProps) {
  const sortedRecentReviews = [...recentReviews]
    .sort((left, right) => right.review_date.localeCompare(left.review_date))
    .slice(0, 25)

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="shrink-0 border-b border-slate-100 px-3 py-2">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Review Filters</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {rangeOptions.map(option => (
              <Button
                key={option.value}
                variant={dateFilter.mode === option.value ? 'default' : 'outline'}
                className={cn('h-8 min-w-20 px-2.5 text-xs font-semibold', dateFilter.mode === option.value && 'bg-slate-900 text-white')}
                onClick={() => onRangeChange(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
        {dateFilter.mode === 'custom' && (
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              type="date"
              value={dateFilter.startDate}
              onChange={event => onCustomDateChange('startDate', event.target.value)}
              className="h-8 text-xs"
            />
            <Input
              type="date"
              value={dateFilter.endDate}
              onChange={event => onCustomDateChange('endDate', event.target.value)}
              className="h-8 text-xs"
            />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 px-3 py-3">
        <div className="grid h-full grid-cols-1 gap-2 lg:grid-cols-2 lg:grid-rows-2">
          <section className="flex min-h-[14rem] flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 lg:min-h-0">
            <button
              type="button"
              onClick={() => onToggleSection('recentReviews')}
              aria-expanded={!collapsedSections.recentReviews}
              className="flex w-full items-start justify-between gap-3 text-left"
            >
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-600">{sectionDetails.recentReviews.number}</div>
                <div className="mt-0.5 text-sm font-bold text-slate-900">{sectionDetails.recentReviews.title}</div>
              </div>
              {collapsedSections.recentReviews ? <ChevronDown className="mt-1 h-4 w-4 text-slate-500" /> : <ChevronUp className="mt-1 h-4 w-4 text-slate-500" />}
            </button>
            {!collapsedSections.recentReviews && (
              <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-scroll pr-1">
                {sortedRecentReviews.length === 0 ? (
                  <div className="rounded-lg bg-white px-2.5 py-2 text-sm text-slate-500">No reviews in this range yet.</div>
                ) : (
                  sortedRecentReviews.map(review => {
                    const employeeNames = getReviewEmployeeNames(review)

                    return (
                      <div key={review.id} className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-bold text-slate-900">{review.author_name}</div>
                            <div className="mt-0.5 text-[11px] font-semibold text-slate-500">
                              {review.review_date} · {review.rating} star{review.rating === 1 ? '' : 's'}
                            </div>
                          </div>
                          <span className={cn(
                            'shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold',
                            review.points > 0 ? 'text-emerald-600' : review.points < 0 ? 'text-red-600' : 'text-slate-500'
                          )}>
                            {review.points > 0 ? '+' : ''}{review.points} pts
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-xs leading-4 text-slate-600">{review.review_text}</p>
                        {employeeNames.length > 0 && (
                          <div className="mt-0.5 truncate text-[11px] font-semibold text-amber-700">
                            {employeeNames.join(', ')}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </section>

          <section className="flex min-h-[14rem] flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 lg:min-h-0">
            <button
              type="button"
              onClick={() => onToggleSection('leaderboard')}
              aria-expanded={!collapsedSections.leaderboard}
              className="flex w-full items-start justify-between gap-3 text-left"
            >
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-600">{sectionDetails.leaderboard.number}</div>
                <div className="mt-0.5 text-sm font-bold text-slate-900">{sectionDetails.leaderboard.title}</div>
              </div>
              {collapsedSections.leaderboard ? <ChevronDown className="mt-1 h-4 w-4 text-slate-500" /> : <ChevronUp className="mt-1 h-4 w-4 text-slate-500" />}
            </button>
            {!collapsedSections.leaderboard && (
              <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                {reviewLeaderboard.length === 0 ? (
                  <div className="rounded-lg bg-white px-2.5 py-2 text-sm text-slate-500">No attributed reviews in this range yet.</div>
                ) : (
                  reviewLeaderboard.map((item, index) => (
                    <button
                      key={item.employeeId}
                      type="button"
                      onClick={() => onSelectEmployee(item.employeeId)}
                      className={cn(
                        'w-full rounded-md border px-2.5 py-1.5 text-left transition-colors',
                        selectedEmployeeId === item.employeeId
                          ? 'border-amber-300 bg-amber-50'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">#{index + 1}</div>
                          <div className="truncate text-sm font-bold text-slate-900">{item.employeeName}</div>
                          <div className="mt-0.5 text-xs text-slate-500">{item.reviewCount} reviews</div>
                        </div>
                        <div className="text-right">
                          <div className={cn(
                            'text-base font-bold',
                            item.reviewPoints > 0 ? 'text-emerald-600' : item.reviewPoints < 0 ? 'text-red-600' : 'text-slate-950'
                          )}>
                            {item.reviewPoints > 0 ? '+' : ''}{item.reviewPoints}
                          </div>
                          <div className="text-[11px] text-slate-500">Perf {item.performanceScore} · Combined {item.combinedScore}</div>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </section>

          <section className="flex min-h-[14rem] flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 lg:min-h-0">
            <button
              type="button"
              onClick={() => onToggleSection('categories')}
              aria-expanded={!collapsedSections.categories}
              className="flex w-full items-start justify-between gap-3 text-left"
            >
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-600">{sectionDetails.categories.number}</div>
                <div className="mt-0.5 text-sm font-bold text-slate-900">{sectionDetails.categories.title}</div>
              </div>
              {collapsedSections.categories ? <ChevronDown className="mt-1 h-4 w-4 text-slate-500" /> : <ChevronUp className="mt-1 h-4 w-4 text-slate-500" />}
            </button>
            {!collapsedSections.categories && (
              <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                {categorySummary.map(item => (
                  <div key={item.category} className="flex items-center justify-between rounded-md bg-white px-2.5 py-1.5 text-sm">
                    <span className="font-medium text-slate-700">{item.label}</span>
                    <span className="text-sm font-bold text-slate-950">{item.count}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="flex min-h-[14rem] flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 lg:min-h-0">
            <button
              type="button"
              onClick={() => onToggleSection('rewards')}
              aria-expanded={!collapsedSections.rewards}
              className="flex w-full items-start justify-between gap-3 text-left"
            >
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-600">{sectionDetails.rewards.number}</div>
                <div className="mt-0.5 text-sm font-bold text-slate-900">{sectionDetails.rewards.title}</div>
              </div>
              {collapsedSections.rewards ? <ChevronDown className="mt-1 h-4 w-4 text-slate-500" /> : <ChevronUp className="mt-1 h-4 w-4 text-slate-500" />}
            </button>
            {!collapsedSections.rewards && (
              <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                {rewards.length === 0 ? (
                  <div className="rounded-lg bg-white px-2.5 py-2 text-sm text-slate-500">No rewards created yet.</div>
                ) : (
                  rewards.map(item => (
                    <div key={item.id} className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold text-slate-900">{item.name}</span>
                        <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">{item.points_cost} pts</span>
                      </div>
                      {item.description && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{item.description}</p>}
                    </div>
                  ))
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
