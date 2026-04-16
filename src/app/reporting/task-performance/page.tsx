'use client'

import { useMemo, useState } from 'react'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { DepartmentTabs } from '@/components/reporting/DepartmentTabs'
import { ReportingToolbar } from '@/components/reporting/ReportingToolbar'
import { useClockRecords, useEmployees, useEodReports, useScheduledDepartmentIds, useTaskCompletions } from '@/components/reporting/useReportingData'
import { useAppSettings } from '@/components/useAppSettings'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ReportDepartment, ReportPeriod, formatCurrency, getPercent, getReportRange, isEmployeeInDepartment } from '@/lib/reporting'
import { getRoleLabel } from '@/lib/organization'
import { Trophy } from 'lucide-react'
import { format } from 'date-fns'
import { PerformanceReportDialog } from '@/components/reporting/PerformanceReportDialog'
import { buildPerformanceReportHtml, buildPerformanceRows } from '@/lib/performanceReporting'

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
  const scheduledDeptIds = useScheduledDepartmentIds(startDate, endDate)
  const filteredEmployees = useMemo(
    () => employees.filter(employee => {
      const dept = employee.primary_department ?? 'foh'
      if (dept === 'hybrid') {
        const scheduled = scheduledDeptIds.get(department)
        return scheduled && scheduled.size > 0 ? scheduled.has(employee.id) : true
      }
      return isEmployeeInDepartment(employee, department)
    }),
    [employees, department, scheduledDeptIds]
  )
  const monthStart = format(new Date(`${startDate}T12:00:00`), 'yyyy-MM-01')
  const monthEnd = format(new Date(new Date(`${endDate}T12:00:00`).getFullYear(), new Date(`${endDate}T12:00:00`).getMonth() + 1, 0), 'yyyy-MM-dd')
  const { filteredCompletions, employeeMonthStats, perfRows, totalTasks } = useMemo(
    () => buildPerformanceRows({
      employees: filteredEmployees,
      completions,
      eodReports,
      clockRecords,
      startDate,
      endDate,
      monthStart,
      monthEnd,
    }),
    [clockRecords, completions, eodReports, filteredEmployees, startDate, endDate, monthStart, monthEnd]
  )
  const detailTarget = perfRows.find(row => row.emp.id === detailEmployeeId) ?? null

  const buildReportHtml = (employeeId: string) =>
    buildPerformanceReportHtml({
      employeeId,
      perfRows,
      employeeMonthStats,
      filteredCompletions,
      totalTasks,
      startDate,
      endDate,
      departmentLabel: department.toUpperCase(),
    })

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
          report_html: buildReportHtml(employeeId),
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
        subtitle="Score = Task Completion Rate (40%) + Tasks/Hr (35%) + Tips/Hr (25%) — shift-adjusted, fair for any schedule type."
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
              <TableHead className="text-right">Score</TableHead>
              <TableHead className="text-right">Completion Rate</TableHead>
              <TableHead className="text-right">Tips/Hr</TableHead>
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
                <TableCell className="text-right text-muted-foreground">{row.monthly ? (row.monthly.taskCompletionRate * 100).toFixed(1) + '%' : '—'}</TableCell>
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
    </div>
  )
}
