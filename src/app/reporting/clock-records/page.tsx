'use client'

import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { DepartmentTabs } from '@/components/reporting/DepartmentTabs'
import { ReportingToolbar } from '@/components/reporting/ReportingToolbar'
import { notifyReportingDataChanged, useClockRecords, useEmployees } from '@/components/reporting/useReportingData'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ReportDepartment, ReportPeriod, getReportRange, isEmployeeInDepartment } from '@/lib/reporting'
import { calculateClockHoursAfterBreak, getClockBreakMinutes, getEffectiveClockHours, getMealBreakState, getMealBreakThresholdHours, getUnpaidBreakState, getVisibleManagerNote, isClockPending, shouldWarnMissingMealBreak } from '@/lib/clockUtils'
import { Employee, ShiftClock } from '@/lib/types'
import { calculateTips } from '@/lib/tipCalc'
import { isTipEligibleEmployee } from '@/lib/tipEligibility'
import { supabase } from '@/lib/supabase'
import { insertTipDistributionsWithFallback } from '@/lib/tipDistributionWrite'
import { AlertTriangle, Plus } from 'lucide-react'

type ClockEditState = {
  sessionDate: string
  clockIn: string
  clockOut: string
  note: string
}

type AddHourFormState = {
  employeeId: string
  sessionDate: string
  clockIn: string
  clockOut: string
  note: string
}

const ALL_STAFF_FILTER = 'all_staff'

function isoToTimeInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function timeInputToIso(sessionDate: string, value: string) {
  if (!value) return null
  const [hour = '0', minute = '0'] = value.split(':')
  const date = new Date(`${sessionDate}T00:00:00`)
  date.setHours(Number(hour), Number(minute), 0, 0)
  if (Number(hour) < 3) date.setDate(date.getDate() + 1)
  return date.toISOString()
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return fallback
}

function getEmployeeNameById(employees: Employee[], employeeId: string) {
  return employees.find(employee => employee.id === employeeId)?.name ?? null
}

function getClockRecordEmployeeName(record: ShiftClock, employees: Employee[]) {
  return getClockRecordEmployee(record, employees)?.name ?? 'Unknown Staff'
}

function getClockRecordEmployee(record: ShiftClock, employees: Employee[]) {
  const relatedEmployee = record.employee as Employee | Employee[] | undefined
  if (Array.isArray(relatedEmployee)) {
    return relatedEmployee[0] ?? employees.find(employee => employee.id === record.employee_id) ?? null
  }
  return relatedEmployee ?? employees.find(employee => employee.id === record.employee_id) ?? null
}

function formatBreakSummary(record: ShiftClock) {
  const mealBreak = getMealBreakState(record)
  const regularBreak = getUnpaidBreakState(record)
  const parts: string[] = []

  if (mealBreak.startedAt) {
    parts.push(mealBreak.endedAt
      ? `Meal ${mealBreak.minutes} min`
      : `Meal open since ${format(new Date(mealBreak.startedAt), 'p')}`)
  }
  if (regularBreak.startedAt) {
    parts.push(regularBreak.endedAt
      ? `Break ${regularBreak.minutes} min`
      : `Break open since ${format(new Date(regularBreak.startedAt), 'p')}`)
  }

  return parts.length > 0 ? parts.join(' / ') : '—'
}

