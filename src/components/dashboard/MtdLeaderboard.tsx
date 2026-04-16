'use client'

import { useMemo, useState } from 'react'
import { addMonths, endOfMonth, format, isSameMonth, startOfMonth, subMonths } from 'date-fns'
import { employeeMatchesScheduleDepartment } from '@/lib/organization'
import { useClockRecords, useEmployees, useEodReports, useTaskCompletions } from '@/components/reporting/useReportingData'
import { useAppSettings } from '@/components/useAppSettings'
import { buildPerformanceReportHtml, buildPerformanceRows } from '@/lib/performanceReporting'
import { PerformanceReportDialog } from '@/components/reporting/PerformanceReportDialog'
import { formatCurrency } from '@/lib/reporting'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface MtdLeaderboardProps {
  today?: string
}

export function MtdLeaderboard({ today }: MtdLeaderboardProps) {
  const employees = useEmployees()
  const { completions } = useTaskCompletions()
  const { eodReports } = useEodReports()
  const { clockRecords } = useClockRecords()
  const { roleDefinitions } = useAppSettings()

  const [detailEmployeeId, setDetailEmployeeId] = useState<string | null>(null)
  const [emailingEmployeeId, setEmailingEmployeeId] = useState<string | null>(null)
  const [monthRef, setMonthRef] = useState(() => startOfMonth(new Date()))

  const effectiveToday = today ?? format(new Date(), 'yyyy-MM-dd')
  const todayDate = new Date(`${effectiveToday}T12:00:00`)
  const viewingCurrentMonth = isSameMonth(monthRef, todayDate)
  const rangeStartDate = startOfMonth(monthRef)
  const rangeEndDate = viewingCurrentMonth ? todayDate : endOfMonth(monthRef)
  const monthStart = format(rangeStartDate, 'yyyy-MM-dd')
  const rangeEnd = format(rangeEndDate, 'yyyy-MM-dd')
  const filteredEmployees = useMemo(
    () => employees.filter(employee => employeeMatchesScheduleDepartment(employee, 'foh')),
    [employees]
  )

  const { filteredCompletions, employeeMonthStats, perfRows, totalTasks } = useMemo(
    () => buildPerformanceRows({
      employees: filteredEmployees,
      completions,
      eodReports,
      clockRecords,
      startDate: monthStart,
      endDate: rangeEnd,
      monthStart,
      monthEnd: rangeEnd,
    }),
    [clockRecords, completions, eodReports, filteredEmployees, monthStart, rangeEnd]
  )

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
      departmentLabel: 'FOH',
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
          department: 'foh',
          report_html: buildReportHtml(employeeId),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Failed to send performance report')
    } finally {
      setEmailingEmployeeId(null)
    }
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
      <div className="min-w-[360px] rounded-xl border bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">MTD Leaderboard</div>
            <div className="mt-1 text-xs text-muted-foreground">{monthStart} - {rangeEnd}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              onClick={() => setMonthRef(current => subMonths(current, 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <div className="min-w-[110px] text-center">
              <div className="text-xs font-semibold text-slate-700">{format(monthRef, 'MMMM yyyy')}</div>
              <div className="text-[11px] text-muted-foreground">{totalTasks} completed</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              onClick={() => setMonthRef(current => addMonths(current, 1))}
              disabled={viewingCurrentMonth}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-[28px_minmax(0,1fr)_60px_70px_70px_72px] gap-2 px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
          <span>#</span>
          <span>Name</span>
          <span className="text-right">Score</span>
          <span className="text-right">Tasks/Hr</span>
          <span className="text-right">Hours</span>
          <span className="text-right">Tips/Hr</span>
        </div>
        <div className="mt-3 space-y-2">
          {perfRows.slice(0, 5).map((row, index) => (
            <div key={row.emp.id} className="grid grid-cols-[28px_minmax(0,1fr)_60px_70px_70px_72px] items-center gap-2 rounded-lg border px-2 py-2 text-sm">
              <div className="text-center font-semibold text-amber-700">{index + 1}</div>
              <Button
                variant="ghost"
                className="h-auto justify-start px-0 py-0 font-medium text-left hover:bg-transparent hover:underline"
                onClick={() => setDetailEmployeeId(row.emp.id)}
              >
                {row.emp.name}
              </Button>
              <div className="text-right font-semibold">{row.monthly?.score ?? '—'}</div>
              <div className="text-right text-xs text-muted-foreground">{row.monthly ? row.monthly.taskRate.toFixed(1) : '—'}/hr</div>
              <div className="text-right text-xs text-muted-foreground">{row.monthly?.hours.toFixed(1) ?? '—'}h</div>
              <div className="text-right text-xs text-muted-foreground">{row.monthly ? formatCurrency(row.monthly.tipRate) : '—'}</div>
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
