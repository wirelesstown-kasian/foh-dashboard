'use client'

import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { ReportingToolbar } from '@/components/reporting/ReportingToolbar'
import { notifyReportingDataChanged, useEmployees, useTaskCompletions, useTasks } from '@/components/reporting/useReportingData'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ReportPeriod, getReportRange } from '@/lib/reporting'
import { buildEmployeeRewardPointRows, getCompletionPoints, getReviewEmployeeIds } from '@/lib/rewards'
import { GoogleReview, RewardCatalogItem, RewardRedemption } from '@/lib/types'

export default function RewardsReportingPage() {
  const employees = useEmployees({ includeArchived: true })
  const { completions } = useTaskCompletions()
  const tasks = useTasks()

  const [period, setPeriod] = useState<ReportPeriod>('monthly')
  const [refDate, setRefDate] = useState(new Date())
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [reviews, setReviews] = useState<GoogleReview[]>([])
  const [rewards, setRewards] = useState<RewardCatalogItem[]>([])
  const [redemptions, setRedemptions] = useState<RewardRedemption[]>([])
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('all')
  const [rewardForm, setRewardForm] = useState({ name: '', points_cost: '', description: '' })
  const [redemptionForm, setRedemptionForm] = useState({ employee_id: '', reward_id: 'manual', points: '', memo: '', redeemed_at: format(new Date(), 'yyyy-MM-dd') })
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [setupRequired, setSetupRequired] = useState(false)

  const [startDate, endDate] = useMemo(
    () => getReportRange(period, refDate, customStart, customEnd),
    [period, refDate, customStart, customEnd]
  )

  useEffect(() => {
    let mounted = true
    void (async () => {
      const [reviewRes, rewardRes] = await Promise.all([
        fetch('/api/reviews', { cache: 'no-store' }),
        fetch('/api/rewards', { cache: 'no-store' }),
      ])
      const reviewPayload = (await reviewRes.json().catch(() => ({}))) as { reviews?: GoogleReview[] }
      const rewardPayload = (await rewardRes.json().catch(() => ({}))) as {
        rewards?: RewardCatalogItem[]
        redemptions?: RewardRedemption[]
        setup_required?: boolean
        error?: string
      }
      if (!mounted) return
      setReviews(reviewPayload.reviews ?? [])
      setRewards(rewardPayload.rewards ?? [])
      setRedemptions(rewardPayload.redemptions ?? [])
      setSetupRequired(rewardPayload.setup_required === true)
      if (!rewardRes.ok) setMessage(rewardPayload.error ?? 'Failed to load rewards')
    })()
    return () => {
      mounted = false
    }
  }, [])

  const loadRewards = async () => {
    const [reviewRes, rewardRes] = await Promise.all([
      fetch('/api/reviews', { cache: 'no-store' }),
      fetch('/api/rewards', { cache: 'no-store' }),
    ])
    const reviewPayload = (await reviewRes.json().catch(() => ({}))) as { reviews?: GoogleReview[] }
    const rewardPayload = (await rewardRes.json().catch(() => ({}))) as {
      rewards?: RewardCatalogItem[]
      redemptions?: RewardRedemption[]
      setup_required?: boolean
      error?: string
    }
    setReviews(reviewPayload.reviews ?? [])
    setRewards(rewardPayload.rewards ?? [])
    setRedemptions(rewardPayload.redemptions ?? [])
    setSetupRequired(rewardPayload.setup_required === true)
    if (!rewardRes.ok) setMessage(rewardPayload.error ?? 'Failed to load rewards')
  }

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
  const rewardRows = useMemo(
    () => buildEmployeeRewardPointRows({
      employees,
      tasks,
      completions: filteredCompletions,
      reviews: filteredReviews,
      redemptions: filteredRedemptions,
    }),
    [employees, filteredCompletions, filteredRedemptions, filteredReviews, tasks]
  )
  const visibleRows = selectedEmployeeId === 'all'
    ? rewardRows
    : rewardRows.filter(row => row.employee.id === selectedEmployeeId)
  const taskById = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks])
  const employeeById = useMemo(() => new Map(employees.map(employee => [employee.id, employee])), [employees])
  const selectedEmployee = selectedEmployeeId === 'all' ? null : employeeById.get(selectedEmployeeId) ?? null

  const selectedTaskDetails = selectedEmployee
    ? filteredCompletions
        .filter(completion => completion.employee_id === selectedEmployee.id && completion.status !== 'incomplete')
        .map(completion => ({ completion, task: taskById.get(completion.task_id), points: getCompletionPoints(completion, taskById.get(completion.task_id)) }))
        .sort((left, right) => right.completion.session_date.localeCompare(left.completion.session_date))
    : []
  const selectedReviewDetails = selectedEmployee
    ? filteredReviews
        .filter(review => getReviewEmployeeIds(review).includes(selectedEmployee.id))
        .sort((left, right) => right.review_date.localeCompare(left.review_date))
    : []
  const selectedRedemptionDetails = selectedEmployee
    ? filteredRedemptions
        .filter(redemption => redemption.employee_id === selectedEmployee.id)
        .sort((left, right) => right.redeemed_at.localeCompare(left.redeemed_at))
    : []

  const saveReward = async () => {
    setSaving(true)
    setMessage(null)
    const res = await fetch('/api/rewards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reward', ...rewardForm }),
    })
    const payload = (await res.json().catch(() => ({}))) as { error?: string }
    setSaving(false)
    if (!res.ok) {
      setMessage(payload.error ?? 'Failed to save reward')
      return
    }
    setRewardForm({ name: '', points_cost: '', description: '' })
    setMessage('Reward saved.')
    await loadRewards()
  }

  const saveRedemption = async () => {
    setSaving(true)
    setMessage(null)
    const reward = rewards.find(item => item.id === redemptionForm.reward_id)
    const points = redemptionForm.points
      ? Math.abs(Math.round(Number(redemptionForm.points) || 0))
      : reward?.points_cost ?? 0
    const res = await fetch('/api/rewards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'redemption',
        employee_id: redemptionForm.employee_id,
        reward_id: redemptionForm.reward_id === 'manual' ? null : redemptionForm.reward_id,
        points_delta: -Math.abs(points),
        memo: redemptionForm.memo || (reward ? `Redeemed ${reward.name}` : ''),
        redeemed_at: redemptionForm.redeemed_at,
      }),
    })
    const payload = (await res.json().catch(() => ({}))) as { error?: string }
    setSaving(false)
    if (!res.ok) {
      setMessage(payload.error ?? 'Failed to save redemption')
      return
    }
    setRedemptionForm({ employee_id: '', reward_id: 'manual', points: '', memo: '', redeemed_at: format(new Date(), 'yyyy-MM-dd') })
    setMessage('Redemption saved.')
    notifyReportingDataChanged()
    await loadRewards()
  }

  return (
    <div className="p-6">
      <AdminSubpageHeader
        title="Rewards Reporting"
        subtitle="Track task points, review points, and reward redemptions by employee."
        backHref="/admin"
        backLabel="Back to Admin Board"
      />

      {setupRequired && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Run [034_add_rewards_points.sql](/Users/jamesshin/foh-dashboard/supabase/migrations/034_add_rewards_points.sql) in Supabase SQL Editor to save reward lists and redemptions.
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
            <Select value={selectedEmployeeId} onValueChange={(value: string | null) => value && setSelectedEmployeeId(value)}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Employees</SelectItem>
                {employees.map(employee => <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>)}
              </SelectContent>
            </Select>
          }
        />

        <div className="mb-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border bg-amber-50 p-4">
            <div className="text-xs font-semibold uppercase text-amber-700">Total Points</div>
            <div className="mt-2 text-2xl font-bold text-amber-950">{visibleRows.reduce((sum, row) => sum + row.totalPoints, 0)}</div>
          </div>
          <div className="rounded-xl border bg-sky-50 p-4">
            <div className="text-xs font-semibold uppercase text-sky-700">Task Points</div>
            <div className="mt-2 text-2xl font-bold text-sky-950">{visibleRows.reduce((sum, row) => sum + row.taskPoints, 0)}</div>
          </div>
          <div className="rounded-xl border bg-emerald-50 p-4">
            <div className="text-xs font-semibold uppercase text-emerald-700">Review Points</div>
            <div className="mt-2 text-2xl font-bold text-emerald-950">{visibleRows.reduce((sum, row) => sum + row.reviewPoints, 0)}</div>
          </div>
          <div className="rounded-xl border bg-rose-50 p-4">
            <div className="text-xs font-semibold uppercase text-rose-700">Redeemed</div>
            <div className="mt-2 text-2xl font-bold text-rose-950">{visibleRows.reduce((sum, row) => sum + Math.abs(row.redeemedPoints), 0)}</div>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead className="text-right">Task Pts</TableHead>
              <TableHead className="text-right">Review Pts</TableHead>
              <TableHead className="text-right">Redeemed</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map(row => (
              <TableRow key={row.employee.id}>
                <TableCell>
                  <button className="font-medium hover:underline" onClick={() => setSelectedEmployeeId(row.employee.id)}>
                    {row.employee.name}
                  </button>
                  <div className="text-xs text-muted-foreground">{row.completedTasks} tasks • {row.reviews} reviews</div>
                </TableCell>
                <TableCell className="text-right">{row.taskPoints}</TableCell>
                <TableCell className="text-right">{row.reviewPoints}</TableCell>
                <TableCell className="text-right text-rose-700">{row.redeemedPoints}</TableCell>
                <TableCell className="text-right text-lg font-bold text-amber-700">{row.totalPoints}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="rounded-xl border bg-white p-5">
          <h2 className="text-lg font-semibold">Point Detail</h2>
          {!selectedEmployee ? (
            <p className="mt-3 text-sm text-muted-foreground">Select an employee to review task, review, and redemption detail.</p>
          ) : (
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <div>
                <h3 className="mb-2 text-sm font-semibold">Tasks</h3>
                <div className="space-y-2">
                  {selectedTaskDetails.map(({ completion, task, points }) => (
                    <div key={completion.id} className="rounded-lg border px-3 py-2 text-sm">
                      <div className="font-medium">{task?.title ?? 'Task'}</div>
                      <div className="text-xs text-muted-foreground">{completion.session_date}</div>
                      <Badge variant="outline" className="mt-1">{points} pts</Badge>
                    </div>
                  ))}
                  {selectedTaskDetails.length === 0 && <p className="text-sm text-muted-foreground">No task points.</p>}
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Reviews</h3>
                <div className="space-y-2">
                  {selectedReviewDetails.map(review => (
                    <div key={review.id} className="rounded-lg border px-3 py-2 text-sm">
                      <div className="font-medium">{review.author_name}</div>
                      <div className="text-xs text-muted-foreground">{review.review_date} • {review.rating} stars</div>
                      <Badge variant="outline" className="mt-1">{review.points} pts</Badge>
                    </div>
                  ))}
                  {selectedReviewDetails.length === 0 && <p className="text-sm text-muted-foreground">No review points.</p>}
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Redemptions</h3>
                <div className="space-y-2">
                  {selectedRedemptionDetails.map(redemption => (
                    <div key={redemption.id} className="rounded-lg border px-3 py-2 text-sm">
                      <div className="font-medium">{redemption.reward?.name ?? 'Manual adjustment'}</div>
                      <div className="text-xs text-muted-foreground">{redemption.redeemed_at} • {redemption.memo}</div>
                      <Badge variant="outline" className="mt-1 text-rose-700">{redemption.points_delta} pts</Badge>
                    </div>
                  ))}
                  {selectedRedemptionDetails.length === 0 && <p className="text-sm text-muted-foreground">No redemptions.</p>}
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <section className="rounded-xl border bg-white p-5">
            <h2 className="text-lg font-semibold">Redeem or Deduct Points</h2>
            <div className="mt-4 space-y-3">
              <div>
                <Label>Employee</Label>
                <Select value={redemptionForm.employee_id} onValueChange={(value: string | null) => value && setRedemptionForm(form => ({ ...form, employee_id: value }))}>
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {employees.map(employee => <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Reward</Label>
                <Select value={redemptionForm.reward_id} onValueChange={(value: string | null) => value && setRedemptionForm(form => ({ ...form, reward_id: value, points: value === 'manual' ? form.points : String(rewards.find(item => item.id === value)?.points_cost ?? '') }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual deduction</SelectItem>
                    {rewards.map(reward => <SelectItem key={reward.id} value={reward.id}>{reward.name} • {reward.points_cost} pts</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Points</Label>
                  <Input type="number" min="1" value={redemptionForm.points} onChange={event => setRedemptionForm(form => ({ ...form, points: event.target.value }))} />
                </div>
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={redemptionForm.redeemed_at} onChange={event => setRedemptionForm(form => ({ ...form, redeemed_at: event.target.value }))} />
                </div>
              </div>
              <div>
                <Label>Memo *</Label>
                <Input value={redemptionForm.memo} onChange={event => setRedemptionForm(form => ({ ...form, memo: event.target.value }))} placeholder="Reason or reward detail" />
              </div>
              <Button className="w-full" onClick={saveRedemption} disabled={saving || !redemptionForm.employee_id || !redemptionForm.memo.trim()}>
                Save Redemption
              </Button>
            </div>
          </section>

          <section className="rounded-xl border bg-white p-5">
            <h2 className="text-lg font-semibold">Rewards List</h2>
            <div className="mt-4 space-y-3">
              {rewards.map(reward => (
                <div key={reward.id} className="rounded-lg border px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{reward.name}</div>
                    <Badge variant="outline">{reward.points_cost} pts</Badge>
                  </div>
                  {reward.description && <p className="mt-1 text-xs text-muted-foreground">{reward.description}</p>}
                </div>
              ))}
              <div className="rounded-lg border bg-slate-50 p-3">
                <Label>Reward Name</Label>
                <Input value={rewardForm.name} onChange={event => setRewardForm(form => ({ ...form, name: event.target.value }))} placeholder="Gift card, meal, bonus item" />
                <div className="mt-2 grid grid-cols-[110px_minmax(0,1fr)] gap-2">
                  <div>
                    <Label>Cost</Label>
                    <Input type="number" min="0" value={rewardForm.points_cost} onChange={event => setRewardForm(form => ({ ...form, points_cost: event.target.value }))} />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Input value={rewardForm.description} onChange={event => setRewardForm(form => ({ ...form, description: event.target.value }))} />
                  </div>
                </div>
                <Button className="mt-3 w-full" variant="outline" onClick={saveReward} disabled={saving || !rewardForm.name.trim()}>
                  Add Reward
                </Button>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
