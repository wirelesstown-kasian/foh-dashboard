'use client'

import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { DepartmentTabs } from '@/components/reporting/DepartmentTabs'
import { ReportingToolbar } from '@/components/reporting/ReportingToolbar'
import { notifyReportingDataChanged, useClockRecords, useEmployees } from '@/components/reporting/useReportingData'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ReportDepartment, ReportPeriod, getReportRange, isEmployeeInDepartment } from '@/lib/reporting'
import { calculateClockHours, getEffectiveClockHours, isClockPending } from '@/lib/clockUtils'
import { ShiftClock } from '@/lib/types'
import { calculateTips } from '@/lib/tipCalc'
import { supabase } from '@/lib/supabase'
import { insertTipDistributionsWithFallback } from '@/lib/tipDistributionWrite'

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

export default function ClockRecordsPage() {
  const employees = useEmployees()
  const { clockRecords, setClockRecords } = useClockRecords()

  const [department, setDepartment] = useState<ReportDepartment>('foh')
  const [period, setPeriod] = useState<ReportPeriod>('daily')
  const [refDate, setRefDate] = useState(new Date())
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [employeeFilter, setEmployeeFilter] = useState('all')
  const [editingClockId, setEditingClockId] = useState<string | null>(null)
  const [clockEdits, setClockEdits] = useState<Record<string, { clockIn: string; clockOut: string; note: string }>>({})
  const [savingClockId, setSavingClockId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ShiftClock | null>(null)
  const [deletingClockId, setDeletingClockId] = useState<string | null>(null)

  const [startDate, endDate] = useMemo(
    () => getReportRange(period, refDate, customStart, customEnd),
    [period, refDate, customStart, customEnd]
  )
  const filteredEmployees = useMemo(
    () => employees.filter(employee => isEmployeeInDepartment(employee, department)),
    [employees, department]
  )
  const filteredClockRecords = useMemo(
    () =>
      clockRecords
        .filter(record => record.session_date >= startDate && record.session_date <= endDate)
        .filter(record => {
          const employee = record.employee ?? employees.find(item => item.id === record.employee_id)
          if (!employee || !isEmployeeInDepartment(employee, department)) return false
          return employeeFilter === 'all' || employee.id === employeeFilter
        })
        .sort((a, b) => b.clock_in_at.localeCompare(a.clock_in_at)),
    [clockRecords, department, employeeFilter, employees, endDate, startDate]
  )

  const saveClockAdjustment = async (record: ShiftClock) => {
    const currentEdit = clockEdits[record.id]
    if (!currentEdit) return
    setSavingClockId(record.id)
    setStatus(null)
    const res = await fetch('/api/clock-events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: record.id,
        action: 'adjust',
        clock_in_at: timeInputToIso(record.session_date, currentEdit.clockIn),
        clock_out_at: timeInputToIso(record.session_date, currentEdit.clockOut),
        manager_note: currentEdit.note,
      }),
    })
    const json = (await res.json().catch(() => ({}))) as { record?: ShiftClock; error?: string }
    if (!res.ok || !json.record) {
      setStatus(json.error ?? 'Failed to save clock change')
      setSavingClockId(null)
      return
    }
    setClockRecords(prev => prev.map(item => item.id === record.id ? json.record! : item))
    try {
      await recomputeSessionTips(record.session_date)
      notifyReportingDataChanged()
    } catch (error) {
      setStatus(getErrorMessage(error, 'Clock record updated, but tip distribution refresh failed'))
      setSavingClockId(null)
      return
    }
    setClockEdits(prev => {
      const next = { ...prev }
      delete next[record.id]
      return next
    })
    setEditingClockId(null)
    setSavingClockId(null)
    setStatus('Clock record saved successfully.')
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
      const isTipEligible = employee?.role === 'manager' || employee?.role === 'server' || employee?.role === 'busser' || employee?.role === 'runner'
      if (!employee || !isTipEligible) continue

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
        backHref="/reporting"
        backLabel="Back to Reporting"
      />
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
          rightSlot={
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
              Open {filteredClockRecords.filter(record => isClockPending(record)).length}
            </Badge>
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
              <TableHead className="text-right">Worked Hrs</TableHead>
              <TableHead className="w-36">Note</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredClockRecords.map(record => {
              const employee = record.employee ?? employees.find(item => item.id === record.employee_id)
              const currentEdit = clockEdits[record.id] ?? {
                clockIn: isoToTimeInput(record.clock_in_at),
                clockOut: isoToTimeInput(record.clock_out_at),
                note: record.manager_note ?? '',
              }
              const isEditing = editingClockId === record.id
              const previewIn = timeInputToIso(record.session_date, currentEdit.clockIn)
              const previewOut = currentEdit.clockOut ? timeInputToIso(record.session_date, currentEdit.clockOut) : null
              const workedHours = previewIn && previewOut ? calculateClockHours(previewIn, previewOut) : 0
              return (
                <TableRow key={record.id}>
                  <TableCell className="font-medium">{format(new Date(`${record.session_date}T12:00:00`), 'MMM d, yyyy')}</TableCell>
                  <TableCell>{employee?.name ?? 'Unknown Staff'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={record.auto_clock_out ? 'border-orange-300 bg-orange-50 text-orange-800' : record.clock_out_at ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-800'}>
                      {record.auto_clock_out ? 'Auto Clock-Out' : record.clock_out_at ? 'Closed' : 'Open'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {isEditing ? <Input type="time" value={currentEdit.clockIn} onChange={event => setClockEdits(prev => ({ ...prev, [record.id]: { ...currentEdit, clockIn: event.target.value } }))} className="ml-auto h-8 w-28 text-right" /> : format(new Date(record.clock_in_at), 'p')}
                  </TableCell>
                  <TableCell className="text-right">
                    {isEditing ? <Input type="time" value={currentEdit.clockOut} onChange={event => setClockEdits(prev => ({ ...prev, [record.id]: { ...currentEdit, clockOut: event.target.value } }))} className="ml-auto h-8 w-28 text-right" /> : record.clock_out_at ? format(new Date(record.clock_out_at), 'p') : 'Open'}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{workedHours.toFixed(2)}</TableCell>
                  <TableCell>
                    {isEditing ? (
                      <Input
                        value={currentEdit.note}
                        onChange={event => setClockEdits(prev => ({ ...prev, [record.id]: { ...currentEdit, note: event.target.value } }))}
                        className="h-8 w-32"
                      />
                    ) : (
                      <span className="inline-block max-w-32 truncate text-sm text-muted-foreground">
                        {record.manager_note ?? '—'}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    {isEditing ? (
                      <div className="flex items-start gap-3">
                        <div className="flex gap-2">
                          {record.clock_in_photo_path && <Button size="sm" variant="outline" onClick={() => window.open(`/api/clock-events/${record.id}/photo?kind=in`, '_blank', 'noopener,noreferrer')}>In Photo</Button>}
                          {record.clock_out_photo_path && <Button size="sm" variant="outline" onClick={() => window.open(`/api/clock-events/${record.id}/photo?kind=out`, '_blank', 'noopener,noreferrer')}>Out Photo</Button>}
                        </div>
                        <div className="flex flex-col gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => saveClockAdjustment(record)}
                            disabled={savingClockId === record.id}
                          >
                            {savingClockId === record.id ? 'Saving…' : 'Save'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-700 hover:text-red-800"
                            onClick={() => setDeleteTarget(record)}
                            disabled={savingClockId === record.id}
                          >
                            Delete
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setClockEdits(prev => {
                                const next = { ...prev }
                                delete next[record.id]
                                return next
                              })
                              setEditingClockId(null)
                              setStatus('Edit canceled.')
                            }}
                            disabled={savingClockId === record.id}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3">
                        <div className="flex gap-2">
                          {record.clock_in_photo_path && <Button size="sm" variant="outline" onClick={() => window.open(`/api/clock-events/${record.id}/photo?kind=in`, '_blank', 'noopener,noreferrer')}>In Photo</Button>}
                          {record.clock_out_photo_path && <Button size="sm" variant="outline" onClick={() => window.open(`/api/clock-events/${record.id}/photo?kind=out`, '_blank', 'noopener,noreferrer')}>Out Photo</Button>}
                        </div>
                        <div className="flex flex-col gap-2">
                          <Button size="sm" variant="outline" onClick={() => { setClockEdits(prev => ({ ...prev, [record.id]: { clockIn: isoToTimeInput(record.clock_in_at), clockOut: isoToTimeInput(record.clock_out_at), note: record.manager_note ?? '' } })); setEditingClockId(record.id) }}>Edit Times</Button>
                        </div>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
            {filteredClockRecords.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">No clock records for this range</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

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
              ? `${deleteTarget.employee?.name ?? employees.find(item => item.id === deleteTarget.employee_id)?.name ?? 'This employee'} • ${format(new Date(`${deleteTarget.session_date}T12:00:00`), 'MMM d, yyyy')} • ${format(new Date(deleteTarget.clock_in_at), 'p')}`
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
