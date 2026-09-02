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
  ReviewLeaderboardEntry,
} from '@/lib/reviewScoring'
import { Employee, GoogleReview, RewardCatalogItem, RewardRedemption, TaskCompletion } from '@/lib/types'
import { ShieldCheck, UserRound, X } from 'lucide-react'

interface ReviewBoardResponse {
  employees: Employee[]
  reviews: GoogleReview[]
  taskPoints: Record<string, number>
  taskCompletions: TaskCompletion[]
  redemptions: RewardRedemption[]
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
  source: 'my'
}

function getReviewEmployeeIds(review: GoogleReview) {
  const ids = (review.matched_employee_ids ?? []).length > 0
    ? review.matched_employee_ids ?? []
    : review.matched_employee_id
      ? [review.matched_employee_id]
      : []
  return Array.from(new Set(ids.filter(Boolean)))
}

function sortByLatestDate<T>(items: T[], getDate: (item: T) => string | null | undefined) {
  return [...items].sort((left, right) => (getDate(right) ?? '').localeCompare(getDate(left) ?? ''))
}

function formatSignedPoints(points: number) {
  return `${points > 0 ? '+' : ''}${points} pts`
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
  const [taskPoints, setTaskPoints] = useState<Record<string, number>>({})
  const [taskCompletions, setTaskCompletions] = useState<TaskCompletion[]>([])
  const [redemptions, setRedemptions] = useState<RewardRedemption[]>([])
  const [managerUnlocked, setManagerUnlocked] = useState(false)
  const [setupRequired, setSetupRequired] = useState(false)
  const [showMyReviewsPin, setShowMyReviewsPin] = useState(false)
  const [showManagerPin, setShowManagerPin] = useState(false)
  const [activeEmployeeFilter, setActiveEmployeeFilter] = useState<ActiveEmployeeFilter | null>(null)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
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
      setTaskPoints(payload.taskPoints ?? {})
      setTaskCompletions(payload.taskCompletions ?? [])
      setRedemptions(payload.redemptions ?? [])
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
    taskPoints: new Map(Object.entries(taskPoints)),
  })
  const accumulatedSummary = buildReviewBoardSummary({
    reviews,
    employees,
    taskPoints: new Map(Object.entries(taskPoints)),
  })
  const selectedEmployee = selectedEmployeeId
    ? employees.find(employee => employee.id === selectedEmployeeId) ?? null
    : null
  const selectedLeaderboardEntry: ReviewLeaderboardEntry | null = selectedEmployeeId
    ? accumulatedSummary.reviewLeaderboard.find(item => item.employeeId === selectedEmployeeId) ?? null
    : null
  const selectedTaskCompletions = selectedEmployeeId
    ? sortByLatestDate(
      taskCompletions.filter(completion => completion.employee_id === selectedEmployeeId && completion.status !== 'incomplete'),
      completion => completion.completed_at || completion.session_date
    ).slice(0, 12)
    : []
  const selectedReviews = selectedEmployeeId
    ? sortByLatestDate(
      reviews.filter(review => getReviewEmployeeIds(review).includes(selectedEmployeeId)),
      review => review.review_date
    ).slice(0, 12)
    : []
  const selectedRedemptions = selectedEmployeeId
    ? sortByLatestDate(
      redemptions.filter(redemption => redemption.employee_id === selectedEmployeeId),
      redemption => redemption.redeemed_at || redemption.created_at
    ).slice(0, 12)
    : []
  const selectedTaskPoints = selectedLeaderboardEntry?.taskPoints ?? (selectedEmployeeId ? taskPoints[selectedEmployeeId] ?? 0 : 0)
  const selectedReviewPoints = selectedLeaderboardEntry?.reviewPoints ?? selectedReviews.reduce((sum, review) => sum + Math.round(Number(review.points ?? 0)), 0)
  const selectedEarnedPoints = selectedTaskPoints + selectedReviewPoints
  const selectedRedemptionTotal = selectedRedemptions.reduce((sum, redemption) => sum + Math.round(Number(redemption.points_delta ?? 0)), 0)
  const selectedSpentPoints = Math.abs(selectedRedemptions.reduce((sum, redemption) => {
    const points = Math.round(Number(redemption.points_delta ?? 0))
    return points < 0 ? sum + points : sum
  }, 0))
  const selectedBalancePoints = selectedEarnedPoints + selectedRedemptionTotal

  const activeFilterLabel = activeEmployeeFilter
    ? `My Reviews • ${activeEmployeeFilter.employeeName}`
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

  const openEmployeeActionPanel = (employeeId: string) => {
    const employee = employees.find(item => item.id === employeeId)
    if (!employee) return

    setSelectedEmployeeId(current => current === employee.id ? null : employee.id)
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
                selectedEmployeeId={selectedEmployeeId}
                onSelectEmployee={openEmployeeActionPanel}
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
                onSelectEmployee={openEmployeeActionPanel}
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

      {selectedEmployee && (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-4 py-4">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">Point Details</div>
              <div className="mt-1 truncate text-xl font-black text-slate-950">{selectedEmployee.name}</div>
              <div className="mt-1 text-xs text-slate-500">Task points, review points, and reward spending</div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedEmployeeId(null)}
              className="rounded-full border border-slate-200 p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
              aria-label="Close point details"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid shrink-0 grid-cols-3 gap-2 border-b border-slate-100 px-4 py-3">
            <div className="rounded-lg bg-emerald-50 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Earned</div>
              <div className="mt-1 text-lg font-black text-emerald-700">{selectedEarnedPoints}</div>
            </div>
            <div className="rounded-lg bg-rose-50 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-rose-700">Spent</div>
              <div className="mt-1 text-lg font-black text-rose-700">{selectedSpentPoints}</div>
            </div>
            <div className="rounded-lg bg-slate-100 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">Balance</div>
              <div className="mt-1 text-lg font-black text-slate-950">{selectedBalancePoints}</div>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-black text-slate-950">Earned Points</h2>
                <span className="text-xs font-semibold text-slate-500">Task {selectedTaskPoints} + Review {selectedReviewPoints}</span>
              </div>
              <div className="space-y-1.5">
                {selectedTaskCompletions.slice(0, 6).map(completion => (
                  <div key={completion.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-900">{completion.task?.title ?? 'Completed task'}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{completion.session_date}</div>
                      </div>
                      <span className="shrink-0 font-bold text-emerald-700">{formatSignedPoints(Math.round(Number(completion.points_awarded ?? completion.task?.points ?? 0)))}</span>
                    </div>
                  </div>
                ))}
                {selectedReviews.slice(0, 6).map(review => (
                  <div key={review.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-900">{review.author_name}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{review.review_date} · {review.rating} star{review.rating === 1 ? '' : 's'}</div>
                        <p className="mt-1 line-clamp-2 text-xs text-slate-600">{review.review_text}</p>
                      </div>
                      <span className="shrink-0 font-bold text-emerald-700">{formatSignedPoints(Math.round(Number(review.points ?? 0)))}</span>
                    </div>
                  </div>
                ))}
                {selectedTaskCompletions.length === 0 && selectedReviews.length === 0 && (
                  <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">No earned point detail yet.</div>
                )}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-black text-slate-950">Spent Points</h2>
                <span className="text-xs font-semibold text-slate-500">{selectedRedemptions.length} item{selectedRedemptions.length === 1 ? '' : 's'}</span>
              </div>
              <div className="space-y-1.5">
                {selectedRedemptions.map(redemption => (
                  <div key={redemption.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-900">{redemption.reward?.name ?? 'Manual point adjustment'}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{redemption.redeemed_at}</div>
                        {redemption.memo && <p className="mt-1 line-clamp-2 text-xs text-slate-600">{redemption.memo}</p>}
                      </div>
                      <span className="shrink-0 font-bold text-rose-700">{formatSignedPoints(Math.round(Number(redemption.points_delta ?? 0)))}</span>
                    </div>
                  </div>
                ))}
                {selectedRedemptions.length === 0 && (
                  <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">No reward spending yet.</div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  )
}
