'use client'

import { useMemo, useState } from 'react'
import { addDays, format, getDay } from 'date-fns'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { DepartmentTabs } from '@/components/reporting/DepartmentTabs'
import { ReportingToolbar } from '@/components/reporting/ReportingToolbar'
import { useEmployees, useTaskCompletions, useTasks } from '@/components/reporting/useReportingData'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ReportDepartment, ReportPeriod, getReportRange, isEmployeeInDepartment } from '@/lib/reporting'
import { Task } from '@/lib/types'

type TaskSummaryRow = {
  key: string
  date: string
  task: Task
  completeEntries: string[]
  incompleteEntries: string[]
  status: 'complete' | 'incomplete' | 'mixed' | 'open'
}

export default function TaskDetailPage() {
  const employees = useEmployees()
  const completions = useTaskCompletions()
  const tasks = useTasks() as (Task & { category?: { type?: string } })[]
  const initialParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null

  const [department, setDepartment] = useState<ReportDepartment>(
    initialParams?.get('department') === 'boh' ? 'boh' : 'foh'
  )
  const [period, setPeriod] = useState<ReportPeriod>('daily')
  const [refDate, setRefDate] = useState(new Date())
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const [startDate, endDate] = useMemo(
    () => getReportRange(period, refDate, customStart, customEnd),
    [period, refDate, customStart, customEnd]
  )
  const filteredEmployees = useMemo(
    () => employees.filter(employee => isEmployeeInDepartment(employee, department)),
    [employees, department]
  )
  const filteredTasks = useMemo(() => {
    if (period !== 'daily' || startDate !== endDate) return tasks
    const dayIndex = getDay(new Date(`${startDate}T12:00:00`))
    return tasks.filter(task => !task.days_of_week || task.days_of_week.includes(dayIndex))
  }, [tasks, period, startDate, endDate])

  const taskSummaryRows = useMemo<TaskSummaryRow[]>(() => {
    const employeeMap = new Map(filteredEmployees.map(employee => [employee.id, employee]))
    const rows: TaskSummaryRow[] = []
    const completionsInRange = completions.filter(
      completion => completion.session_date >= startDate && completion.session_date <= endDate
    )

    for (let current = new Date(`${startDate}T12:00:00`); format(current, 'yyyy-MM-dd') <= endDate; current = addDays(current, 1)) {
      const sessionDate = format(current, 'yyyy-MM-dd')
      const dayIndex = getDay(current)
      const tasksForDate = filteredTasks.filter(task => !task.days_of_week || task.days_of_week.includes(dayIndex))

      for (const task of tasksForDate) {
        const taskCompletions = completionsInRange.filter(completion => {
          if (completion.session_date !== sessionDate || completion.task_id !== task.id) return false
          return employeeMap.has(completion.employee_id)
        })

        const completeEntries = taskCompletions
          .filter(completion => completion.status !== 'incomplete')
          .map(completion => {
            const employee = employeeMap.get(completion.employee_id)
            const timeLabel = completion.completed_at ? format(new Date(completion.completed_at), 'p') : '—'
            return employee ? `${employee.name} • ${timeLabel}` : null
          })
          .filter((entry): entry is string => Boolean(entry))

        const incompleteEntries = taskCompletions
          .filter(completion => completion.status === 'incomplete')
          .map(completion => {
            const employee = employeeMap.get(completion.employee_id)
            const timeLabel = completion.completed_at ? format(new Date(completion.completed_at), 'p') : '—'
            return employee ? `${employee.name} • ${timeLabel}` : null
          })
          .filter((entry): entry is string => Boolean(entry))

        const status: TaskSummaryRow['status'] =
          completeEntries.length > 0 && incompleteEntries.length > 0
            ? 'mixed'
            : completeEntries.length > 0
              ? 'complete'
              : incompleteEntries.length > 0
                ? 'incomplete'
                : 'open'

        rows.push({
          key: `${sessionDate}:${task.id}`,
          date: sessionDate,
          task,
          completeEntries,
          incompleteEntries,
          status,
        })
      }
    }

    return rows
  }, [completions, endDate, filteredEmployees, filteredTasks, startDate])

  return (
    <div className="p-6">
      <AdminSubpageHeader
        title="Task Detail"
        subtitle="Review each day’s task list with completed names and timestamps."
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
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Phase</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Completed By</TableHead>
              <TableHead>Incomplete By</TableHead>
              <TableHead className="text-right">Summary</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {taskSummaryRows.map(row => (
              <TableRow key={row.key}>
                <TableCell className="font-medium">{format(new Date(`${row.date}T12:00:00`), 'MMM d, yyyy')}</TableCell>
                <TableCell>{row.task.title}</TableCell>
                <TableCell className="capitalize text-muted-foreground">{row.task.category?.type?.replace('_', ' ') ?? '—'}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      row.status === 'complete'
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                        : row.status === 'incomplete'
                          ? 'border-red-300 bg-red-50 text-red-700'
                          : row.status === 'mixed'
                            ? 'border-violet-300 bg-violet-50 text-violet-800'
                            : 'border-amber-300 bg-amber-50 text-amber-800'
                    }
                  >
                    {row.status === 'open'
                      ? 'Open'
                      : row.status === 'mixed'
                        ? 'Mixed'
                        : row.status === 'incomplete'
                          ? 'Incomplete'
                          : 'Complete'}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-emerald-700">
                  {row.completeEntries.length > 0 ? row.completeEntries.join(', ') : '—'}
                </TableCell>
                <TableCell className="text-sm text-red-700">
                  {row.incompleteEntries.length > 0 ? row.incompleteEntries.join(', ') : '—'}
                </TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">
                  {row.completeEntries.length} complete / {row.incompleteEntries.length} incomplete
                </TableCell>
              </TableRow>
            ))}
            {taskSummaryRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">No tasks found for this range</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