export default function ClockRecordsPage() {
  const employees = useEmployees({ includeArchived: true })

  const [department, setDepartment] = useState<ReportDepartment>('all')
  const [period, setPeriod] = useState<ReportPeriod>('daily')
  const [refDate, setRefDate] = useState(new Date())
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [selectedClockId, setSelectedClockId] = useState<string | null>(null)
  const [detailEditing, setDetailEditing] = useState(false)
  const [clockEdits, setClockEdits] = useState<Record<string, ClockEditState>>({})
  const [savingClockId, setSavingClockId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [addHourOpen, setAddHourOpen] = useState(false)
  const [addHourForm, setAddHourForm] = useState<AddHourFormState>({
    employeeId: '',
    sessionDate: format(new Date(), 'yyyy-MM-dd'),
    clockIn: '',
    clockOut: '',
    note: '',
  })
  const [addingHour, setAddingHour] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ShiftClock | null>(null)
  const [deletingClockId, setDeletingClockId] = useState<string | null>(null)

  const [startDate, endDate] = useMemo(
    () => getReportRange(period, refDate, customStart, customEnd),
    [period, refDate, customStart, customEnd]
  )
  const { clockRecords, setClockRecords } = useClockRecords({ startDate, endDate })
  const filteredEmployees = useMemo(
    () => employees.filter(employee => isEmployeeInDepartment(employee, department)),
    [employees, department]
  )
  const staffFilterEmployees = useMemo(() => {
    const byId = new Map<string, Employee>()
    for (const employee of filteredEmployees) byId.set(employee.id, employee)
    for (const record of clockRecords) {
      const employee = getClockRecordEmployee(record, employees)
      if (employee && isEmployeeInDepartment(employee, department)) byId.set(employee.id, employee)
    }
    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name))
  }, [clockRecords, department, employees, filteredEmployees])
  useEffect(() => {
    if (employeeFilter && !staffFilterEmployees.some(employee => employee.id === employeeFilter)) {
      setEmployeeFilter('')
    }
  }, [employeeFilter, staffFilterEmployees])
  const filteredClockRecords = useMemo(
    () =>
      clockRecords
        .filter(record => record.session_date >= startDate && record.session_date <= endDate)
        .filter(record => {
          const employee = record.employee ?? employees.find(item => item.id === record.employee_id)
          if (!employee || !isEmployeeInDepartment(employee, department)) return false
          return employeeFilter ? employee.id === employeeFilter : true
        })
        .sort((a, b) => b.clock_in_at.localeCompare(a.clock_in_at)),
    [clockRecords, department, employeeFilter, employees, endDate, startDate]
  )
  const getClockEditState = (record: ShiftClock): ClockEditState => ({
    sessionDate: record.session_date,
    clockIn: isoToTimeInput(record.clock_in_at),
    clockOut: isoToTimeInput(record.clock_out_at),
    note: getVisibleManagerNote(record.manager_note),
  })

  const selectedClockRecord = useMemo(
    () => clockRecords.find(record => record.id === selectedClockId) ?? null,
    [clockRecords, selectedClockId]
  )
  const selectedClockEmployee = selectedClockRecord ? getClockRecordEmployee(selectedClockRecord, employees) : null
  const selectedClockEdit = selectedClockRecord ? clockEdits[selectedClockRecord.id] ?? getClockEditState(selectedClockRecord) : null

  const openClockDetail = (record: ShiftClock, edit = false) => {
    setClockEdits(prev => ({ ...prev, [record.id]: prev[record.id] ?? getClockEditState(record) }))
    setSelectedClockId(record.id)
    setDetailEditing(edit)
    setStatus(null)
  }

  const openAddHourDialog = () => {
    const today = format(new Date(), 'yyyy-MM-dd')
    const defaultDate = today >= startDate && today <= endDate ? today : endDate
    const defaultEmployeeId = employeeFilter || (filteredEmployees[0]?.id ?? '')
    setAddHourForm({
      employeeId: defaultEmployeeId,
      sessionDate: defaultDate,
      clockIn: '',
      clockOut: '',
      note: '',
    })
    setStatus(null)
    setAddHourOpen(true)
  }

  const saveAddedHour = async () => {
    if (!addHourForm.employeeId || !addHourForm.sessionDate || !addHourForm.clockIn || !addHourForm.clockOut) {
      setStatus('Employee, date, clock in, and clock out are required.')
      return
    }

    const clockInAt = timeInputToIso(addHourForm.sessionDate, addHourForm.clockIn)
    const clockOutAt = timeInputToIso(addHourForm.sessionDate, addHourForm.clockOut)
    if (!clockInAt || !clockOutAt) {
      setStatus('Clock in and clock out times are required.')
      return
    }
    if (new Date(clockOutAt).getTime() <= new Date(clockInAt).getTime()) {
      setStatus('Clock out must be after clock in.')
      return
    }

    setAddingHour(true)
    setStatus(null)
    const res = await fetch('/api/clock-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'manual_add',
        employee_id: addHourForm.employeeId,
        session_date: addHourForm.sessionDate,
        clock_in_at: clockInAt,
        clock_out_at: clockOutAt,
        manager_note: addHourForm.note,
      }),
    })
    const json = (await res.json().catch(() => ({}))) as { record?: ShiftClock; error?: string }
    if (!res.ok || !json.record) {
      setStatus(json.error ?? 'Failed to add clock record')
      setAddingHour(false)
      return
    }

    setClockRecords(prev => [json.record!, ...prev])
    try {
      await recomputeSessionTips(json.record.session_date)
      notifyReportingDataChanged()
      setAddHourOpen(false)
      setStatus('Clock record added and tip distribution recalculated.')
    } catch (error) {
      setStatus(getErrorMessage(error, 'Clock record added, but tip distribution refresh failed'))
    } finally {
      setAddingHour(false)
    }
  }

  const saveClockAdjustment = async (record: ShiftClock) => {
    const currentEdit = clockEdits[record.id]
    if (!currentEdit) return false
    setSavingClockId(record.id)
    setStatus(null)
    const res = await fetch('/api/clock-events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: record.id,
        action: 'adjust',
        session_date: currentEdit.sessionDate,
        clock_in_at: timeInputToIso(currentEdit.sessionDate, currentEdit.clockIn),
        clock_out_at: timeInputToIso(currentEdit.sessionDate, currentEdit.clockOut),
        manager_note: currentEdit.note,
      }),
    })
    const json = (await res.json().catch(() => ({}))) as { record?: ShiftClock; error?: string }
    if (!res.ok || !json.record) {
      setStatus(json.error ?? 'Failed to save clock change')
      setSavingClockId(null)
      return false
    }
    setClockRecords(prev => prev.map(item => item.id === record.id ? json.record! : item))
    try {
      const datesToRecompute = Array.from(new Set([record.session_date, json.record.session_date]))
      for (const sessionDate of datesToRecompute) {
        await recomputeSessionTips(sessionDate)
      }
      notifyReportingDataChanged()
    } catch (error) {
      setStatus(getErrorMessage(error, 'Clock record updated, but tip distribution refresh failed'))
      setSavingClockId(null)
      return false
    }
    setClockEdits(prev => {
      const next = { ...prev }
      delete next[record.id]
      return next
    })
    setDetailEditing(false)
    setSavingClockId(null)
    setStatus('Clock record saved successfully.')
    return true
  }

  const recomputeSessionTips = async (sessionDate: string) => {
    const eodRes = await supabase
      .from('eod_reports')
      .select('id, cc_tip, cash_tip')
      .eq('session_date', sessionDate)
      .maybeSingle()

    if (!eodRes.data?.id) return

    const refreshedClockRes = await fetch(`/api/clock-events?session_date=${sessionDate}`, { cache: 'no-store' })
    const refreshedClockJson = (await refreshedClockRes.json().catch(() => ({}))) as { records?: ShiftClock[]; error?: string }
    if (!refreshedClockRes.ok) throw new Error(refreshedClockJson.error ?? 'Failed to reload clock records')

    const refreshedClockRecords = refreshedClockJson.records ?? []
    const grouped = new Map<string, { employee_id: string; hours_worked: number; start_time: string | null; end_time: string | null }>()

    for (const record of refreshedClockRecords) {
      const employee = record.employee ?? employees.find(item => item.id === record.employee_id)
      if (!employee || !isTipEligibleEmployee(employee)) continue

      const existing = grouped.get(record.employee_id) ?? {
        employee_id: record.employee_id,
        hours_worked: 0,
        start_time: null,
        end_time: null,
      }

      existing.hours_worked += getEffectiveClockHours(record)
      const startTime = format(new Date(record.clock_in_at), 'HH:mm:ss')
      const endTime = record.clock_out_at ? format(new Date(record.clock_out_at), 'HH:mm:ss') : null
      existing.start_time = !existing.start_time || startTime < existing.start_time ? startTime : existing.start_time
      existing.end_time = !existing.end_time || (endTime && endTime > existing.end_time) ? endTime : existing.end_time
      grouped.set(record.employee_id, existing)
    }

    const tipRows = [...grouped.values()].filter(row => row.hours_worked > 0)
    const totalTip = Number(eodRes.data.cc_tip ?? 0) + Number(eodRes.data.cash_tip ?? 0)
    const tipResults = calculateTips(totalTip, tipRows.map(row => ({
      employee_id: row.employee_id,
      hours_worked: row.hours_worked,
      tip_pool_hourly_rate: employees.find(employee => employee.id === row.employee_id)?.tip_pool_hourly_rate ?? null,
    })))

    const deleteRes = await supabase.from('tip_distributions').delete().eq('eod_report_id', eodRes.data.id)
    if (deleteRes.error) throw new Error(deleteRes.error.message)

    if (tipRows.length === 0) return

    await insertTipDistributionsWithFallback(
      supabase,
      tipRows.map(row => {
        const result = tipResults.find(item => item.employee_id === row.employee_id)
        return {
          eod_report_id: eodRes.data!.id,
          employee_id: row.employee_id,
          start_time: row.start_time,
          end_time: row.end_time,
          hours_worked: row.hours_worked,
          tip_share: result?.tip_share ?? 0,
          house_deduction: result?.house_deduction ?? 0,
          net_tip: result?.net_tip ?? 0,
        }
      })
    )
  }

  const deleteClockRecord = async () => {
    if (!deleteTarget) return
    setDeletingClockId(deleteTarget.id)
    setStatus(null)

    const res = await fetch('/api/clock-events', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deleteTarget.id }),
    })
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; session_date?: string; error?: string }

    if (!res.ok || !json.success || !json.session_date) {
      setStatus(json.error ?? 'Failed to delete clock record')
      setDeletingClockId(null)
      return
    }

    try {
      await recomputeSessionTips(json.session_date)
      setClockRecords(prev => prev.filter(item => item.id !== deleteTarget.id))
      notifyReportingDataChanged()
      setDeleteTarget(null)
      setSelectedClockId(current => current === deleteTarget.id ? null : current)
      setDetailEditing(false)
      setStatus('Clock record deleted and tip distribution recalculated.')
    } catch (error) {
      setStatus(getErrorMessage(error, 'Clock record deleted, but tip distribution refresh failed'))
    } finally {
      setDeletingClockId(null)
    }
  }

  return (
    <div className="p-6">
      <AdminSubpageHeader
        title="Clock Records"
        subtitle="Modify verified times, review auto clock-outs, and open saved photos."
        backHref="/admin"
        backLabel="Back to Admin Board"
      />
      <DepartmentTabs department={department} onChange={value => { setDepartment(value); setEmployeeFilter('') }} />
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
            <Select
              value={employeeFilter || ALL_STAFF_FILTER}
              onValueChange={(value: string | null) => {
                if (!value) return
                setEmployeeFilter(value === ALL_STAFF_FILTER ? '' : value)
              }}
              disabled={staffFilterEmployees.length === 0}
            >
              <SelectTrigger className="w-44">
                <span>{employeeFilter ? getEmployeeNameById(staffFilterEmployees, employeeFilter) ?? getEmployeeNameById(employees, employeeFilter) ?? 'Unknown Staff' : 'All Staff'}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STAFF_FILTER}>All Staff</SelectItem>
                {staffFilterEmployees.map(employee => (
                  <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
          rightSlot={
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={openAddHourDialog} disabled={filteredEmployees.length === 0}>
                <Plus className="mr-2 h-4 w-4" /> Add Hour
              </Button>
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                Open {filteredClockRecords.filter(record => isClockPending(record)).length}
              </Badge>
            </div>
          }
        />
        {status && <div className="mb-4 rounded-lg border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">{status}</div>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Clock In</TableHead>
              <TableHead className="text-right">Clock Out</TableHead>
              <TableHead className="text-right">Break</TableHead>
              <TableHead className="text-right">Worked Hrs</TableHead>
              <TableHead className="w-36">Note</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredClockRecords.map(record => {
              const employee = getClockRecordEmployee(record, employees)
              const employeeName = employee?.name ?? 'Unknown Staff'
              const missingBreakWarning = shouldWarnMissingMealBreak(record, employee)
              const breakMinutes = getClockBreakMinutes(record)
              const workedHours = record.clock_out_at ? calculateClockHoursAfterBreak(record.clock_in_at, record.clock_out_at, breakMinutes) : 0
              return (
                <TableRow key={record.id}>
                  <TableCell className="font-medium">{format(new Date(`${record.session_date}T12:00:00`), 'MMM d, yyyy')}</TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="font-medium text-slate-900 underline-offset-4 hover:underline"
                      onClick={() => openClockDetail(record)}
                    >
                      {employeeName}
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline" className={record.auto_clock_out ? 'border-orange-300 bg-orange-50 text-orange-800' : record.clock_out_at ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-800'}>
                        {record.auto_clock_out ? 'Auto Clock-Out' : record.clock_out_at ? 'Closed' : 'Open'}
                      </Badge>
                      {missingBreakWarning && (
                        <Badge
                          variant="outline"
                          className="border-amber-300 bg-amber-50 text-amber-800"
                          title={`${employeeName} worked ${getEffectiveClockHours(record).toFixed(2)} hours with no completed 30 minute meal break. Alert threshold: ${getMealBreakThresholdHours(employee).toFixed(2)} hours.`}
                        >
                          <AlertTriangle className="mr-1 h-3 w-3" /> Break Audit
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{format(new Date(record.clock_in_at), 'p')}</TableCell>
                  <TableCell className="text-right">{record.clock_out_at ? format(new Date(record.clock_out_at), 'p') : 'Open'}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatBreakSummary(record)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{workedHours.toFixed(2)}</TableCell>
                  <TableCell>
                    <span className="inline-block max-w-32 truncate text-sm text-muted-foreground">
                      {getVisibleManagerNote(record.manager_note) || '—'}
                    </span>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => openClockDetail(record)}>View</Button>
                      <Button size="sm" variant="outline" onClick={() => openClockDetail(record, true)}>Edit</Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
            {filteredClockRecords.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-6 text-center text-muted-foreground">No clock records for this range</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet
        open={!!selectedClockRecord}
        onOpenChange={open => {
          if (!open) {
            setSelectedClockId(null)
            setDetailEditing(false)
          }
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selectedClockRecord && selectedClockEdit && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedClockEmployee?.name ?? 'Unknown Staff'}</SheetTitle>
                <SheetDescription>
                  {format(new Date(`${selectedClockRecord.session_date}T12:00:00`), 'MMM d, yyyy')} clock record
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="text-xs font-medium uppercase text-muted-foreground">Status</div>
                    <div className="mt-1 font-medium">
                      {selectedClockRecord.auto_clock_out ? 'Auto Clock-Out' : selectedClockRecord.clock_out_at ? 'Closed' : 'Open'}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="text-xs font-medium uppercase text-muted-foreground">Worked Hrs</div>
                    <div className="mt-1 font-medium">
                      {(selectedClockEdit.clockOut
                        ? calculateClockHoursAfterBreak(
                            timeInputToIso(selectedClockEdit.sessionDate, selectedClockEdit.clockIn) ?? selectedClockRecord.clock_in_at,
                            timeInputToIso(selectedClockEdit.sessionDate, selectedClockEdit.clockOut) ?? selectedClockRecord.clock_out_at ?? selectedClockRecord.clock_in_at,
                            getClockBreakMinutes(selectedClockRecord)
                          )
                        : 0).toFixed(2)}
                    </div>
                  </div>
                </div>

                {detailEditing ? (
                  <div className="space-y-4">
                    <div>
                      <Label>Date</Label>
                      <Input
                        type="date"
                        value={selectedClockEdit.sessionDate}
                        onChange={event => setClockEdits(prev => ({ ...prev, [selectedClockRecord.id]: { ...selectedClockEdit, sessionDate: event.target.value } }))}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Clock In</Label>
                        <Input
                          type="time"
                          value={selectedClockEdit.clockIn}
                          onChange={event => setClockEdits(prev => ({ ...prev, [selectedClockRecord.id]: { ...selectedClockEdit, clockIn: event.target.value } }))}
                        />
                      </div>
                      <div>
                        <Label>Clock Out</Label>
                        <Input
                          type="time"
                          value={selectedClockEdit.clockOut}
                          onChange={event => setClockEdits(prev => ({ ...prev, [selectedClockRecord.id]: { ...selectedClockEdit, clockOut: event.target.value } }))}
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Manager Note</Label>
                      <Input
                        value={selectedClockEdit.note}
                        onChange={event => setClockEdits(prev => ({ ...prev, [selectedClockRecord.id]: { ...selectedClockEdit, note: event.target.value } }))}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 text-sm">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs font-medium uppercase text-muted-foreground">Clock In</div>
                        <div className="mt-1">{format(new Date(selectedClockRecord.clock_in_at), 'p')}</div>
                      </div>
                      <div>
                        <div className="text-xs font-medium uppercase text-muted-foreground">Clock Out</div>
                        <div className="mt-1">{selectedClockRecord.clock_out_at ? format(new Date(selectedClockRecord.clock_out_at), 'p') : 'Open'}</div>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium uppercase text-muted-foreground">Break</div>
                      <div className="mt-1">
                        {formatBreakSummary(selectedClockRecord) === '—' ? 'No break recorded' : formatBreakSummary(selectedClockRecord)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium uppercase text-muted-foreground">Note</div>
                      <div className="mt-1">{getVisibleManagerNote(selectedClockRecord.manager_note) || 'No note'}</div>
                    </div>
                  </div>
                )}
              </div>
              <SheetFooter>
                {detailEditing ? (
                  <>
                    <Button onClick={() => void saveClockAdjustment(selectedClockRecord)} disabled={savingClockId === selectedClockRecord.id}>
                      {savingClockId === selectedClockRecord.id ? 'Saving…' : 'Save Changes'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setClockEdits(prev => ({ ...prev, [selectedClockRecord.id]: getClockEditState(selectedClockRecord) }))
                        setDetailEditing(false)
                      }}
                      disabled={savingClockId === selectedClockRecord.id}
                    >
                      Cancel Edit
                    </Button>
                  </>
                ) : (
                  <Button onClick={() => setDetailEditing(true)}>Edit Record</Button>
                )}
                <div className="flex gap-2">
                  {selectedClockRecord.clock_in_photo_path && <Button className="flex-1" variant="outline" onClick={() => window.open(`/api/clock-events/${selectedClockRecord.id}/photo?kind=in`, '_blank', 'noopener,noreferrer')}>In Photo</Button>}
                  {selectedClockRecord.clock_out_photo_path && <Button className="flex-1" variant="outline" onClick={() => window.open(`/api/clock-events/${selectedClockRecord.id}/photo?kind=out`, '_blank', 'noopener,noreferrer')}>Out Photo</Button>}
                </div>
                <Button
                  variant="outline"
                  className="text-red-700 hover:text-red-800"
                  onClick={() => setDeleteTarget(selectedClockRecord)}
                  disabled={savingClockId === selectedClockRecord.id}
                >
                  Delete Record
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={addHourOpen} onOpenChange={setAddHourOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Missing Hours</DialogTitle>
            <DialogDescription>
              Add a missing shift for an employee. Tip distribution will recalculate for this business day.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Employee</Label>
              <Select value={addHourForm.employeeId} onValueChange={(value: string | null) => value && setAddHourForm(prev => ({ ...prev, employeeId: value }))}>
                <SelectTrigger>
                  <span>{getEmployeeNameById(filteredEmployees, addHourForm.employeeId) ?? 'Select employee'}</span>
                </SelectTrigger>
                <SelectContent>
                  {filteredEmployees.map(employee => (
                    <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Date</Label>
                <Input
                  type="date"
                  value={addHourForm.sessionDate}
                  onChange={event => setAddHourForm(prev => ({ ...prev, sessionDate: event.target.value }))}
                />
              </div>
              <div>
                <Label>Clock In</Label>
                <Input
                  type="time"
                  value={addHourForm.clockIn}
                  onChange={event => setAddHourForm(prev => ({ ...prev, clockIn: event.target.value }))}
                />
              </div>
              <div>
                <Label>Clock Out</Label>
                <Input
                  type="time"
                  value={addHourForm.clockOut}
                  onChange={event => setAddHourForm(prev => ({ ...prev, clockOut: event.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>Manager Note</Label>
              <Input
                value={addHourForm.note}
                onChange={event => setAddHourForm(prev => ({ ...prev, note: event.target.value }))}
                placeholder="Missing clock record, corrected schedule, etc."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddHourOpen(false)} disabled={addingHour}>Cancel</Button>
            <Button onClick={saveAddedHour} disabled={addingHour || !addHourForm.employeeId || !addHourForm.sessionDate || !addHourForm.clockIn || !addHourForm.clockOut}>
              {addingHour ? 'Adding…' : 'Add Hour'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Clock Record</DialogTitle>
            <DialogDescription>
              This will remove the selected clock record and recalculate tip distribution for that business day if an EOD report exists.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {deleteTarget
              ? `${getClockRecordEmployeeName(deleteTarget, employees)} • ${format(new Date(`${deleteTarget.session_date}T12:00:00`), 'MMM d, yyyy')} • ${format(new Date(deleteTarget.clock_in_at), 'p')}`
              : 'Delete this clock record?'}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deletingClockId !== null}>Cancel</Button>
            <Button variant="destructive" onClick={deleteClockRecord} disabled={deletingClockId !== null}>
              {deletingClockId ? 'Deleting…' : 'Delete Record'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
