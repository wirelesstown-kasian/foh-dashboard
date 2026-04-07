'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, getDay } from 'date-fns'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { DepartmentTabs } from '@/components/reporting/DepartmentTabs'
import { ReportingNav } from '@/components/reporting/ReportingNav'
import { ReportingToolbar } from '@/components/reporting/ReportingToolbar'
import { useEmployees, useTaskCompletions, useTasks } from '@/components/reporting/useReportingData'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ReportDepartment, ReportPeriod, getReportRange, isEmployeeInDepartment } from '@/lib/reporting'
import { Employee, Task } from '@/lib/types'

type TaskDetailRow = {
  id: string
  date: string
  employee: Employee
  task: Task
  status: 'complete' | 'incomplete' | 'open'
  completedAt: string | null
}

export default function TaskDetailPage() {
  const employees = useEmployees()
  const completions = useTaskCompletions()
  const tasks = useTasks() as (Task & { category?: { type?: string } })[]

  const [department, setDepartment] = useState<ReportDepartment>('foh')
  const [period, setPeriod] = useState<ReportPeriod>('daily')
  const [refDate, setRefDate] = useState(new Date())
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [employeeFilter, setEmployeeFilter] = useState('all')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const nextDepartment = params.get('department')
    const nextEmployee = params.get('employee')
    if (nextDepartment === 'foh' || nextDepartment === 'boh') {
      setDepartment(nextDepartment)
    }
    if (nextEmployee) {
      setEmployeeFilter(nextEmployee)
    }
  }, [])

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

  const detailRows = useMemo<TaskDetailRow[]>(() => {
    const completionRows = completions
      .filter(completion => completion.session_date >= startDate && completion.session_date <= endDate)
      .reduce<TaskDetailRow[]>((rows, completion) => {
        const employee = filteredEmployees.find(item => item.id === completion.employee_id)
        const task = filteredTasks.find(item => item.id === completion.task_id)
        if (!employee || !task) return rows
        rows.push({
          id: completion.id,
          date: completion.session_date,
          employee,
          task,
          status: completion.status === 'incomplete' ? 'incomplete' : 'complete',
          completedAt: completion.completed_at,
        })
        return rows
      }, [])

    if (period !== 'daily' || startDate !== endDate) {
      return completionRows
    }

    const existingKeys = new Set(completionRows.map(row => `${row.date}:${row.employee.id}:${row.task.id}`))
    const openRows: TaskDetailRow[] = []

    for (const employee of filteredEmployees) {
      for (const task of filteredTasks) {
        const key = `${startDate}:${employee.id}:${task.id}`
        if (existingKeys.has(key)) continue
        openRows.push({
          id: `open:${key}`,
          date: startDate,
          employee,
          task,
          status: 'open',
          completedAt: null,
        })
      }
    }

    return [...completionRows, ...openRows]
  }, [completions, endDate, filteredEmployees, filteredTasks, period, startDate])

  const displayedRows = useMemo(
    () => (employeeFilter === 'all' ? detailRows : detailRows.filter(row => row.employee.id === employeeFilter)),
    [detailRows, employeeFilter]
  )

  return (
    <div className="p-6">
      <AdminSubpageHeader
        title="Task Detail"
        subtitle="Review complete, incomplete, and still-open tasks by employee."
        backHref="/reporting"
        backLabel="Back to Reporting"
      />
      <ReportingNav />
      <DepartmentTabs department={department} onChange={value => { setDepartment(value); setEmployeeFilter('all') }} />
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
            <Select value={employeeFilter} onValueChange={(value: string | null) => value && setEmployeeFilter(value)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Staff</SelectItem>
                {filteredEmployees.map(employee => (
                  <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Phase</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Completed At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayedRows.map(row => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{format(new Date(`${row.date}T12:00:00`), 'MMM d, yyyy')}</TableCell>
                <TableCell>{row.employee.name}</TableCell>
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
                          : 'border-amber-300 bg-amber-50 text-amber-800'
                    }
                  >
                    {row.status === 'open' ? 'Open' : row.status === 'incomplete' ? 'Incomplete' : 'Complete'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {row.completedAt ? format(new Date(row.completedAt), 'p') : '—'}
                </TableCell>
              </TableRow>
            ))}
            {displayedRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No task rows for this range</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
