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
import { RewardCatalogItem } from '@/lib/types'
import { cn } from '@/lib/utils'

interface ReviewBoardSummaryProps {
  dateFilter: ReviewDateRangeFilter
  onRangeChange: (range: ReviewBoardRange) => void
  onCustomDateChange: (field: 'startDate' | 'endDate', value: string) => void
  categorySummary: ReviewCategorySummaryItem[]
  staffMentionSummary: StaffMentionSummaryItem[]
  reviewLeaderboard: ReviewLeaderboardEntry[]
  rewards: RewardCatalogItem[]
  selectedEmployeeId: string | null
  onSelectEmployee: (employeeId: string) => void
  collapsedSections: {
    categories: boolean
    mentions: boolean
    leaderboard: boolean
    rewards: boolean
  }
  onToggleSection: (section: 'categories' | 'mentions' | 'leaderboard' | 'rewards') => void
}

const rangeOptions: Array<{ value: ReviewBoardRange; label: string }> = [
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'quarter', label: '3 Months' },
  { value: 'all', label: 'All-Time' },
  { value: 'custom', label: 'Custom Range' },
]

const sectionDetails = {
  leaderboard: {
    number: '01',
    title: 'Ranking Board',
    description: 'Staff ranking, review points, and combined score.',
  },
  rewards: {
    number: '02',
    title: 'Rewards List',
    description: 'Point costs for redeemable staff rewards.',
  },
  mentions: {
    number: '03',
    title: 'Staff Mentions',
    description: 'Direct employee mentions found in reviews.',
  },
  categories: {
    number: '04',
    title: 'Content Summary',
    description: 'Review themes by service, food, wait time, and more.',
  },
} as const

export function ReviewBoardSummary({
  dateFilter,
  onRangeChange,
  onCustomDateChange,
  categorySummary,
  staffMentionSummary,
  reviewLeaderboard,
  rewards,
  selectedEmployeeId,
  onSelectEmployee,
  collapsedSections,
  onToggleSection,
}: ReviewBoardSummaryProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-5">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Review Filters</div>
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
        <div className="grid min-h-full grid-cols-1 gap-4">
          <section className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <button
              type="button"
              onClick={() => onToggleSection('leaderboard')}
              aria-expanded={!collapsedSections.leaderboard}
              className="flex w-full items-start justify-between gap-3 text-left"
            >
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-600">Section {sectionDetails.leaderboard.number}</div>
                <div className="mt-1 text-sm font-bold text-slate-900">{sectionDetails.leaderboard.title}</div>
                <p className="mt-1 text-xs leading-5 text-slate-500">{sectionDetails.leaderboard.description}</p>
              </div>
              {collapsedSections.leaderboard ? <ChevronDown className="mt-1 h-4 w-4 text-slate-500" /> : <ChevronUp className="mt-1 h-4 w-4 text-slate-500" />}
            </button>
            {!collapsedSections.leaderboard && (
              <div className="mt-4 space-y-2">
                {reviewLeaderboard.length === 0 ? (
                  <div className="rounded-lg bg-white px-4 py-4 text-sm text-slate-500">No attributed reviews in this range yet.</div>
                ) : (
                  reviewLeaderboard.map((item, index) => (
                    <button
                      key={item.employeeId}
                      type="button"
                      onClick={() => onSelectEmployee(item.employeeId)}
                      className={cn(
                        'w-full rounded-lg border px-4 py-3 text-left transition-colors',
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
                          <div className={cn(
                            'text-lg font-bold',
                            item.reviewPoints > 0 ? 'text-emerald-600' : item.reviewPoints < 0 ? 'text-red-600' : 'text-slate-950'
                          )}>
                            {item.reviewPoints > 0 ? '+' : ''}{item.reviewPoints}
                          </div>
                          <div className="text-xs text-slate-500">Perf {item.performanceScore} • Combined {item.combinedScore}</div>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <button
              type="button"
              onClick={() => onToggleSection('rewards')}
              aria-expanded={!collapsedSections.rewards}
              className="flex w-full items-start justify-between gap-3 text-left"
            >
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-600">Section {sectionDetails.rewards.number}</div>
                <div className="mt-1 text-sm font-bold text-slate-900">{sectionDetails.rewards.title}</div>
                <p className="mt-1 text-xs leading-5 text-slate-500">{sectionDetails.rewards.description}</p>
              </div>
              {collapsedSections.rewards ? <ChevronDown className="mt-1 h-4 w-4 text-slate-500" /> : <ChevronUp className="mt-1 h-4 w-4 text-slate-500" />}
            </button>
            {!collapsedSections.rewards && (
              <div className="mt-4 space-y-2">
                {rewards.length === 0 ? (
                  <div className="rounded-lg bg-white px-4 py-4 text-sm text-slate-500">No rewards created yet.</div>
                ) : (
                  rewards.map(item => (
                    <div key={item.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold text-slate-900">{item.name}</span>
                        <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">{item.points_cost} pts</span>
                      </div>
                      {item.description && <p className="mt-1 text-xs text-slate-500">{item.description}</p>}
                    </div>
                  ))
                )}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <button
              type="button"
              onClick={() => onToggleSection('mentions')}
              aria-expanded={!collapsedSections.mentions}
              className="flex w-full items-start justify-between gap-3 text-left"
            >
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-600">Section {sectionDetails.mentions.number}</div>
                <div className="mt-1 text-sm font-bold text-slate-900">{sectionDetails.mentions.title}</div>
                <p className="mt-1 text-xs leading-5 text-slate-500">{sectionDetails.mentions.description}</p>
              </div>
              {collapsedSections.mentions ? <ChevronDown className="mt-1 h-4 w-4 text-slate-500" /> : <ChevronUp className="mt-1 h-4 w-4 text-slate-500" />}
            </button>
            {!collapsedSections.mentions && (
              <div className="mt-4 space-y-2">
                {staffMentionSummary.length === 0 ? (
                  <div className="rounded-lg bg-white px-4 py-4 text-sm text-slate-500">No direct staff mentions in this range.</div>
                ) : (
                  staffMentionSummary.map(item => (
                    <button
                      key={item.employeeId}
                      type="button"
                      onClick={() => onSelectEmployee(item.employeeId)}
                      className={cn(
                        'flex min-h-11 w-full items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition-colors',
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

          <section className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <button
              type="button"
              onClick={() => onToggleSection('categories')}
              aria-expanded={!collapsedSections.categories}
              className="flex w-full items-start justify-between gap-3 text-left"
            >
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-600">Section {sectionDetails.categories.number}</div>
                <div className="mt-1 text-sm font-bold text-slate-900">{sectionDetails.categories.title}</div>
                <p className="mt-1 text-xs leading-5 text-slate-500">{sectionDetails.categories.description}</p>
              </div>
              {collapsedSections.categories ? <ChevronDown className="mt-1 h-4 w-4 text-slate-500" /> : <ChevronUp className="mt-1 h-4 w-4 text-slate-500" />}
            </button>
            {!collapsedSections.categories && (
              <div className="mt-4 space-y-2">
                {categorySummary.map(item => (
                  <div key={item.category} className="flex items-center justify-between rounded-lg bg-white px-4 py-3 text-sm">
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
