'use client'

import { useEffect, useMemo, useState } from 'react'
import { addMonths, endOfMonth, format, isSameMonth, startOfMonth, subMonths } from 'date-fns'
import { useAppSettings } from '@/components/useAppSettings'
import { buildPerformanceReportHtml, buildPerformanceRows } from '@/lib/performanceReporting'
import { PerformanceReportDialog } from '@/components/reporting/PerformanceReportDialog'
import { formatCurrency } from '@/lib/reporting'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { buildEmployeeRewardPointRows } from '@/lib/rewards'
import { Employee, EodReport, GoogleReview, RewardRedemption, ShiftClock, Task, TaskCompletion, TipDistribution } from '@/lib/types'

interface MtdLeaderboardProps {
  today?: string
}

type LeaderboardPayload = {
  employees?: Employee[]
  tasks?: Task[]
  completions?: TaskCompletion[]
  eodReports?: (EodReport & { tip_distributions?: (TipDistribution & { employee?: Employee })[] })[]
  clockRecords?: ShiftClock[]
  reviews?: GoogleReview[]
  redemptions?: RewardRedemption[]
  error?: string
}

export function MtdLeaderboard({ today }: MtdLeaderboardProps) {
  const { roleDefinitions } = useAppSettings()

  const [detailEmployeeId, setDetailEmployeeId] = useState<string | null>(null)
  const [emailingEmployeeId, setEmailingEmployeeId] = useState<string | null>(null)
  const [monthRef, setMonthRef] = useState(() => startOfMonth(new Date()))
  const [data, setData] = useState<Required<Omit<LeaderboardPayload, 'error'>>>({
    employees: [],
    tasks: [],
    completions: [],
    eodReports: [],
    clockRecords: [],
    reviews: [],
    redemptions: [],
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const effectiveToday = today ?? format(new Date(), 'yyyy-MM-dd')
  const todayDate = new Date(`${effectiveToday}T12:00:00`)
  const viewingCurrentMonth = isSameMonth(monthRef, todayDate)
  const rangeStartDate = startOfMonth(monthRef)
  const rangeEndDate = viewingCurrentMonth ? todayDate : endOfMonth(monthRef)
  const monthStart = format(rangeStartDate, 'yyyy-MM-dd')
  const rangeEnd = format(rangeEndDate, 'yyyy-MM-dd')

  useEffect(() => {
    let mounted = true
    setLoading(true)
    setError(null)

    void (async () => {
      if (!mounted) return
      try {
        const params = new URLSearchParams({ start_date: monthStart, end_date: rangeEnd })
        const res = await fetch(`/api/leaderboard?${params.toString()}`, { cache: 'no-store' })
        const payload = (await res.json().catch(() => ({}))) as LeaderboardPayload
        if (!mounted) return
        if (!res.ok) {
          setError(payload.error ?? 'Failed to load leaderboard data')
          setData({
            employees: [],
            tasks: [],
            completions: [],
            eodReports: [],
            clockRecords: [],
            reviews: [],
            redemptions: [],
          })
        } else {
          setData({
            employees: payload.employees ?? [],
            tasks: payload.tasks ?? [],
            completions: payload.completions ?? [],
            eodReports: payload.eodReports ?? [],
            clockRecords: payload.clockRecords ?? [],
            reviews: payload.reviews ?? [],
            redemptions: payload.redemptions ?? [],
          })
        }
      } catch (fetchError) {
        if (!mounted) return
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to load leaderboard data')
        setData({
          employees: [],
          tasks: [],
          completions: [],
          eodReports: [],
          clockRecords: [],
          reviews: [],
          redemptions: [],
        })
      }
      setLoading(false)
    })()

    return () => {
      mounted = false
    }
  }, [monthStart, rangeEnd])

  const filteredEmployees = useMemo(() => data.employees, [data.employees])

  const { filteredCompletions, employeeMonthStats, perfRows, totalTasks } = useMemo(
    () => buildPerformanceRows({
      employees: filteredEmployees,
      completions: data.completions,
      eodReports: data.eodReports,
      clockRecords: data.clockRecords,
      startDate: monthStart,
      endDate: rangeEnd,
      monthStart,
      monthEnd: rangeEnd,
    }),
    [data.clockRecords, data.completions, data.eodReports, filteredEmployees, monthStart, rangeEnd]
  )

  const rewardPointsByEmployeeId = useMemo(() => {
    const rows = buildEmployeeRewardPointRows({
      employees: filteredEmployees,
      tasks: data.tasks,
      completions: data.completions,
      reviews: data.reviews,
      redemptions: data.redemptions,
    })
    return new Map(rows.map(row => [row.employee.id, row.totalPoints]))
  }, [data.completions, data.redemptions, data.reviews, data.tasks, filteredEmployees])

  const detailTarget = perfRows.find(row => row.emp.id === detailEmployeeId) ?? null

  const buildReportHtml = (employeeId: string) =>
    buildPerformanceReportHtml({
      employeeId,
      perfRows,
      employeeMonthStats,
      filteredCompletions,
      totalTasks,
      startDate: monthStart,
      endDate: rangeEnd,
      departmentLabel: 'All Staff',
    })

  const handleEmailReport = async (employeeId: string) => {
    setEmailingEmployeeId(employeeId)
    try {
      const res = await fetch('/api/send-performance-report-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId,
          start_date: monthStart,
          end_date: rangeEnd,
          department: 'all',
          report_html: buildReportHtml(employeeId),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Failed to send performance report')
    } finally {
      setEmailingEmployeeId(null)
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border bg-white p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">MTD Leaderboard</div>
        <p className="mt-2 text-sm text-muted-foreground">Loading leaderboard...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-red-700">MTD Leaderboard</div>
        <p className="mt-2 text-sm text-red-700">{error}</p>
      </div>
    )
  }

  if (perfRows.length === 0) {
    return (
      <div className="rounded-xl border bg-white p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">MTD Leaderboard</div>
        <p className="mt-2 text-sm text-muted-foreground">No month-to-date KPI data yet.</p>
      </div>
    )
  }

  return (
    <>
      <div className="w-full rounded-xl border bg-white p-4 md:p-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">MTD Leaderboard</div>
            <div className="mt-0.5 text-sm text-muted-foreground">{monthStart} — {rangeEnd}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 w-9 px-0"
              onClick={() => setMonthRef(current => subMonths(current, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-32 text-center">
              <div className="text-sm font-semibold text-slate-700">{format(monthRef, 'MMMM yyyy')}</div>
              <div className="text-xs text-muted-foreground">{totalTasks} tasks completed</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-9 w-9 px-0"
              onClick={() => setMonthRef(current => addMonths(current, 1))}
              disabled={viewingCurrentMonth}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-600">Score</span> = Completion 40% + Tasks/Hr 35% + Tips/Hr 25% — relative to team (0–100).
        </div>
        <div className="mt-2 grid grid-cols-[32px_minmax(0,1fr)_72px_72px] md:grid-cols-[40px_minmax(0,1fr)_100px_90px_80px_90px_90px] gap-2 md:gap-3 px-3 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
          <span>#</span>
          <span>Name</span>
          <span className="text-right">Score</span>
          <span className="text-right">Points</span>
          <span className="hidden text-right md:block">Tasks/Hr</span>
          <span className="hidden text-right md:block">Hours</span>
          <span className="hidden text-right md:block">Tips/Hr</span>
        </div>
        <div className="mt-3 space-y-2">
          {perfRows.map((row, index) => (
            <div key={row.emp.id} className="grid grid-cols-[32px_minmax(0,1fr)_72px_72px] md:grid-cols-[40px_minmax(0,1fr)_100px_90px_80px_90px_90px] items-center gap-2 md:gap-3 rounded-xl border px-3 py-3 text-base">
              <div className="text-center text-lg font-bold text-amber-600">{index + 1}</div>
              <Button
                variant="ghost"
                className="h-auto justify-start px-0 py-0 text-base font-semibold text-left hover:bg-transparent hover:underline"
                onClick={() => setDetailEmployeeId(row.emp.id)}
              >
                {row.emp.name}
              </Button>
              <div className="text-right">
                <div className="text-base font-bold">{row.monthly?.score ?? '—'}</div>
                {row.monthly && (
                  <div className="mt-0.5 space-y-0.5 text-[10px] leading-tight">
                    <div><span className="text-slate-400">cmpl </span><span className="font-medium text-slate-600">{(row.monthly.taskCompletionRate * 100).toFixed(0)}%</span></div>
                    <div><span className="text-slate-400">task </span><span className="font-medium text-slate-600">{row.monthly.taskRate.toFixed(1)}/hr</span></div>
                    <div><span className="text-slate-400">tips </span><span className="font-medium text-slate-600">{formatCurrency(row.monthly.tipRate)}/hr</span></div>
                  </div>
                )}
              </div>
              <div className="text-right text-base font-bold text-amber-700">{rewardPointsByEmployeeId.get(row.emp.id) ?? 0}</div>
              <div className="hidden text-right text-sm text-muted-foreground md:block">{row.monthly ? row.monthly.taskRate.toFixed(1) : '—'}/hr</div>
              <div className="hidden text-right text-sm text-muted-foreground md:block">{row.monthly?.hours.toFixed(1) ?? '—'}h</div>
              <div className="hidden text-right text-sm text-muted-foreground md:block">{row.monthly ? formatCurrency(row.monthly.tipRate) : '—'}</div>
            </div>
          ))}
        </div>
      </div>

      <PerformanceReportDialog
        detailTarget={detailTarget}
        perfRows={perfRows}
        employeeMonthStats={employeeMonthStats}
        filteredCompletions={filteredCompletions}
        totalTasks={totalTasks}
        roleDefinitions={roleDefinitions}
        buildReportHtml={buildReportHtml}
        emailingEmployeeId={emailingEmployeeId}
        onClose={() => setDetailEmployeeId(null)}
        onEmailReport={handleEmailReport}
      />
    </>
  )
}
