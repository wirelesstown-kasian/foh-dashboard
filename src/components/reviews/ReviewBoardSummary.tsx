'use client'

import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ReviewBoardRange,
  ReviewCategorySummaryItem,
  ReviewDateRangeFilter,
  ReviewLeaderboardEntry,
  StaffMentionSummaryItem,
} from '@/lib/reviewScoring'
import { cn } from '@/lib/utils'

interface ReviewBoardSummaryProps {
  dateFilter: ReviewDateRangeFilter
  onRangeChange: (range: ReviewBoardRange) => void
  onCustomDateChange: (field: 'startDate' | 'endDate', value: string) => void
  categorySummary: ReviewCategorySummaryItem[]
  staffMentionSummary: StaffMentionSummaryItem[]
  reviewLeaderboard: ReviewLeaderboardEntry[]
  selectedEmployeeId: string | null
  onSelectEmployee: (employeeId: string) => void
  collapsedSections: {
    categories: boolean
    mentions: boolean
    leaderboard: boolean
  }
  onToggleSection: (section: 'categories' | 'mentions' | 'leaderboard') => void
}

const rangeOptions: Array<{ value: ReviewBoardRange; label: string }> = [
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'quarter', label: '3 Months' },
  { value: 'custom', label: 'Custom Range' },
]

export function ReviewBoardSummary({
  dateFilter,
  onRangeChange,
  onCustomDateChange,
  categorySummary,
  staffMentionSummary,
  reviewLeaderboard,
  selectedEmployeeId,
  onSelectEmployee,
  collapsedSections,
  onToggleSection,
}: ReviewBoardSummaryProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-5">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Summary Panel</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {rangeOptions.map(option => (
            <Button
              key={option.value}
              variant={dateFilter.mode === option.value ? 'default' : 'outline'}
              className={cn('h-11 min-w-24 text-sm font-semibold', dateFilter.mode === option.value && 'bg-slate-900 text-white')}
              onClick={() => onRangeChange(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        {dateFilter.mode === 'custom' && (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              type="date"
              value={dateFilter.startDate}
              onChange={event => onCustomDateChange('startDate', event.target.value)}
              className="h-11 text-sm"
            />
            <Input
              type="date"
              value={dateFilter.endDate}
              onChange={event => onCustomDateChange('endDate', event.target.value)}
              className="h-11 text-sm"
            />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="flex min-h-full flex-col gap-5">
          <section className="space-y-3">
            <button
              type="button"
              onClick={() => onToggleSection('leaderboard')}
              className="flex w-full items-center justify-between text-left"
            >
              <div className="text-sm font-bold text-slate-900">Review Score Leaderboard</div>
              {collapsedSections.leaderboard ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronUp className="h-4 w-4 text-slate-500" />}
            </button>
            {!collapsedSections.leaderboard && (
              <div className="space-y-2">
                {reviewLeaderboard.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">No attributed reviews in this range yet.</div>
                ) : (
                  reviewLeaderboard.map((item, index) => (
                    <button
                      key={item.employeeId}
                      type="button"
                      onClick={() => onSelectEmployee(item.employeeId)}
                      className={cn(
                        'w-full rounded-2xl border px-4 py-3 text-left transition-colors',
                        selectedEmployeeId === item.employeeId
                          ? 'border-amber-300 bg-amber-50'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">#{index + 1}</div>
                          <div className="truncate text-sm font-bold text-slate-900">{item.employeeName}</div>
                          <div className="mt-1 text-xs text-slate-500">{item.reviewCount} reviews</div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold text-slate-950">{item.combinedScore}</div>
                          <div className="text-xs text-slate-500">Perf {item.performanceScore} + Review {item.reviewPoints}</div>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <button
              type="button"
              onClick={() => onToggleSection('mentions')}
              className="flex w-full items-center justify-between text-left"
            >
              <div className="text-sm font-bold text-slate-900">Staff Mention Summary</div>
              {collapsedSections.mentions ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronUp className="h-4 w-4 text-slate-500" />}
            </button>
            {!collapsedSections.mentions && (
              <div className="space-y-2">
                {staffMentionSummary.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">No direct staff mentions in this range.</div>
                ) : (
                  staffMentionSummary.map(item => (
                    <button
                      key={item.employeeId}
                      type="button"
                      onClick={() => onSelectEmployee(item.employeeId)}
                      className={cn(
                        'flex min-h-11 w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm transition-colors',
                        selectedEmployeeId === item.employeeId
                          ? 'border-amber-300 bg-amber-50'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      )}
                    >
                      <span className="font-medium text-slate-700">{item.employeeName}</span>
                      <span className="font-bold text-slate-950">{item.mentionCount}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <button
              type="button"
              onClick={() => onToggleSection('categories')}
              className="flex w-full items-center justify-between text-left"
            >
              <div className="text-sm font-bold text-slate-900">Content Summary</div>
              {collapsedSections.categories ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronUp className="h-4 w-4 text-slate-500" />}
            </button>
            {!collapsedSections.categories && (
              <div className="space-y-2">
                {categorySummary.map(item => (
                  <div key={item.category} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-sm">
                    <span className="font-medium text-slate-700">{item.label}</span>
                    <span className="text-base font-bold text-slate-950">{item.count}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
