'use client'

import { useMemo, useState } from 'react'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { DepartmentTabs } from '@/components/reporting/DepartmentTabs'
import { ReportingToolbar } from '@/components/reporting/ReportingToolbar'
import { useClockRecords, useEmployees, useEodReports, useTaskCompletions } from '@/components/reporting/useReportingData'
import { useAppSettings } from '@/components/useAppSettings'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ReportDepartment, ReportPeriod, formatCurrency, getPercent, getReportRange, isEmployeeInDepartment } from '@/lib/reporting'
import { getEffectiveClockHours } from '@/lib/clockUtils'
import { getRoleLabel } from '@/lib/organization'
import { Trophy } from 'lucide-react'
import { format } from 'date-fns'
import { exportReportToPdf } from '@/lib/reportExport'

function getRankMap<T>(items: T[], getValue: (item: T) => number, getId: (item: T) => string) {
  const sorted = [...items].sort((a, b) => getValue(b) - getValue(a))
  return new Map(sorted.map((item, index) => [getId(item), index + 1]))
}

function scoreFromRank(rank: number, count: number) {
  if (count <= 1) return 100
  return ((count - rank) / (count - 1)) * 100
}

export default function TaskPerformancePage() {
  const employees = useEmployees()
  const { completions } = useTaskCompletions()
  const { eodReports } = useEodReports()
  const { clockRecords } = useClockRecords()
  const { roleDefinitions } = useAppSettings()

  const [department, setDepartment] = useState<ReportDepartment>('foh')
  const [period, setPeriod] = useState<ReportPeriod>('weekly')
  const [refDate, setRefDate] = useState(new Date())
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [detailEmployeeId, setDetailEmployeeId] = useState<string | null>(null)
  const [emailingEmployeeId, setEmailingEmployeeId] = useState<string | null>(null)

  const [startDate, endDate] = useMemo(
    () => getReportRange(period, refDate, customStart, customEnd),
    [period, refDate, customStart, customEnd]
  )
  const filteredEmployees = useMemo(
    () => employees.filter(employee => isEmployeeInDepartment(employee, department)),
    [employees, department]
  )
  const filteredEmployeeIds = useMemo(
    () => new Set(filteredEmployees.map(employee => employee.id)),
    [filteredEmployees]
  )

  const filteredCompletions = useMemo(
    () =>
      completions.filter(
        completion =>
          completion.session_date >= startDate &&
          completion.session_date <= endDate &&
          filteredEmployeeIds.has(completion.employee_id) &&
          completion.status !== 'incomplete'
      ),
    [completions, startDate, endDate, filteredEmployeeIds]
  )

  const monthStart = format(new Date(`${startDate}T12:00:00`), 'yyyy-MM-01')
  const monthEnd = format(new Date(new Date(`${endDate}T12:00:00`).getFullYear(), new Date(`${endDate}T12:00:00`).getMonth() + 1, 0), 'yyyy-MM-dd')

  const employeeMonthStats = useMemo(() => {
    const monthCompletions = completions.filter(c => c.session_date >= monthStart && c.session_date <= monthEnd && c.status !== 'incomplete')
    const monthEods = eodReports.filter(r => r.session_date >= monthStart && r.session_date <= monthEnd)
    const monthClockRecords = clockRecords.filter(record => record.session_date >= monthStart && record.session_date <= monthEnd)
    const monthHoursByEmp = new Map<string, number>()
    const monthTipsByEmp = new Map<string, number>()

    for (const record of monthClockRecords) {
      if (!filteredEmployeeIds.has(record.employee_id)) continue
      monthHoursByEmp.set(record.employee_id, (monthHoursByEmp.get(record.employee_id) ?? 0) + getEffectiveClockHours(record))
    }
    for (const eod of monthEods) {
      for (const dist of eod.tip_distributions ?? []) {
        if (!filteredEmployeeIds.has(dist.employee_id)) continue
        monthTipsByEmp.set(dist.employee_id, (monthTipsByEmp.get(dist.employee_id) ?? 0) + Number(dist.net_tip))
      }
    }

    const baseStats = filteredEmployees.map(emp => {
      const tasks = monthCompletions.filter(c => c.employee_id === emp.id).length
      const hours = monthHoursByEmp.get(emp.id) ?? 0
      const totalTips = monthTipsByEmp.get(emp.id) ?? 0
      return {
        emp,
        tasks,
        hours,
        totalTips,
        taskRate: hours > 0 ? tasks / hours : 0,
        tipRate: hours > 0 ? totalTips / hours : 0,
      }
    }).filter(item => item.tasks > 0 || item.hours > 0 || item.totalTips > 0)

    const taskRankMap = getRankMap(baseStats, item => item.tasks, item => item.emp.id)
    const taskRateRankMap = getRankMap(baseStats.filter(item => item.hours > 0), item => item.taskRate, item => item.emp.id)
    const tipRateRankMap = getRankMap(baseStats.filter(item => item.hours > 0), item => item.tipRate, item => item.emp.id)
    const hoursRankMap = getRankMap(baseStats, item => item.hours, item => item.emp.id)

    return baseStats.map(item => {
      const taskRank = taskRankMap.get(item.emp.id) ?? 1
      const taskRateRank = taskRateRankMap.get(item.emp.id) ?? 1
      const tipRateRank = tipRateRankMap.get(item.emp.id) ?? 1
      const hoursRank = hoursRankMap.get(item.emp.id) ?? 1
      return {
        ...item,
        taskRank,
        taskRateRank,
        tipRateRank,
        hoursRank,
        score: Math.round(
          scoreFromRank(taskRank, Math.max(taskRankMap.size, 1)) * 0.3 +
          scoreFromRank(taskRateRank, Math.max(taskRateRankMap.size, 1)) * 0.3 +
          scoreFromRank(tipRateRank, Math.max(tipRateRankMap.size, 1)) * 0.25 +
          scoreFromRank(hoursRank, Math.max(hoursRankMap.size, 1)) * 0.15
        ),
      }
    })
  }, [clockRecords, completions, eodReports, filteredEmployeeIds, filteredEmployees, monthEnd, monthStart])

  const perfRows = useMemo(
    () =>
      filteredEmployees
        .map(emp => {
          const done = filteredCompletions.filter(c => c.employee_id === emp.id).length
          const monthly = employeeMonthStats.find(item => item.emp.id === emp.id)
          return { emp, done, monthly }
        })
        .sort((a, b) => (b.monthly?.score ?? -1) - (a.monthly?.score ?? -1) || b.done - a.done),
    [employeeMonthStats, filteredCompletions, filteredEmployees]
  )

  const totalTasks = perfRows.reduce((sum, row) => sum + row.done, 0)
  const detailTarget = perfRows.find(row => row.emp.id === detailEmployeeId) ?? null

  const buildPerformanceReportHtml = (employeeId: string) => {
    const row = perfRows.find(item => item.emp.id === employeeId)
    if (!row) return ''
    const overallRank = perfRows.findIndex(item => item.emp.id === employeeId) + 1
    const staffCount = perfRows.length
    const monthly = row.monthly
    const share = totalTasks > 0 ? getPercent((row.done / totalTasks) * 100) : '0.0%'
    return `
      <h1>${row.emp.name} Performance Report</h1>
      <p class="muted">${startDate === endDate ? startDate : `${startDate} - ${endDate}`}</p>
      <div class="report-grid">
        <div>
          <div class="summary">
            <div class="card"><strong>Overall Rank</strong><div class="metric">#${overallRank}</div><div class="muted">of ${staffCount}</div></div>
            <div class="card"><strong>Performance Score</strong><div class="metric">${monthly?.score ?? '—'}</div><div class="muted">Monthly weighted KPI</div></div>
            <div class="card"><strong>Tasks This Period</strong><div class="metric">${row.done}</div><div class="muted">Share ${share}</div></div>
            <div class="card"><strong>Total Tips</strong><div class="metric">${monthly ? formatCurrency(monthly.totalTips) : '—'}</div><div class="muted">This month</div></div>
          </div>
          <h3>Performance Summary</h3>
          <p>
            ${row.emp.name} is currently ranked #${overallRank} out of ${staffCount} staff in ${department.toUpperCase()}.
            Monthly pace is ${monthly ? monthly.taskRate.toFixed(2) : '0.00'} tasks/hr with ${monthly?.hours.toFixed(2) ?? '0.00'} hours worked
            and ${monthly ? formatCurrency(monthly.tipRate) : '$0.00'} tips/hr.
          </p>
        </div>
        <table class="compact-table">
          <thead>
            <tr><th>KPI</th><th class="right">Value</th><th class="right">Rank</th></tr>
          </thead>
          <tbody>
            <tr><td>Tasks / Hr</td><td class="right">${monthly ? monthly.taskRate.toFixed(2) : '—'}</td><td class="right">${monthly ? `#${monthly.taskRateRank}` : '—'}</td></tr>
            <tr><td>Working Hours</td><td class="right">${monthly?.hours.toFixed(2) ?? '0.00'} hrs</td><td class="right">${monthly ? `#${monthly.hoursRank}` : '—'}</td></tr>
            <tr><td>Completed Tasks</td><td class="right">${monthly?.tasks ?? 0}</td><td class="right">${monthly ? `#${monthly.taskRank}` : '—'}</td></tr>
            <tr><td>Tips / Hr</td><td class="right">${monthly ? formatCurrency(monthly.tipRate) : '—'}</td><td class="right">${monthly ? `#${monthly.tipRateRank}` : '—'}</td></tr>
          </tbody>
        </table>
      </div>
    `
  }

  const handleEmailReport = async (employeeId: string) => {
    setEmailingEmployeeId(employeeId)
    try {
      const res = await fetch('/api/send-performance-report-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId,
          start_date: startDate,
          end_date: endDate,
          department,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Failed to send performance report')
    } finally {
      setEmailingEmployeeId(null)
    }
  }

  return (
    <div className="p-6">
      <AdminSubpageHeader
        title="Task Performance"
        subtitle="Overview scores, pace, and ranking for the selected range."
        backHref="/reporting"
        backLabel="Back to Reporting"
      />
      <DepartmentTabs department={department} onChange={setDepartment} />
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
          rightSlot={
            <a
              href={`/reporting/task-detail?department=${department}`}
              className="inline-flex h-9 items-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Task Detail
            </a>
          }
        />
        <div className="mb-5 grid gap-4 md:grid-cols-4">
          <div className="rounded-xl border bg-amber-50 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-amber-700">Top Performer</div>
            <div className="mt-2 text-lg font-semibold text-amber-950">{perfRows[0]?.emp.name ?? '—'}</div>
            <div className="text-sm text-amber-800">{perfRows[0]?.monthly ? `Score ${perfRows[0].monthly.score}` : 'No task data yet'}</div>
          </div>
          <div className="rounded-xl border bg-sky-50 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-sky-700">Tasks In Period</div>
            <div className="mt-2 text-2xl font-bold text-sky-950">{totalTasks}</div>
            <div className="text-sm text-sky-800">{startDate === endDate ? format(new Date(`${startDate}T12:00:00`), 'MMM d, yyyy') : `${startDate} - ${endDate}`}</div>
          </div>
          <div className="rounded-xl border bg-green-50 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-green-700">Active Staff</div>
            <div className="mt-2 text-2xl font-bold text-green-950">{perfRows.filter(item => item.done > 0).length}</div>
            <div className="text-sm text-green-800">Staff with completed tasks</div>
          </div>
          <div className="rounded-xl border bg-violet-50 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-violet-700">Quick Read</div>
            <div className="mt-2 text-sm font-medium text-violet-950">
              Open task detail for complete, incomplete, and still-open rows by employee.
            </div>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">Rank</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Tasks This Period</TableHead>
              <TableHead className="text-right">Performance Score</TableHead>
              <TableHead className="text-right">Monthly Tasks</TableHead>
              <TableHead className="text-right">Tip Pace</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {perfRows.map((row, idx) => (
              <TableRow key={row.emp.id}>
                <TableCell>{idx === 0 ? <Trophy className="h-4 w-4 text-amber-500" /> : idx + 1}</TableCell>
                <TableCell>
                  <a className="font-medium hover:underline" href={`/reporting/task-detail?employee=${row.emp.id}&department=${department}`}>
                    {row.emp.name}
                  </a>
                  <Button size="sm" variant="outline" className="ml-3" onClick={() => setDetailEmployeeId(row.emp.id)}>
                    View Report
                  </Button>
                </TableCell>
                <TableCell className="text-muted-foreground">{getRoleLabel(row.emp.role, roleDefinitions)}</TableCell>
                <TableCell className="text-right font-semibold">{row.done}</TableCell>
                <TableCell className="text-right font-semibold text-amber-700">{row.monthly?.score ?? '—'}</TableCell>
                <TableCell className="text-right text-muted-foreground">{row.monthly?.tasks ?? 0}</TableCell>
                <TableCell className="text-right">{row.monthly ? formatCurrency(row.monthly.tipRate) : '—'}</TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">{totalTasks > 0 ? getPercent((row.done / totalTasks) * 100) : '0.0%'}</TableCell>
              </TableRow>
            ))}
            {perfRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">No task data for this range</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!detailTarget} onOpenChange={(open) => { if (!open) setDetailEmployeeId(null) }}>
        <DialogContent className="w-[min(96vw,1440px)] max-w-none max-h-[92vh] overflow-y-auto p-7">
          <DialogHeader>
            <DialogTitle>{detailTarget?.emp.name} Performance Report</DialogTitle>
          </DialogHeader>
          {detailTarget && (
            <div className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-[1.45fr_0.95fr]">
                <div className="rounded-2xl border bg-gradient-to-br from-amber-50 via-white to-sky-50 p-5">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Performance Summary</div>
                  <div className="mt-3 flex flex-wrap items-end gap-6">
                    <div>
                      <div className="text-sm text-muted-foreground">Performance Score</div>
                      <div className="text-5xl font-bold text-slate-950">{detailTarget.monthly?.score ?? '—'}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Overall Rank</div>
                      <div className="text-2xl font-semibold text-slate-900">
                        #{perfRows.findIndex(item => item.emp.id === detailTarget.emp.id) + 1}
                        <span className="ml-2 text-sm font-medium text-muted-foreground">of {perfRows.length}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border bg-white p-3">
                      <div className="text-xs text-muted-foreground">Tasks This Period</div>
                      <div className="mt-1 text-xl font-semibold">{detailTarget.done}</div>
                    </div>
                    <div className="rounded-xl border bg-white p-3">
                      <div className="text-xs text-muted-foreground">Task Share</div>
                      <div className="mt-1 text-xl font-semibold">{totalTasks > 0 ? getPercent((detailTarget.done / totalTasks) * 100) : '0.0%'}</div>
                    </div>
                    <div className="rounded-xl border bg-white p-3">
                      <div className="text-xs text-muted-foreground">Monthly Tasks</div>
                      <div className="mt-1 text-xl font-semibold">{detailTarget.monthly?.tasks ?? 0}</div>
                    </div>
                    <div className="rounded-xl border bg-white p-3">
                      <div className="text-xs text-muted-foreground">Hours Worked</div>
                      <div className="mt-1 text-xl font-semibold">{detailTarget.monthly?.hours.toFixed(2) ?? '0.00'} hrs</div>
                    </div>
                    <div className="rounded-xl border bg-white p-3">
                      <div className="text-xs text-muted-foreground">Tasks / Hr</div>
                      <div className="mt-1 text-xl font-semibold">{detailTarget.monthly ? detailTarget.monthly.taskRate.toFixed(2) : '—'}</div>
                    </div>
                    <div className="rounded-xl border bg-white p-3">
                      <div className="text-xs text-muted-foreground">Tips / Hr</div>
                      <div className="mt-1 text-xl font-semibold">{detailTarget.monthly ? formatCurrency(detailTarget.monthly.tipRate) : '—'}</div>
                    </div>
                    <div className="rounded-xl border bg-white p-3">
                      <div className="text-xs text-muted-foreground">Total Tips</div>
                      <div className="mt-1 text-xl font-semibold">{detailTarget.monthly ? formatCurrency(detailTarget.monthly.totalTips) : '—'}</div>
                    </div>
                    <div className="rounded-xl border bg-white p-3">
                      <div className="text-xs text-muted-foreground">Role</div>
                      <div className="mt-1 text-xl font-semibold">{getRoleLabel(detailTarget.emp.role, roleDefinitions)}</div>
                    </div>
                  </div>
                  <div className="mt-5 rounded-2xl border border-amber-200 bg-white/90 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Quick Summary</div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">
                      Overall rank is #{perfRows.findIndex(item => item.emp.id === detailTarget.emp.id) + 1} of {perfRows.length}.
                      {` `}
                      Tasks per hour rank is #{detailTarget.monthly?.taskRateRank ?? '—'}, working hours rank is #{detailTarget.monthly?.hoursRank ?? '—'},
                      and completed tasks rank is #{detailTarget.monthly?.taskRank ?? '—'} for the current month.
                    </p>
                  </div>
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">KPI Ranking</div>
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3">
                      <span className="text-sm font-medium">Overall Rank</span>
                      <span className="text-sm font-semibold">#{perfRows.findIndex(item => item.emp.id === detailTarget.emp.id) + 1}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                      <span className="text-sm font-medium">Tasks / Hr Rank</span>
                      <span className="text-sm font-semibold">#{detailTarget.monthly?.taskRateRank ?? '—'}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                      <span className="text-sm font-medium">Working Hours Rank</span>
                      <span className="text-sm font-semibold">#{detailTarget.monthly?.hoursRank ?? '—'}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                      <span className="text-sm font-medium">Completed Tasks Rank</span>
                      <span className="text-sm font-semibold">#{detailTarget.monthly?.taskRank ?? '—'}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                      <span className="text-sm font-medium">Tips / Hr Rank</span>
                      <span className="text-sm font-semibold">#{detailTarget.monthly?.tipRateRank ?? '—'}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => exportReportToPdf(`${detailTarget.emp.name} Performance Report`, buildPerformanceReportHtml(detailTarget.emp.id))}>
                  PDF Export
                </Button>
                <Button onClick={() => void handleEmailReport(detailTarget.emp.id)} disabled={emailingEmployeeId === detailTarget.emp.id}>
                  {emailingEmployeeId === detailTarget.emp.id ? 'Sending…' : 'Email Report'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
