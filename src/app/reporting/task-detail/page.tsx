'use client'

import { useMemo, useState } from 'react'
import { addDays, format, getDay } from 'date-fns'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { DepartmentTabs } from '@/components/reporting/DepartmentTabs'
import { ReportingToolbar } from '@/components/reporting/ReportingToolbar'
import { notifyReportingDataChanged, useEmployees, useTaskCompletions, useTasks } from '@/components/reporting/useReportingData'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ReportDepartment, ReportPeriod, getReportRange, isEmployeeInDepartment } from '@/lib/reporting'
import { Task, TaskCompletion, TaskCompletionStatus } from '@/lib/types'

type TaskSummaryRow = {
  key: string
  date: string
  task: Task
  completion: TaskCompletion | null
  completeEntries: string[]
  incompleteEntries: string[]
  status: 'complete' | 'incomplete' | 'mixed' | 'open'
}

type TaskSortOption = 'date' | 'phase' | 'status' | 'completed_by' | 'incomplete_by'

const STATUS_ORDER: Record<TaskSummaryRow['status'], number> = {
  complete: 0,
  mixed: 1,
  incomplete: 2,
  open: 3,
}

export default function TaskDetailPage() {
  const employees = useEmployees()
  const { completions, setCompletions } = useTaskCompletions()
  const tasks = useTasks() as (Task & { category?: { type?: string } })[]
  const initialParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null

  const [department, setDepartment] = useState<ReportDepartment>(
    initialParams?.get('department') === 'boh' ? 'boh' : 'foh'
  )
  const [period, setPeriod] = useState<ReportPeriod>('daily')
  const [refDate, setRefDate] = useState(new Date())
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [sortBy, setSortBy] = useState<TaskSortOption>('date')
  const [editTarget, setEditTarget] = useState<TaskSummaryRow | null>(null)
  const [editStatus, setEditStatus] = useState<'open' | TaskCompletionStatus>('open')
  const [editEmployeeId, setEditEmployeeId] = useState('none')
  const [savingEdit, setSavingEdit] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

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

        const sortedCompletions = [...taskCompletions].sort((a, b) => {
          const left = a.completed_at ?? ''
          const right = b.completed_at ?? ''
          return right.localeCompare(left)
        })
        const primaryCompletion = sortedCompletions[0] ?? null

        const completeEntries = sortedCompletions
          .filter(completion => completion.status !== 'incomplete')
          .map(completion => {
            const employee = employeeMap.get(completion.employee_id)
            const timeLabel = completion.completed_at ? format(new Date(completion.completed_at), 'p') : '—'
            return employee ? `${employee.name} • ${timeLabel}` : null
          })
          .filter((entry): entry is string => Boolean(entry))

        const incompleteEntries = sortedCompletions
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
          completion: primaryCompletion,
          completeEntries,
          incompleteEntries,
          status,
        })
      }
    }

    return rows.sort((a, b) => {
      if (sortBy === 'phase') {
        const phaseCompare = (a.task.category?.type ?? '').localeCompare(b.task.category?.type ?? '')
        if (phaseCompare !== 0) return phaseCompare
      }

      if (sortBy === 'status') {
        const statusCompare = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        if (statusCompare !== 0) return statusCompare
      }

      if (sortBy === 'completed_by') {
        const completeCompare = (a.completeEntries[0] ?? 'zzz').localeCompare(b.completeEntries[0] ?? 'zzz')
        if (completeCompare !== 0) return completeCompare
      }

      if (sortBy === 'incomplete_by') {
        const incompleteCompare = (a.incompleteEntries[0] ?? 'zzz').localeCompare(b.incompleteEntries[0] ?? 'zzz')
        if (incompleteCompare !== 0) return incompleteCompare
      }

      if (a.date !== b.date) return a.date.localeCompare(b.date)
      return a.task.title.localeCompare(b.task.title)
    })
  }, [completions, endDate, filteredEmployees, filteredTasks, sortBy, startDate])

  const openEditDialog = (row: TaskSummaryRow) => {
    setEditTarget(row)
    setEditStatus(row.status === 'open' ? 'open' : row.status === 'incomplete' ? 'incomplete' : 'complete')
    setEditEmployeeId(row.completion?.employee_id ?? 'none')
    setStatusMessage(null)
  }

  const saveTaskDetailEdit = async () => {
    if (!editTarget) return
    if (editStatus !== 'open' && editEmployeeId === 'none') {
      setStatusMessage('Select a staff member before saving.')
      return
    }

    setSavingEdit(true)
    setStatusMessage(null)

    const res = await fetch('/api/task-completions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        completion_id: editTarget.completion?.id,
        task_id: editTarget.task.id,
        session_date: editTarget.date,
        employee_id: editStatus === 'open' ? null : editEmployeeId,
        status: editStatus,
      }),
    })

    const json = (await res.json().catch(() => ({}))) as { success?: boolean; completion?: TaskCompletion | null; error?: string }
    if (!res.ok || !json.success) {
      setStatusMessage(json.error ?? 'Failed to update task detail')
      setSavingEdit(false)
      return
    }

    setCompletions(current => {
      const next = current.filter(completion => {
        if (editTarget.completion?.id) return completion.id !== editTarget.completion.id
        return !(completion.task_id === editTarget.task.id && completion.session_date === editTarget.date)
      })
      if (json.completion) next.push(json.completion)
      return next
    })
    notifyReportingDataChanged()
    setSavingEdit(false)
    setEditTarget(null)
    setStatusMessage('Task detail updated.')
  }

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
        {statusMessage && <div className="mb-4 rounded-lg border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">{statusMessage}</div>}
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
            <Select value={sortBy} onValueChange={(value: string | null) => value && setSortBy(value as TaskSortOption)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="date">Sort: Date</SelectItem>
                <SelectItem value="phase">Sort: Phase</SelectItem>
                <SelectItem value="status">Sort: Status</SelectItem>
                <SelectItem value="completed_by">Sort: Completed By</SelectItem>
                <SelectItem value="incomplete_by">Sort: Incompleted By</SelectItem>
              </SelectContent>
            </Select>
          }
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
              <TableHead className="text-right">Action</TableHead>
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
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => openEditDialog(row)}>
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {taskSummaryRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">No tasks found for this range</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Task Detail</DialogTitle>
            <DialogDescription>
              Change task status and who it is assigned to so reporting reflects the correction.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border bg-muted/30 px-4 py-3">
              <div className="text-sm font-medium">{editTarget?.task.title}</div>
              <div className="text-xs text-muted-foreground">{editTarget ? format(new Date(`${editTarget.date}T12:00:00`), 'MMM d, yyyy') : ''}</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Task Status</div>
              <Select value={editStatus} onValueChange={(value: string | null) => value && setEditStatus(value as 'open' | TaskCompletionStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="complete">Complete</SelectItem>
                  <SelectItem value="incomplete">Incomplete</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">{editStatus === 'incomplete' ? 'Incompleted By' : 'Completed By'}</div>
              <Select value={editEmployeeId} onValueChange={(value: string | null) => value && setEditEmployeeId(value)} disabled={editStatus === 'open'}>
                <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select staff</SelectItem>
                  {filteredEmployees.map(employee => (
                    <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={savingEdit}>Cancel</Button>
            <Button onClick={saveTaskDetailEdit} disabled={savingEdit}>{savingEdit ? 'Saving…' : 'Save Changes'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
