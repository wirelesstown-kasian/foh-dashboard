'use client'

import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { DepartmentTabs } from '@/components/reporting/DepartmentTabs'
import { ReportingNav } from '@/components/reporting/ReportingNav'
import { ReportingToolbar } from '@/components/reporting/ReportingToolbar'
import { useClockRecords, useEmployees } from '@/components/reporting/useReportingData'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ReportDepartment, ReportPeriod, getReportRange, isEmployeeInDepartment } from '@/lib/reporting'
import { calculateClockHours, isClockPending } from '@/lib/clockUtils'
import { ShiftClock } from '@/lib/types'

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
    setEditingClockId(null)
    setSavingClockId(null)
    setStatus('Clock record updated.')
  }

  return (
    <div className="p-6">
      <AdminSubpageHeader
        title="Clock Records"
        subtitle="Modify verified times, review auto clock-outs, and open saved photos."
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
              <TableHead>Note</TableHead>
              <TableHead className="text-right">Action</TableHead>
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
                    {isEditing ? <Input value={currentEdit.note} onChange={event => setClockEdits(prev => ({ ...prev, [record.id]: { ...currentEdit, note: event.target.value } }))} className="h-8 min-w-40" /> : <span className="text-sm text-muted-foreground">{record.manager_note ?? '—'}</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    {isEditing ? (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditingClockId(null)} disabled={savingClockId === record.id}>Cancel</Button>
                        <Button size="sm" variant="outline" onClick={() => saveClockAdjustment(record)} disabled={savingClockId === record.id}>{savingClockId === record.id ? 'Saving…' : 'Save'}</Button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-2">
                        {record.clock_in_photo_path && <Button size="sm" variant="outline" onClick={() => window.open(`/api/clock-events/${record.id}/photo?kind=in`, '_blank', 'noopener,noreferrer')}>In Photo</Button>}
                        {record.clock_out_photo_path && <Button size="sm" variant="outline" onClick={() => window.open(`/api/clock-events/${record.id}/photo?kind=out`, '_blank', 'noopener,noreferrer')}>Out Photo</Button>}
                        <Button size="sm" variant="outline" onClick={() => { setClockEdits(prev => ({ ...prev, [record.id]: { clockIn: isoToTimeInput(record.clock_in_at), clockOut: isoToTimeInput(record.clock_out_at), note: record.manager_note ?? '' } })); setEditingClockId(record.id) }}>Edit Times</Button>
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
    </div>
  )
}
