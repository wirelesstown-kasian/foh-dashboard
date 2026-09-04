'use client'

import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { ReportingToolbar } from '@/components/reporting/ReportingToolbar'
import { notifyReportingDataChanged, useEmployees, useTaskCompletions, useTasks } from '@/components/reporting/useReportingData'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { ReportPeriod, getReportRange } from '@/lib/reporting'
import { buildEmployeeRewardPointRows, getCompletionPoints, getReviewEmployeeIds } from '@/lib/rewards'
import { Employee, GoogleReview, RewardRedemption, TaskCompletion } from '@/lib/types'

type PointDirection = 'add' | 'deduct'

function getEmployeeCode(employee: Employee, employeeCodes: Record<string, string | null>) {
  return employeeCodes[employee.id]?.trim() || employee.pin_code?.trim() || employee.id.slice(0, 6).toUpperCase()
}

function toPointInput(value: number | null | undefined) {
  return String(Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0)
}

export default function RewardsReportingPage() {
  const employees = useEmployees({ includeArchived: true })
  const { completions, setCompletions } = useTaskCompletions()
  const tasks = useTasks()

  const [period, setPeriod] = useState<ReportPeriod>('monthly')
  const [refDate, setRefDate] = useState(new Date())
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [reviews, setReviews] = useState<GoogleReview[]>([])
  const [redemptions, setRedemptions] = useState<RewardRedemption[]>([])
  const [employeeCodes, setEmployeeCodes] = useState<Record<string, string | null>>({})
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('all')
  const [actionEmployeeId, setActionEmployeeId] = useState<string | null>(null)
  const [pointAdjustmentForm, setPointAdjustmentForm] = useState({
    direction: 'add' as PointDirection,
    points: '',
    memo: '',
    redeemed_at: format(new Date(), 'yyyy-MM-dd'),
  })
  const [taskPointEdits, setTaskPointEdits] = useState<Record<string, string>>({})
  const [reviewPointEdits, setReviewPointEdits] = useState<Record<string, string>>({})
  const [fullReview, setFullReview] = useState<GoogleReview | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [savingAdjustment, setSavingAdjustment] = useState(false)
  const [savingTaskPointId, setSavingTaskPointId] = useState<string | null>(null)
  const [savingReviewPointId, setSavingReviewPointId] = useState<string | null>(null)
  const [setupRequired, setSetupRequired] = useState(false)

  const [startDate, endDate] = useMemo(
    () => getReportRange(period, refDate, customStart, customEnd),
    [period, refDate, customStart, customEnd]
  )
  const activeEmployees = useMemo(
    () => employees.filter(employee => employee.is_active),
    [employees]
  )

  const loadRewards = async () => {
    const [reviewRes, rewardRes, employeeRes] = await Promise.all([
      fetch('/api/reviews', { cache: 'no-store' }),
      fetch('/api/rewards', { cache: 'no-store' }),
      fetch('/api/employees', { cache: 'no-store' }),
    ])
    const reviewPayload = (await reviewRes.json().catch(() => ({}))) as { reviews?: GoogleReview[] }
    const rewardPayload = (await rewardRes.json().catch(() => ({}))) as {
      redemptions?: RewardRedemption[]
      setup_required?: boolean
      error?: string
    }
    const employeePayload = (await employeeRes.json().catch(() => ({}))) as { employees?: Employee[] }

    setReviews(reviewPayload.reviews ?? [])
    setRedemptions(rewardPayload.redemptions ?? [])
    setSetupRequired(rewardPayload.setup_required === true)
    setEmployeeCodes(Object.fromEntries((employeePayload.employees ?? []).map(employee => [employee.id, employee.pin_code ?? null])))
    if (!rewardRes.ok) setMessage(rewardPayload.error ?? 'Failed to load rewards')
  }

  useEffect(() => {
    let mounted = true
    void (async () => {
      const [reviewRes, rewardRes, employeeRes] = await Promise.all([
        fetch('/api/reviews', { cache: 'no-store' }),
        fetch('/api/rewards', { cache: 'no-store' }),
        fetch('/api/employees', { cache: 'no-store' }),
      ])
      const reviewPayload = (await reviewRes.json().catch(() => ({}))) as { reviews?: GoogleReview[] }
      const rewardPayload = (await rewardRes.json().catch(() => ({}))) as {
        redemptions?: RewardRedemption[]
        setup_required?: boolean
        error?: string
      }
      const employeePayload = (await employeeRes.json().catch(() => ({}))) as { employees?: Employee[] }
      if (!mounted) return
      setReviews(reviewPayload.reviews ?? [])
      setRedemptions(rewardPayload.redemptions ?? [])
      setSetupRequired(rewardPayload.setup_required === true)
      setEmployeeCodes(Object.fromEntries((employeePayload.employees ?? []).map(employee => [employee.id, employee.pin_code ?? null])))
      if (!rewardRes.ok) setMessage(rewardPayload.error ?? 'Failed to load rewards')
    })()
    return () => {
      mounted = false
    }
  }, [])

  const filteredCompletions = useMemo(
    () => completions.filter(completion => completion.session_date >= startDate && completion.session_date <= endDate),
    [completions, endDate, startDate]
  )
  const filteredReviews = useMemo(
    () => reviews.filter(review => review.review_date >= startDate && review.review_date <= endDate),
    [endDate, reviews, startDate]
  )
  const filteredRedemptions = useMemo(
    () => redemptions.filter(redemption => redemption.redeemed_at >= startDate && redemption.redeemed_at <= endDate),
    [endDate, redemptions, startDate]
  )
  const periodRows = useMemo(
    () => buildEmployeeRewardPointRows({
      employees: activeEmployees,
      tasks,
      completions: filteredCompletions,
      reviews: filteredReviews,
      redemptions: filteredRedemptions,
    }),
    [activeEmployees, filteredCompletions, filteredRedemptions, filteredReviews, tasks]
  )
  const allTimeRows = useMemo(
    () => buildEmployeeRewardPointRows({
      employees: activeEmployees,
      tasks,
      completions,
      reviews,
      redemptions,
    }),
    [activeEmployees, completions, redemptions, reviews, tasks]
  )
  const allTimeRowByEmployeeId = useMemo(
    () => new Map(allTimeRows.map(row => [row.employee.id, row])),
    [allTimeRows]
  )
  const visibleRows = selectedEmployeeId === 'all'
    ? periodRows
    : periodRows.filter(row => row.employee.id === selectedEmployeeId)
  const taskById = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks])
  const employeeById = useMemo(() => new Map(activeEmployees.map(employee => [employee.id, employee])), [activeEmployees])
  const selectedEmployee = selectedEmployeeId === 'all' ? null : employeeById.get(selectedEmployeeId) ?? null
  const actionEmployee = actionEmployeeId ? employeeById.get(actionEmployeeId) ?? null : null
  const actionPeriodRow = actionEmployeeId ? periodRows.find(row => row.employee.id === actionEmployeeId) ?? null : null
  const actionAllTimeRow = actionEmployeeId ? allTimeRowByEmployeeId.get(actionEmployeeId) ?? null : null

  const actionTaskDetails = actionEmployee
    ? completions
        .filter(completion => completion.employee_id === actionEmployee.id && completion.status !== 'incomplete')
        .map(completion => ({ completion, task: taskById.get(completion.task_id), points: getCompletionPoints(completion, taskById.get(completion.task_id)) }))
        .sort((left, right) => right.completion.session_date.localeCompare(left.completion.session_date))
    : []
  const actionReviewDetails = actionEmployee
    ? reviews
        .filter(review => getReviewEmployeeIds(review).includes(actionEmployee.id))
        .sort((left, right) => right.review_date.localeCompare(left.review_date))
    : []
  const actionAdjustmentDetails = actionEmployee
    ? redemptions
        .filter(redemption => redemption.employee_id === actionEmployee.id)
        .sort((left, right) => right.redeemed_at.localeCompare(left.redeemed_at))
    : []

  const openActionPanel = (employeeId: string) => {
    setActionEmployeeId(employeeId)
    setPointAdjustmentForm({
      direction: 'add',
      points: '',
      memo: '',
      redeemed_at: format(new Date(), 'yyyy-MM-dd'),
    })
  }

  const savePointAdjustment = async () => {
    if (!actionEmployee) return
    setSavingAdjustment(true)
    setMessage(null)
    const points = Math.abs(Math.round(Number(pointAdjustmentForm.points) || 0))
    const res = await fetch('/api/rewards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'redemption',
        employee_id: actionEmployee.id,
        reward_id: null,
        points_delta: pointAdjustmentForm.direction === 'add' ? points : -points,
        memo: pointAdjustmentForm.memo,
        redeemed_at: pointAdjustmentForm.redeemed_at,
      }),
    })
    const payload = (await res.json().catch(() => ({}))) as { error?: string }
    setSavingAdjustment(false)
    if (!res.ok) {
      setMessage(payload.error ?? 'Failed to save point adjustment')
      return
    }
    setPointAdjustmentForm({
      direction: 'add',
      points: '',
      memo: '',
      redeemed_at: format(new Date(), 'yyyy-MM-dd'),
    })
    setMessage('Point adjustment saved.')
    notifyReportingDataChanged()
    await loadRewards()
  }

  const saveTaskPoints = async (completion: TaskCompletion, fallbackPoints: number) => {
    const nextPoints = Math.max(0, Math.round(Number(taskPointEdits[completion.id] ?? fallbackPoints) || 0))
    setSavingTaskPointId(completion.id)
    setMessage(null)
    const res = await fetch('/api/rewards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'task_points', completion_id: completion.id, points_awarded: nextPoints }),
    })
    const payload = (await res.json().catch(() => ({}))) as { error?: string; completion?: TaskCompletion }
    setSavingTaskPointId(null)
    if (!res.ok || !payload.completion) {
      setMessage(payload.error ?? 'Failed to update task points')
      return
    }
    setCompletions(current => current.map(item => item.id === completion.id ? { ...item, points_awarded: payload.completion?.points_awarded ?? nextPoints } : item))
    setTaskPointEdits(current => {
      const next = { ...current }
      delete next[completion.id]
      return next
    })
    setMessage('Task points updated.')
    notifyReportingDataChanged()
  }

  const saveReviewPoints = async (review: GoogleReview) => {
    const nextPoints = Math.max(0, Math.round(Number(reviewPointEdits[review.id] ?? review.points) || 0))
    setSavingReviewPointId(review.id)
    setMessage(null)
    const res = await fetch('/api/rewards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'review_points', review_id: review.id, points: nextPoints }),
    })
    const payload = (await res.json().catch(() => ({}))) as { error?: string; review?: GoogleReview }
    setSavingReviewPointId(null)
    if (!res.ok) {
      setMessage(payload.error ?? 'Failed to update review points')
      return
    }
    setReviews(current => current.map(item => item.id === review.id ? { ...item, points: payload.review?.points ?? nextPoints } : item))
    setReviewPointEdits(current => {
      const next = { ...current }
      delete next[review.id]
      return next
    })
    setMessage('Review points updated.')
    notifyReportingDataChanged()
  }

  const visibleAllTimeBalance = visibleRows.reduce((sum, row) => sum + (allTimeRowByEmployeeId.get(row.employee.id)?.totalPoints ?? 0), 0)
  const periodTaskPoints = visibleRows.reduce((sum, row) => sum + row.taskPoints, 0)
  const periodReviewPoints = visibleRows.reduce((sum, row) => sum + row.reviewPoints, 0)
  const periodAdjustments = visibleRows.reduce((sum, row) => sum + row.redeemedPoints, 0)

  return (
    <div className="p-6">
      <AdminSubpageHeader
        title="Rewards Reporting"
        subtitle="Track task points, review points, and point adjustments by employee."
        backHref="/admin"
        backLabel="Back to Admin Board"
      />

      {setupRequired && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Run [034_add_rewards_points.sql](/Users/jamesshin/foh-dashboard/supabase/migrations/034_add_rewards_points.sql) in Supabase SQL Editor to save point adjustments.
        </div>
      )}
      {message && <div className="mb-4 rounded-xl border bg-white px-4 py-3 text-sm text-slate-700">{message}</div>}

      <div className="rounded-xl border bg-white p-5">
        <ReportingToolbar
          period={period}
          refDate={refDate}
          customStart={customStart}
          customEnd={customEnd}
          onPeriodChange={setPeriod}
          onRefDateChange={setRefDate}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
          leftSlot={
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label>Code</Label>
                <Select value={selectedEmployeeId} onValueChange={(value: string | null) => value && setSelectedEmployeeId(value)}>
                  <SelectTrigger className="w-60">
                    <SelectValue>
                      {selectedEmployee ? getEmployeeCode(selectedEmployee, employeeCodes) : 'All Codes'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Codes</SelectItem>
                    {activeEmployees.map(employee => (
                      <SelectItem key={employee.id} value={employee.id}>
                        {getEmployeeCode(employee, employeeCodes)} - {employee.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedEmployeeId !== 'all' && (
                <Button variant="outline" onClick={() => setSelectedEmployeeId('all')}>
                  All Codes
                </Button>
              )}
            </div>
          }
        />

        <div className="mb-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border bg-amber-50 p-4">
            <div className="text-xs font-semibold uppercase text-amber-700">All-Time Balance</div>
            <div className="mt-2 text-2xl font-bold text-amber-950">{visibleAllTimeBalance}</div>
          </div>
          <div className="rounded-xl border bg-sky-50 p-4">
            <div className="text-xs font-semibold uppercase text-sky-700">Task Points</div>
            <div className="mt-2 text-2xl font-bold text-sky-950">{periodTaskPoints}</div>
          </div>
          <div className="rounded-xl border bg-emerald-50 p-4">
            <div className="text-xs font-semibold uppercase text-emerald-700">Review Points</div>
            <div className="mt-2 text-2xl font-bold text-emerald-950">{periodReviewPoints}</div>
          </div>
          <div className="rounded-xl border bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase text-slate-600">Adjustments</div>
            <div className="mt-2 text-2xl font-bold text-slate-950">{periodAdjustments}</div>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Display Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead className="text-right">Task Pts</TableHead>
              <TableHead className="text-right">Review Pts</TableHead>
              <TableHead className="text-right">Adjustments</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map(row => {
              const allTimeRow = allTimeRowByEmployeeId.get(row.employee.id)
              return (
                <TableRow key={row.employee.id}>
                  <TableCell>
                    <button className="font-medium hover:underline" onClick={() => openActionPanel(row.employee.id)}>
                      {row.employee.name}
                    </button>
                    <div className="text-xs text-muted-foreground">{row.completedTasks} tasks | {row.reviews} reviews</div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{getEmployeeCode(row.employee, employeeCodes)}</TableCell>
                  <TableCell className="text-right">{row.taskPoints}</TableCell>
                  <TableCell className="text-right">{row.reviewPoints}</TableCell>
                  <TableCell className="text-right">{row.redeemedPoints}</TableCell>
                  <TableCell className="text-right text-lg font-bold text-amber-700">{allTimeRow?.totalPoints ?? 0}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <Sheet open={!!actionEmployee} onOpenChange={open => !open && setActionEmployeeId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {actionEmployee && (
            <>
              <SheetHeader className="border-b">
                <SheetTitle>{actionEmployee.name}</SheetTitle>
                <SheetDescription>
                  Code {getEmployeeCode(actionEmployee, employeeCodes)}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-5 px-4 pb-4">
                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border bg-amber-50 p-3">
                    <div className="text-xs font-semibold uppercase text-amber-700">Balance</div>
                    <div className="mt-1 text-xl font-bold text-amber-950">{actionAllTimeRow?.totalPoints ?? 0}</div>
                  </div>
                  <div className="rounded-lg border bg-sky-50 p-3">
                    <div className="text-xs font-semibold uppercase text-sky-700">Task</div>
                    <div className="mt-1 text-xl font-bold text-sky-950">{actionPeriodRow?.taskPoints ?? 0}</div>
                  </div>
                  <div className="rounded-lg border bg-emerald-50 p-3">
                    <div className="text-xs font-semibold uppercase text-emerald-700">Review</div>
                    <div className="mt-1 text-xl font-bold text-emerald-950">{actionPeriodRow?.reviewPoints ?? 0}</div>
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <div className="text-xs font-semibold uppercase text-slate-600">Adjust</div>
                    <div className="mt-1 text-xl font-bold text-slate-950">{actionPeriodRow?.redeemedPoints ?? 0}</div>
                  </div>
                </div>

                <section className="rounded-lg border p-4">
                  <h2 className="text-base font-semibold">Point Adjustment</h2>
                  <div className="mt-4 grid gap-3 sm:grid-cols-[140px_1fr_150px]">
                    <div>
                      <Label>Action</Label>
                      <div className="mt-1 grid grid-cols-2 overflow-hidden rounded-md border">
                        <button
                          className={`px-3 py-2 text-sm ${pointAdjustmentForm.direction === 'add' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-700'}`}
                          onClick={() => setPointAdjustmentForm(form => ({ ...form, direction: 'add' }))}
                        >
                          Add
                        </button>
                        <button
                          className={`px-3 py-2 text-sm ${pointAdjustmentForm.direction === 'deduct' ? 'bg-rose-600 text-white' : 'bg-white text-slate-700'}`}
                          onClick={() => setPointAdjustmentForm(form => ({ ...form, direction: 'deduct' }))}
                        >
                          Deduct
                        </button>
                      </div>
                    </div>
                    <div>
                      <Label>Points</Label>
                      <Input type="number" min="1" value={pointAdjustmentForm.points} onChange={event => setPointAdjustmentForm(form => ({ ...form, points: event.target.value }))} />
                    </div>
                    <div>
                      <Label>Date</Label>
                      <Input type="date" value={pointAdjustmentForm.redeemed_at} onChange={event => setPointAdjustmentForm(form => ({ ...form, redeemed_at: event.target.value }))} />
                    </div>
                  </div>
                  <div className="mt-3">
                    <Label>Memo *</Label>
                    <Input value={pointAdjustmentForm.memo} onChange={event => setPointAdjustmentForm(form => ({ ...form, memo: event.target.value }))} />
                  </div>
                  <Button className="mt-4 w-full" onClick={savePointAdjustment} disabled={savingAdjustment || !pointAdjustmentForm.memo.trim() || !(Number(pointAdjustmentForm.points) > 0)}>
                    Save Point Adjustment
                  </Button>
                </section>

                <section className="rounded-lg border p-4">
                  <h2 className="text-base font-semibold">Tasks</h2>
                  <div className="mt-3 space-y-2">
                    {actionTaskDetails.map(({ completion, task, points }) => (
                      <div key={completion.id} className="grid gap-2 rounded-lg border px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_110px_90px] sm:items-end">
                        <div>
                          <div className="font-medium">{task?.title ?? 'Task'}</div>
                          <div className="text-xs text-muted-foreground">{completion.session_date}</div>
                        </div>
                        <div>
                          <Label>Points</Label>
                          <Input
                            type="number"
                            min="0"
                            value={taskPointEdits[completion.id] ?? toPointInput(points)}
                            onChange={event => setTaskPointEdits(current => ({ ...current, [completion.id]: event.target.value }))}
                          />
                        </div>
                        <Button variant="outline" onClick={() => saveTaskPoints(completion, points)} disabled={savingTaskPointId === completion.id}>
                          Save
                        </Button>
                      </div>
                    ))}
                    {actionTaskDetails.length === 0 && <p className="text-sm text-muted-foreground">No task points.</p>}
                  </div>
                </section>

                <section className="rounded-lg border p-4">
                  <h2 className="text-base font-semibold">Reviews</h2>
                  <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
                    {actionReviewDetails.map(review => (
                      <div key={review.id} className="rounded-lg border px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="font-medium">{review.author_name}</div>
                            <div className="text-xs text-muted-foreground">{review.review_date} | {review.rating} stars</div>
                          </div>
                          <Button variant="outline" size="sm" onClick={() => setFullReview(review)}>
                            View
                          </Button>
                        </div>
                        <p className="mt-2 line-clamp-2 text-muted-foreground">{review.review_text || 'No review text.'}</p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-[110px_90px] sm:items-end">
                          <div>
                            <Label>Points</Label>
                            <Input
                              type="number"
                              min="0"
                              value={reviewPointEdits[review.id] ?? toPointInput(review.points)}
                              onChange={event => setReviewPointEdits(current => ({ ...current, [review.id]: event.target.value }))}
                            />
                          </div>
                          <Button variant="outline" onClick={() => saveReviewPoints(review)} disabled={savingReviewPointId === review.id}>
                            Save
                          </Button>
                        </div>
                      </div>
                    ))}
                    {actionReviewDetails.length === 0 && <p className="text-sm text-muted-foreground">No review points.</p>}
                  </div>
                </section>

                <section className="rounded-lg border p-4">
                  <h2 className="text-base font-semibold">Adjustment History</h2>
                  <div className="mt-3 space-y-2">
                    {actionAdjustmentDetails.slice(0, 12).map(adjustment => (
                      <div key={adjustment.id} className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
                        <div>
                          <div className="font-medium">{adjustment.memo}</div>
                          <div className="text-xs text-muted-foreground">{adjustment.redeemed_at}</div>
                        </div>
                        <Badge variant="outline">{adjustment.points_delta} pts</Badge>
                      </div>
                    ))}
                    {actionAdjustmentDetails.length === 0 && <p className="text-sm text-muted-foreground">No point adjustments.</p>}
                  </div>
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={!!fullReview} onOpenChange={open => !open && setFullReview(null)}>
        <DialogContent className="sm:max-w-lg">
          {fullReview && (
            <>
              <DialogHeader>
                <DialogTitle>{fullReview.author_name}</DialogTitle>
                <DialogDescription>{fullReview.review_date} | {fullReview.rating} stars | {fullReview.points} pts</DialogDescription>
              </DialogHeader>
              <Textarea value={fullReview.review_text || 'No review text.'} readOnly className="min-h-52 resize-none" />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
