'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PinModal } from '@/components/layout/PinModal'
import { AssignReviewDialog } from '@/components/reviews/AssignReviewDialog'
import { ReviewBoardSummary } from '@/components/reviews/ReviewBoardSummary'
import { ReviewFeed } from '@/components/reviews/ReviewFeed'
import {
  buildReviewBoardSummary,
  createDefaultReviewDateRange,
  filterReviewsByRange,
  resolveReviewDateRange,
  ReviewBoardRange,
  ReviewDateRangeFilter,
} from '@/lib/reviewScoring'
import { Employee, GoogleReview, RewardCatalogItem } from '@/lib/types'
import { ShieldCheck, UserRound } from 'lucide-react'

interface ReviewBoardResponse {
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

interface ActiveEmployeeFilter {
  employeeId: string
  employeeName: string
  source: 'my' | 'manager'
}

export function ReviewBoardClient() {
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [managerPinError, setManagerPinError] = useState<string | null>(null)
  const [staffPinError, setStaffPinError] = useState<string | null>(null)
  const [dateFilter, setDateFilter] = useState<ReviewDateRangeFilter>(() => createDefaultReviewDateRange())
  const [reviewSearch, setReviewSearch] = useState('')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [reviews, setReviews] = useState<GoogleReview[]>([])
  const [rewards, setRewards] = useState<RewardCatalogItem[]>([])
  const [performanceScores, setPerformanceScores] = useState<Record<string, number>>({})
  const [managerUnlocked, setManagerUnlocked] = useState(false)
  const [setupRequired, setSetupRequired] = useState(false)
  const [showMyReviewsPin, setShowMyReviewsPin] = useState(false)
  const [showManagerPin, setShowManagerPin] = useState(false)
  const [activeEmployeeFilter, setActiveEmployeeFilter] = useState<ActiveEmployeeFilter | null>(null)
  const [assignmentTarget, setAssignmentTarget] = useState<GoogleReview | null>(null)
  const [pendingAssignReview, setPendingAssignReview] = useState<GoogleReview | null>(null)
  const [collapsedSections, setCollapsedSections] = useState({
    categories: false,
    recentReviews: false,
    leaderboard: false,
    rewards: false,
  })

  const loadBoard = async () => {
    setLoading(true)
    setError(null)

    try {
      const [res, rewardsRes] = await Promise.all([
        fetch('/api/reviews', { cache: 'no-store' }),
        fetch('/api/rewards', { cache: 'no-store' }),
      ])
      const payload = (await res.json().catch(() => ({}))) as ReviewBoardResponse & { error?: string }
      const rewardsPayload = (await rewardsRes.json().catch(() => ({}))) as { rewards?: RewardCatalogItem[] }
      if (!res.ok) {
        throw new Error(payload.error ?? 'Failed to load review board')
      }

      setEmployees(payload.employees ?? [])
      setReviews(payload.reviews ?? [])
      setRewards(rewardsPayload.rewards ?? [])
      setPerformanceScores(payload.performanceScores ?? {})
      setManagerUnlocked(payload.manager_unlocked === true)
      setSetupRequired(payload.setup_required === true)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load review board')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadBoard()
  }, [])

  const filteredByRange = filterReviewsByRange(reviews, dateFilter)
  const filteredBySearch = filteredByRange.filter(review => {
    const query = reviewSearch.trim().toLowerCase()
    if (!query) return true
    const matchedNames = (review.matched_employees ?? [])
      .map(employee => employee.name)
      .join(' ')
    return [
      review.author_name,
      review.review_text,
      review.reason ?? '',
      matchedNames,
      review.staff_mentions.join(' '),
      review.categories.join(' '),
    ].join(' ').toLowerCase().includes(query)
  })
  const visibleReviews = activeEmployeeFilter
    ? filteredBySearch.filter(review => (
      (review.matched_employee_ids ?? []).includes(activeEmployeeFilter.employeeId) ||
      review.matched_employee_id === activeEmployeeFilter.employeeId
    ))
    : filteredBySearch
  const activeRangeLabel = resolveReviewDateRange(dateFilter).label

  const summary = buildReviewBoardSummary({
    reviews: visibleReviews,
    employees,
    performanceScores: new Map(Object.entries(performanceScores)),
  })
  const accumulatedSummary = buildReviewBoardSummary({
    reviews,
    employees,
    performanceScores: new Map(Object.entries(performanceScores)),
  })

  const activeFilterLabel = activeEmployeeFilter
    ? activeEmployeeFilter.source === 'my'
      ? `My Reviews • ${activeEmployeeFilter.employeeName}`
      : `Staff History • ${activeEmployeeFilter.employeeName}`
    : `All Reviews • ${activeRangeLabel}`

  const handleRangeChange = (mode: ReviewBoardRange) => {
    setDateFilter(current => {
      if (mode === 'custom') {
        return { ...current, mode }
      }

      const next = createDefaultReviewDateRange()
      return { ...next, mode }
    })
  }

  const handleCustomDateChange = (field: 'startDate' | 'endDate', value: string) => {
    setDateFilter(current => ({
      ...current,
      mode: 'custom',
      [field]: value,
    }))
  }

  const handleGoogleSync = async () => {
    setSyncing(true)
    setError(null)
    setSyncMessage(null)

    try {
      const res = await fetch('/api/reviews/sync', { method: 'POST' })
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string
        reviews_found?: number
        synced?: number
        new_reviews?: number
        analyzed?: number
        analysis_errors?: string[]
        analysis_error_samples?: string[]
        api_used?: string
      }
      if (!res.ok) {
        throw new Error(payload.error ?? 'Failed to sync Google reviews')
      }

      const parts = [
        payload.api_used === 'business_profile' ? 'Business Profile API' : 'Places API (limited to 5)',
        `${payload.reviews_found ?? 0} reviews fetched`,
        `${payload.synced ?? 0} synced`,
        `${payload.new_reviews ?? 0} new`,
        `${payload.analyzed ?? 0} analyzed`,
      ]
      if ((payload.analysis_errors?.length ?? 0) > 0) {
        parts.push(`${payload.analysis_errors!.length} analysis issue${payload.analysis_errors!.length === 1 ? '' : 's'}`)
      }
      if ((payload.analysis_error_samples?.length ?? 0) > 0) {
        parts.push(payload.analysis_error_samples!.join(' / '))
      }
      setSyncMessage(parts.join(' • '))
      await loadBoard()
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Failed to sync Google reviews')
    } finally {
      setSyncing(false)
    }
  }

