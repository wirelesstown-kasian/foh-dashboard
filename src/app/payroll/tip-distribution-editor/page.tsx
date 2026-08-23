'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { addDays, format, parseISO } from 'date-fns'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { notifyReportingDataChanged, useClockRecords, useEmployees, useEodReports } from '@/components/reporting/useReportingData'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { supabase } from '@/lib/supabase'
import { getClockWorkDepartment, getEffectiveClockHours } from '@/lib/clockUtils'
import { formatCurrency } from '@/lib/reporting'
import { calculateTips } from '@/lib/tipCalc'
import { getEmployeeScheduleDepartments } from '@/lib/employeeSelect'
import { isTipEligibleDepartment, isTipEligibleEmployee, isTipEligibleForWork } from '@/lib/tipEligibility'
import { Employee } from '@/lib/types'
import { ArrowLeft, Plus, Save } from 'lucide-react'

type EditorRow = {
  employee_id: string
  name: string
  hours_worked: number
  start_time: string | null
  end_time: string | null
  adjustment: number
  memo: string
}

function todayKey() {
  return format(new Date(), 'yyyy-MM-dd')
}

function shiftDateKey(date: string, days: number) {
  return format(addDays(parseISO(date), days), 'yyyy-MM-dd')
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function timeValue(iso: string | null) {
  if (!iso) return null
  return format(new Date(iso), 'HH:mm:ss')
}

function buildClockRows(date: string, employees: Employee[], clockRecords: ReturnType<typeof useClockRecords>['clockRecords']) {
  const employeeById = new Map(employees.map(employee => [employee.id, employee]))
  const grouped = new Map<string, EditorRow>()

  for (const record of clockRecords) {
    if (record.session_date !== date) continue
    const employee = employeeById.get(record.employee_id)
    if (!employee || !isTipEligibleForWork(employee, getClockWorkDepartment(record, employee))) continue

    const hours = getEffectiveClockHours(record)
    if (hours <= 0) continue
    const existing = grouped.get(record.employee_id) ?? {
      employee_id: record.employee_id,
      name: employee.name,
      hours_worked: 0,
      start_time: null,
      end_time: null,
      adjustment: 0,
      memo: '',
    }

    existing.hours_worked = roundMoney(existing.hours_worked + hours)
    const startTime = timeValue(record.clock_in_at)
    const endTime = timeValue(record.clock_out_at)
    existing.start_time = !existing.start_time || (startTime && startTime < existing.start_time) ? startTime : existing.start_time
    existing.end_time = !existing.end_time || (endTime && endTime > existing.end_time) ? endTime : existing.end_time
    grouped.set(record.employee_id, existing)
  }

  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function rebalanceTips(totalTip: number, rows: EditorRow[]) {
  const baseResults = calculateTips(totalTip, rows.map(row => ({
    employee_id: row.employee_id,
    hours_worked: row.hours_worked,
  })))
  const baseById = new Map(baseResults.map(result => [result.employee_id, result]))
  const distributable = roundMoney(totalTip * 0.85)
  const adjusted = rows.map(row => ({
    ...row,
    base_tip: roundMoney(baseById.get(row.employee_id)?.net_tip ?? 0),
    net_tip: roundMoney((baseById.get(row.employee_id)?.net_tip ?? 0) + row.adjustment),
    house_deduction: roundMoney(baseById.get(row.employee_id)?.house_deduction ?? 0),
  }))
  const adjustedTotal = roundMoney(adjusted.reduce((sum, row) => sum + row.net_tip, 0))
  const difference = roundMoney(adjustedTotal - distributable)
  const balancingRows = adjusted.filter(row => row.adjustment === 0 && row.net_tip > 0)
  const fallbackRows = balancingRows.length > 0 ? balancingRows : adjusted.filter(row => row.net_tip > 0)
  const balancingTotal = fallbackRows.reduce((sum, row) => sum + row.net_tip, 0)

  if (difference !== 0 && balancingTotal > 0) {
    let applied = 0
    fallbackRows.forEach((row, index) => {
      const share = index === fallbackRows.length - 1
        ? roundMoney(difference - applied)
        : roundMoney(difference * (row.net_tip / balancingTotal))
      row.net_tip = roundMoney(Math.max(0, row.net_tip - share))
      applied = roundMoney(applied + share)
    })
  }

  const finalTotal = roundMoney(adjusted.reduce((sum, row) => sum + row.net_tip, 0))
  const correction = roundMoney(distributable - finalTotal)
  const correctionRow = adjusted.find(row => row.net_tip > 0)
  if (correctionRow && correction !== 0) correctionRow.net_tip = roundMoney(correctionRow.net_tip + correction)

  return adjusted.map(row => ({
    ...row,
    tip_share: distributable > 0 ? Math.round((row.net_tip / distributable) * 10000) / 10000 : 0,
  }))
}

export default function TipDistributionEditorPage() {
  const employees = useEmployees({ includeArchived: true })
  const { clockRecords } = useClockRecords()
  const { eodReports, setEodReports } = useEodReports()
  const [selectedDate, setSelectedDate] = useState(todayKey())
  const [totalTipInput, setTotalTipInput] = useState('')
  const [rows, setRows] = useState<EditorRow[] | null>(null)
  const [employeeToAdd, setEmployeeToAdd] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const report = eodReports.find(item => item.session_date === selectedDate) ?? null
  const totalTip = totalTipInput === '' ? Number(report?.tip_total ?? 0) : Number(totalTipInput)
  const clockRows = useMemo(() => buildClockRows(selectedDate, employees, clockRecords), [clockRecords, employees, selectedDate])
  const savedRows = useMemo(() => (report
    ? (report.tip_distributions ?? []).map(distribution => {
      const employee = employees.find(item => item.id === distribution.employee_id)
      const clockRow = clockRows.find(item => item.employee_id === distribution.employee_id)
      return {
        employee_id: distribution.employee_id,
        name: distribution.employee?.name ?? employee?.name ?? 'Unknown employee',
        hours_worked: Number(distribution.hours_worked ?? 0),
        start_time: distribution.start_time ?? clockRow?.start_time ?? null,
        end_time: distribution.end_time ?? clockRow?.end_time ?? null,
        adjustment: 0,
        memo: '',
      }
    })
    : []), [clockRows, employees, report])
  const currentRows = useMemo(() => rows ?? savedRows, [rows, savedRows])
  const calculatedRows = useMemo(() => rebalanceTips(Number.isFinite(totalTip) ? totalTip : 0, currentRows), [currentRows, totalTip])
  const distributedTotal = roundMoney(calculatedRows.reduce((sum, row) => sum + row.net_tip, 0))
  const houseTotal = roundMoney((Number.isFinite(totalTip) ? totalTip : 0) * 0.15)
  const ruleTotal = roundMoney(distributedTotal + houseTotal)
  const eligibleEmployees = employees.filter(employee => (
    (
      isTipEligibleEmployee(employee) ||
      getEmployeeScheduleDepartments(employee).some(department => isTipEligibleDepartment(department))
    ) &&
    !currentRows.some(row => row.employee_id === employee.id)
  ))
  const hasAdjustmentWithoutMemo = currentRows.some(row => row.adjustment !== 0 && row.memo.trim().length === 0)

  const loadClockRows = () => {
    setRows(clockRows)
    setTotalTipInput(report ? String(Number(report.tip_total ?? 0)) : '')
    setMessage(null)
  }

  const selectDate = (date: string) => {
    setSelectedDate(date)
    setRows(null)
    setTotalTipInput('')
    setMessage(null)
  }

  const updateRow = (employeeId: string, patch: Partial<EditorRow>) => {
    setRows(current => (current ?? currentRows).map(row => (
      row.employee_id === employeeId ? { ...row, ...patch } : row
    )))
  }

  const addEmployee = () => {
    const employee = employees.find(item => item.id === employeeToAdd)
    if (!employee) return
    const clockRow = clockRows.find(row => row.employee_id === employee.id)
    setRows(current => [...(current ?? currentRows), {
      employee_id: employee.id,
      name: employee.name,
      hours_worked: clockRow?.hours_worked ?? 0,
      start_time: clockRow?.start_time ?? null,
      end_time: clockRow?.end_time ?? null,
      adjustment: 0,
      memo: '',
    }].sort((a, b) => a.name.localeCompare(b.name)))
    setEmployeeToAdd('')
  }

  const save = async () => {
    if (!report) {
      setMessage('Create the EOD report first, then edit tip distribution.')
      return
    }
    if (hasAdjustmentWithoutMemo) {
      setMessage('Memo is required for every add/deduct tip adjustment.')
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const safeTotalTip = roundMoney(Number.isFinite(totalTip) ? totalTip : 0)
      const cashTip = Math.min(Number(report.cash_tip ?? 0), safeTotalTip)
      const ccTip = roundMoney(safeTotalTip - cashTip)
      const tipDelta = roundMoney(safeTotalTip - Number(report.tip_total ?? 0))
      const adjustmentMemo = currentRows
        .filter(row => row.adjustment !== 0)
        .map(row => `${row.name}: ${row.adjustment > 0 ? '+' : ''}${formatCurrency(row.adjustment)} - ${row.memo.trim()}`)
        .join('; ')
      const nextMemo = adjustmentMemo
        ? `${report.memo ? `${report.memo}\n` : ''}[Tip Distribution Editor ${new Date().toLocaleString()}] ${adjustmentMemo}`
        : report.memo

      const reportUpdate = await supabase
        .from('eod_reports')
        .update({
          cc_tip: ccTip,
          cash_tip: cashTip,
          tip_total: safeTotalTip,
          revenue_total: roundMoney(Number(report.revenue_total ?? 0) + tipDelta),
          batch_total: roundMoney(Number(report.batch_total ?? 0) + tipDelta),
          cash_deposit: roundMoney(Number(report.cash_total ?? 0) + cashTip),
          memo: nextMemo,
          updated_at: new Date().toISOString(),
        })
        .eq('id', report.id)
      if (reportUpdate.error) throw reportUpdate.error

      const deleteRows = await supabase.from('tip_distributions').delete().eq('eod_report_id', report.id)
      if (deleteRows.error) throw deleteRows.error
      if (calculatedRows.length > 0) {
        const insertRows = await supabase.from('tip_distributions').insert(calculatedRows.map(row => ({
          eod_report_id: report.id,
          employee_id: row.employee_id,
          start_time: row.start_time,
          end_time: row.end_time,
          hours_worked: row.hours_worked,
          tip_share: row.tip_share,
          house_deduction: row.house_deduction,
          net_tip: row.net_tip,
        })))
        if (insertRows.error) throw insertRows.error
      }

      notifyReportingDataChanged()
      const refreshed = await supabase
        .from('eod_reports')
        .select('*, tip_distributions(*, employee:employees(*))')
        .order('session_date', { ascending: false })
      if (!refreshed.error) setEodReports(refreshed.data ?? [])
      setRows(null)
      setTotalTipInput('')
      setMessage('Tip distribution saved. Wage Report and Wage Worksheet will use the updated distribution.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save tip distribution.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6">
      <AdminSubpageHeader
        title="Tip Distribution Editor"
        subtitle="Correct daily tip distribution while keeping payroll reports aligned."
        backHref="/admin"
        backLabel="Back to Admin Board"
      />

      <div className="grid gap-4">
        <div className="rounded-lg border bg-white p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-44">
              <Label>Date</Label>
              <Input type="date" value={selectedDate} onChange={event => selectDate(event.target.value)} />
            </div>
            <Button variant="outline" onClick={() => selectDate(shiftDateKey(selectedDate, -1))}>Day Before</Button>
            <Button variant="outline" onClick={() => selectDate(shiftDateKey(todayKey(), -1))}>Yesterday</Button>
            <Button variant="outline" onClick={() => selectDate(shiftDateKey(selectedDate, 1))}>Day After</Button>
            <div className="min-w-52">
              <Label>Total Collected Tip</Label>
              <Input type="number" step="0.01" value={totalTipInput === '' ? Number(report?.tip_total ?? 0) : totalTipInput} onChange={event => setTotalTipInput(event.target.value)} />
            </div>
            <Button variant="outline" onClick={loadClockRows} disabled={!report}>Reload From Clock Records</Button>
            {!report && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                No EOD report exists for this date.
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-2 rounded-lg border bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <div className="text-[10px] font-medium uppercase text-muted-foreground">Clocked Staff</div>
            <div className="text-lg font-bold text-slate-950">{clockRows.length}</div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase text-muted-foreground">Total Hours</div>
            <div className="text-lg font-bold text-slate-950">{currentRows.reduce((sum, row) => sum + row.hours_worked, 0).toFixed(2)}</div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase text-muted-foreground">House 15%</div>
            <div className="text-lg font-bold text-slate-950">{formatCurrency(houseTotal)}</div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase text-muted-foreground">Distributed</div>
            <div className="text-lg font-bold text-slate-950">{formatCurrency(distributedTotal)}</div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase text-muted-foreground">Total Check</div>
            <div className="text-lg font-bold text-slate-950">{formatCurrency(ruleTotal)}</div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-white p-3">
            <div className="min-w-64">
              <Label>Add Employee</Label>
              <Select value={employeeToAdd || undefined} onValueChange={(value: string | null) => value && setEmployeeToAdd(value)}>
                <SelectTrigger><span>{employees.find(employee => employee.id === employeeToAdd)?.name ?? 'Select employee'}</span></SelectTrigger>
                <SelectContent>
                  {eligibleEmployees.map(employee => (
                    <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={addEmployee} disabled={!employeeToAdd}><Plus className="size-4" /> Add</Button>
            <div className="ml-auto text-xs text-muted-foreground">
              Hours are locked here. Edit hours in <Link className="font-medium text-violet-700 hover:underline" href="/reporting/clock-records">Clock Records</Link>.
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border bg-white">
            <Table className="min-w-[980px] table-fixed text-xs">
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="w-44">Employee</TableHead>
                  <TableHead className="w-24 text-right">Hours</TableHead>
                  <TableHead className="w-28 text-right">Base Tip</TableHead>
                  <TableHead className="w-28 text-right">Add/Deduct</TableHead>
                  <TableHead className="w-64">Memo</TableHead>
                  <TableHead className="w-28 text-right">Net Tip</TableHead>
                  <TableHead className="w-28 text-right">House</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calculatedRows.map(row => (
                  <TableRow key={row.employee_id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right">
                      {row.hours_worked.toFixed(2)}
                      {row.hours_worked <= 0 && <div className="text-[10px] text-red-600">Clock Records required</div>}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(row.base_tip)}</TableCell>
                    <TableCell>
                      <Input className="h-8 text-right" type="number" step="0.01" value={row.adjustment} onChange={event => updateRow(row.employee_id, { adjustment: roundMoney(Number(event.target.value) || 0) })} />
                    </TableCell>
                    <TableCell>
                      <Input className="h-8" value={row.memo} onChange={event => updateRow(row.employee_id, { memo: event.target.value })} placeholder={row.adjustment !== 0 ? 'Required' : 'Optional'} />
                    </TableCell>
                    <TableCell className="text-right font-semibold">{formatCurrency(row.net_tip)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(row.house_deduction)}</TableCell>
                    <TableCell>{row.adjustment !== 0 ? <Badge variant="outline">Adjusted</Badge> : <Badge variant="outline">Base</Badge>}</TableCell>
                  </TableRow>
                ))}
                {calculatedRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No tip rows for this date.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {message && <div className="rounded-lg border bg-slate-50 p-3 text-sm text-slate-700">{message}</div>}
          <div className="flex justify-between">
            <Link className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-slate-50" href="/admin"><ArrowLeft className="size-4" /> Admin Board</Link>
            <Button onClick={save} disabled={saving || !report || hasAdjustmentWithoutMemo || Math.abs(ruleTotal - (Number.isFinite(totalTip) ? totalTip : 0)) > 0.02}>
              <Save className="size-4" /> {saving ? 'Saving...' : 'Save Distribution'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