  const handleMyReviewsPin = async (pin: string) => {
    const res = await fetch('/api/reviews/my-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    })

    const payload = (await res.json().catch(() => ({}))) as {
      error?: string
      employee?: { id: string; name: string }
    }

    if (!res.ok || !payload.employee) {
      setStaffPinError(payload.error ?? 'PIN not recognized')
      throw new Error(payload.error ?? 'PIN not recognized')
    }

    setStaffPinError(null)
    setShowMyReviewsPin(false)
    setActiveEmployeeFilter({
      employeeId: payload.employee.id,
      employeeName: payload.employee.name,
      source: 'my',
    })
  }

  const unlockManagerSession = async (pin: string) => {
    const res = await fetch('/api/admin-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    })

    const payload = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) {
      setManagerPinError(payload.error ?? 'Manager PIN required')
      throw new Error(payload.error ?? 'Manager PIN required')
    }

    setManagerPinError(null)
    setManagerUnlocked(true)
    setShowManagerPin(false)

    if (pendingAssignReview) {
      setAssignmentTarget(pendingAssignReview)
      setPendingAssignReview(null)
    }
  }

  const requestManagerEmployeeFilter = (employeeId: string) => {
    const employee = employees.find(item => item.id === employeeId)
    if (!employee) return

    if (activeEmployeeFilter?.employeeId === employeeId) {
      setActiveEmployeeFilter(null)
      return
    }

    setActiveEmployeeFilter({
      employeeId: employee.id,
      employeeName: employee.name,
      source: 'manager',
    })
  }

  const requestAssign = (review: GoogleReview) => {
    if (managerUnlocked) {
      setAssignmentTarget(review)
      return
    }

    setPendingAssignReview(review)
    setManagerPinError(null)
    setShowManagerPin(true)
  }

  const handleAssignSubmit = async (employeeIds: string[], note: string) => {
    if (!assignmentTarget) return
    setAssigning(true)

    try {
      const res = await fetch(`/api/reviews/${assignmentTarget.id}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_ids: employeeIds, note }),
      })

      const payload = (await res.json().catch(() => ({}))) as { error?: string; review?: GoogleReview }
      if (!res.ok || !payload.review) {
        throw new Error(payload.error ?? 'Failed to assign review')
      }

      setReviews(current => current.map(review => (
        review.id === payload.review!.id ? payload.review! : review
      )))
      setAssignmentTarget(null)
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : 'Failed to assign review')
    } finally {
      setAssigning(false)
    }
  }

  return (
    <>
      <div className="min-h-full bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.18),_transparent_28%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-4 py-4 md:px-6 md:py-6">
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">FOH Review</div>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Review</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Google reviews, reward points, staff attribution, and content summaries in one tablet-friendly board.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeEmployeeFilter ? (
              <Button
                variant="outline"
                className="h-11 min-w-32 text-sm font-semibold"
                onClick={() => setActiveEmployeeFilter(null)}
              >
                Back To Board
              </Button>
            ) : (
              <Button
                className="h-11 min-w-32 text-sm font-semibold"
                onClick={() => {
                  setStaffPinError(null)
                  setShowMyReviewsPin(true)
                }}
              >
                <UserRound className="h-4 w-4" />
                My Reviews
              </Button>
            )}

            <Button
              variant="outline"
              className="h-11 min-w-32 text-sm font-semibold"
              onClick={handleGoogleSync}
              disabled={syncing}
            >
              {syncing ? 'Syncing...' : 'Sync Google Reviews'}
            </Button>

            <Button
              variant="outline"
              className="h-11 min-w-32 text-sm font-semibold"
              onClick={() => {
                setManagerPinError(null)
                setPendingAssignReview(null)
                setShowManagerPin(true)
              }}
            >
              <ShieldCheck className="h-4 w-4" />
              {managerUnlocked ? 'Manager Unlocked' : 'Manager PIN'}
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {syncMessage && (
          <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {syncMessage}
          </div>
        )}

        {setupRequired && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Run `supabase db reset` or apply migration `019_add_review_board.sql` locally before testing Review Board data.
          </div>
        )}

        {loading ? (
          <div className="rounded-[28px] border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
            Loading Review...
          </div>
        ) : (
          <div className="space-y-5">
            <div className="min-h-[34rem] lg:h-[calc(100vh-14rem)] lg:min-h-0">
              <ReviewBoardSummary
                dateFilter={dateFilter}
                onRangeChange={handleRangeChange}
                onCustomDateChange={handleCustomDateChange}
                categorySummary={summary.categorySummary}
                recentReviews={visibleReviews}
                reviewLeaderboard={accumulatedSummary.reviewLeaderboard}
                rewards={rewards}
                selectedEmployeeId={activeEmployeeFilter?.source === 'manager' ? activeEmployeeFilter.employeeId : null}
                onSelectEmployee={requestManagerEmployeeFilter}
                collapsedSections={collapsedSections}
                onToggleSection={section =>
                  setCollapsedSections(current => ({ ...current, [section]: !current[section] }))
                }
              />
            </div>

            <div className="min-h-0">
              <div className="mb-4 rounded-[28px] border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Review Feed</div>
                    <div className="mt-1 text-lg font-bold text-slate-950">{activeFilterLabel}</div>
                  </div>
                  <div className="text-sm text-slate-500">
                    {visibleReviews.length} review{visibleReviews.length === 1 ? '' : 's'} shown
                  </div>
                </div>
                <div className="mt-3">
                  <Input
                    value={reviewSearch}
                    onChange={event => setReviewSearch(event.target.value)}
                    placeholder="Filter by name, review text, AI category, or memo"
                    className="h-11"
                  />
                </div>
              </div>

              <ReviewFeed
                reviews={visibleReviews}
                onAssign={requestAssign}
                onSelectEmployee={requestManagerEmployeeFilter}
                filterLabel={activeFilterLabel}
              />
            </div>
          </div>
        )}
      </div>

      <PinModal
        open={showMyReviewsPin}
        title="My Reviews"
        description="Enter your staff PIN to view only your attributed reviews."
        onConfirm={handleMyReviewsPin}
        onClose={() => {
          setShowMyReviewsPin(false)
          setStaffPinError(null)
        }}
        error={staffPinError}
      />

      <PinModal
        open={showManagerPin}
        title="Manager PIN"
        description="Manager PIN unlocks manual review assignment for this session."
        onConfirm={unlockManagerSession}
        onClose={() => {
          setShowManagerPin(false)
          setManagerPinError(null)
          setPendingAssignReview(null)
        }}
        error={managerPinError}
      />

      {assignmentTarget && (
        <AssignReviewDialog
          open
          review={assignmentTarget}
          employees={employees}
          submitting={assigning}
          onClose={() => setAssignmentTarget(null)}
          onSubmit={handleAssignSubmit}
        />
      )}
    </>
  )
}
