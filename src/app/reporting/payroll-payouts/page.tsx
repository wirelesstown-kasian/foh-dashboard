'use client'

import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { ReportingNav } from '@/components/reporting/ReportingNav'
import { notifyReportingDataChanged, useClockRecords, useEmployees, usePayrollRuns, useSchedulesByRange } from '@/components/reporting/useReportingData'
import { useAppSettings } from '@/components/useAppSettings'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { clockMatchesWorkDepartment, getClockBreakMinutes, getEffectiveClockHours, getMealBreakState, getUnpaidBreakState } from '@/lib/clockUtils'
import { getEmployeeScheduleDepartments } from '@/lib/employeeSelect'
import { calculatePayrollAmounts, getPayrollTotals, normalizeMoney, paymentMethodLabel } from '@/lib/payroll'
import { formatCurrency } from '@/lib/reporting'
import type { Employee, PaymentMethod, PayrollRun, PayrollRunItem, ShiftClock } from '@/lib/types'

type SavedPayrollRun = PayrollRun & { payroll_run_items?: PayrollRunItem[] }
type SummaryView = 'department' | 'individual'

function formatTime(value: string | null | undefined) {
  return value ? format(new Date(value), 'h:mm a') : ''
}

function getClockRecordEmployee(record: ShiftClock, employees: Employee[]) {
  const relatedEmployee = record.employee as Employee | Employee[] | undefined
  if (Array.isArray(relatedEmployee)) return relatedEmployee[0] ?? employees.find(employee => employee.id === record.employee_id) ?? null
  return relatedEmployee ?? employees.find(employee => employee.id === record.employee_id) ?? null
}

function getEmployeeClockRecords({
  employeeId,
  clockRecords,
  employees,
  department,
  startDate,
  endDate,
  schedules,
}: {
  employeeId: string
  clockRecords: ShiftClock[]
  employees: Employee[]
  department: string
  startDate: string
  endDate: string
  schedules: ReturnType<typeof useSchedulesByRange>
}) {
  return clockRecords
    .filter(record => {
      if (record.employee_id !== employeeId || record.session_date < startDate || record.session_date > endDate) return false
      if (department === 'all') return true
      const employee = getClockRecordEmployee(record, employees)
      return clockMatchesWorkDepartment(record, department, employee, schedules) ||
        (employee ? getEmployeeScheduleDepartments(employee).includes(department) : false)
    })
    .sort((left, right) => left.session_date.localeCompare(right.session_date) || left.clock_in_at.localeCompare(right.clock_in_at))
}

function buildSavedPayrollSummary(run: SavedPayrollRun) {
  const items = run.payroll_run_items ?? []
  return {
    employeeCount: items.filter(item => Number(item.hours ?? 0) > 0 || Number(item.payout_amount ?? 0) > 0).length,
    hours: items.reduce((sum, item) => sum + Number(item.hours ?? 0), 0),
    tips: items.reduce((sum, item) => sum + Number(item.tips ?? 0), 0),
    baseWages: items.reduce((sum, item) => sum + Number(item.base_wages ?? 0), 0),
    topUp: items.reduce((sum, item) => sum + Number(item.guarantee_top_up ?? 0), 0),
    commission: items.reduce((sum, item) => sum + Number(item.commission ?? 0), 0),
    deductions: items.reduce((sum, item) => sum + Number(item.deductions ?? 0), 0),
    net: Number(run.total_net ?? 0),
    cash: Number(run.total_cash ?? 0),
    check: Number(run.total_check ?? 0),
    ach: Number(run.total_ach ?? 0),
  }
}

function calculateSavedPayrollItem(item: PayrollRunItem, patch: Partial<PayrollRunItem>) {
  const paymentMethod = patch.payment_method ?? item.payment_method
  const updated = {
    ...item,
    ...patch,
    payment_method: paymentMethod,
    base_wages: normalizeMoney(item.base_wages),
    guarantee_top_up: normalizeMoney(item.guarantee_top_up),
    tips: normalizeMoney(item.tips),
    commission: normalizeMoney(patch.commission ?? item.commission),
    deductions: normalizeMoney(patch.deductions ?? item.deductions),
  }
  return { ...updated, ...calculatePayrollAmounts({
    hours: Number(updated.hours ?? 0),
    tips: updated.tips,
    base_wages: updated.base_wages,
    guarantee_top_up: updated.guarantee_top_up,
    commission: updated.commission,
    deductions: updated.deductions,
    payment_method: updated.payment_method ?? '',
  }) }
}

function calculateDailyPayout(row: Pick<PayrollRunItem, 'hours' | 'payout_amount'>, hours: number) {
  if (Number(row.hours ?? 0) <= 0) return 0
  return normalizeMoney(Number(row.payout_amount ?? 0) * (hours / Number(row.hours ?? 0)))
}

function escapePrintValue(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function printSavedPayroll(run: SavedPayrollRun, items: PayrollRunItem[], clockRecords: ShiftClock[], employees: Employee[], schedules: ReturnType<typeof useSchedulesByRange>) {
  const printWindow = window.open('', '_blank', 'width=1200,height=800')
  if (!printWindow) return
  const summary = buildSavedPayrollSummary({ ...run, payroll_run_items: items })
  const employeePages = items.map(item => {
    const records = item.employee_id ? getEmployeeClockRecords({ employeeId: item.employee_id, clockRecords, employees, department: run.department, startDate: run.start_date, endDate: run.end_date, schedules }) : []
    return {
      item,
      records,
      totalBreakMinutes: records.reduce((sum, record) => sum + getClockBreakMinutes(record), 0),
      totalHours: records.reduce((sum, record) => sum + getEffectiveClockHours(record), 0),
    }
  })

  printWindow.document.write(`
    <html><head><title>Saved Payroll Summary</title><style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #111827; }
      h1, h2 { margin: 0 0 4px; } .muted { color: #64748b; font-size: 12px; }
      .cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 18px 0; }
      .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; }
      .metric { font-size: 22px; font-weight: 800; margin-top: 4px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; } th, td { border: 1px solid #cbd5e1; padding: 7px; text-align: left; }
      th, .totals-row td { background: #f1f5f9; font-weight: 800; } .right { text-align: right; }
      .page { break-after: page; page-break-after: always; } .page:last-child { break-after: auto; page-break-after: auto; }
      .employee-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 14px; }
    </style></head><body>
      <section class="page">
        <h1>Saved Payroll Summary</h1>
        <div class="muted">${escapePrintValue(run.department.toUpperCase())} | ${run.start_date} - ${run.end_date} | Pay date ${run.pay_date}</div>
        <div class="cards">
          <div class="card"><div class="muted">Staff</div><div class="metric">${summary.employeeCount}</div></div>
          <div class="card"><div class="muted">Hours</div><div class="metric">${summary.hours.toFixed(2)}</div></div>
          <div class="card"><div class="muted">Cash</div><div class="metric">${formatCurrency(summary.cash)}</div></div>
          <div class="card"><div class="muted">Check</div><div class="metric">${formatCurrency(summary.check)}</div></div>
          <div class="card"><div class="muted">ACH</div><div class="metric">${formatCurrency(summary.ach)}</div></div>
          <div class="card"><div class="muted">Tips</div><div class="metric">${formatCurrency(summary.tips)}</div></div>
          <div class="card"><div class="muted">Base Wages</div><div class="metric">${formatCurrency(summary.baseWages)}</div></div>
          <div class="card"><div class="muted">Top-Up</div><div class="metric">${formatCurrency(summary.topUp)}</div></div>
          <div class="card"><div class="muted">Deductions</div><div class="metric">${formatCurrency(summary.deductions)}</div></div>
          <div class="card"><div class="muted">Total</div><div class="metric">${formatCurrency(summary.net)}</div></div>
        </div>
        <table><thead><tr><th>Paid By</th><th>Name</th><th class="right">Hours</th><th class="right">Tips</th><th class="right">Commission</th><th class="right">Deductions</th><th class="right">Payout</th><th>Memo</th></tr></thead><tbody>
          ${items.map(item => `<tr><td>${paymentMethodLabel(item.payment_method)}</td><td>${escapePrintValue(item.employee_name)}</td><td class="right">${Number(item.hours ?? 0).toFixed(2)}</td><td class="right">${formatCurrency(Number(item.tips ?? 0))}</td><td class="right">${formatCurrency(Number(item.commission ?? 0))}</td><td class="right">${formatCurrency(Number(item.deductions ?? 0))}</td><td class="right">${formatCurrency(Number(item.payout_amount ?? 0))}</td><td>${escapePrintValue(item.memo ?? '')}</td></tr>`).join('')}
        </tbody></table>
      </section>
      ${employeePages.map(page => `<section class="page"><div class="employee-header"><div><h2>${escapePrintValue(page.item.employee_name)}</h2><div class="muted">${run.start_date} - ${run.end_date} | Paid by ${paymentMethodLabel(page.item.payment_method)}</div></div><div class="right"><div class="muted">Total Payout</div><div class="metric">${formatCurrency(Number(page.item.payout_amount ?? 0))}</div></div></div><table><thead><tr><th>Date</th><th>Clock In</th><th>Clock Out</th><th>Meal Break</th><th>Regular Break</th><th class="right">Unpaid Minutes</th><th class="right">Worked Hours</th><th class="right">Daily Payout</th></tr></thead><tbody>${page.records.map(record => {
        const mealBreak = getMealBreakState(record)
        const regularBreak = getUnpaidBreakState(record)
        const hours = getEffectiveClockHours(record)
        return `<tr><td>${record.session_date}</td><td>${formatTime(record.clock_in_at)}</td><td>${formatTime(record.clock_out_at)}</td><td>${mealBreak.startedAt ? `${formatTime(mealBreak.startedAt)} - ${formatTime(mealBreak.endedAt)} (${mealBreak.minutes}m)` : ''}</td><td>${regularBreak.startedAt ? `${formatTime(regularBreak.startedAt)} - ${formatTime(regularBreak.endedAt)} (${regularBreak.minutes}m)` : ''}</td><td class="right">${getClockBreakMinutes(record)}</td><td class="right">${hours.toFixed(2)}</td><td class="right">${formatCurrency(calculateDailyPayout(page.item, hours))}</td></tr>`
      }).join('')}<tr class="totals-row"><td colspan="5">Total</td><td class="right">${page.totalBreakMinutes}</td><td class="right">${page.totalHours.toFixed(2)}</td><td class="right">${formatCurrency(Number(page.item.payout_amount ?? 0))}</td></tr></tbody></table></section>`).join('')}
    </body></html>`)
  printWindow.document.close()
  printWindow.focus()
  printWindow.print()
}

export default function PayrollPayoutsReportPage() {
  const { payrollRuns, setPayrollRuns } = usePayrollRuns()
  const { clockRecords } = useClockRecords()
  const employees = useEmployees({ includeArchived: true })
  const { departmentDefinitions } = useAppSettings()
  const [search, setSearch] = useState('')
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [view, setView] = useState<SummaryView>('department')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('all')
  const [editing, setEditing] = useState(false)
  const [memoEdit, setMemoEdit] = useState('')
  const [itemEdits, setItemEdits] = useState<Record<string, Partial<PayrollRunItem>>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const departmentOptions = useMemo(() => [
    { key: 'all', label: 'All' },
    ...departmentDefinitions.map(definition => ({ key: definition.key, label: definition.label })),
  ], [departmentDefinitions])
  const sortedRuns = useMemo(() => [...payrollRuns].sort((left, right) => right.pay_date.localeCompare(left.pay_date) || right.created_at.localeCompare(left.created_at)), [payrollRuns])
  const filteredRuns = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return sortedRuns.slice(0, 25)
    return sortedRuns.filter(run => {
      const departmentLabel = departmentOptions.find(option => option.key === run.department)?.label ?? run.department
      const employeesText = (run.payroll_run_items ?? []).map(item => item.employee_name).join(' ')
      return [departmentLabel, run.department, run.pay_date, run.start_date, run.end_date, run.memo ?? '', employeesText].join(' ').toLowerCase().includes(query)
    }).slice(0, 50)
  }, [departmentOptions, search, sortedRuns])
  const selectedRun = payrollRuns.find(run => run.id === selectedRunId) ?? null
  const selectedRunIndex = selectedRun ? sortedRuns.findIndex(run => run.id === selectedRun.id) : -1
  const editedItems = useMemo(() => [...(selectedRun?.payroll_run_items ?? [])]
    .sort((left, right) => left.display_order - right.display_order || left.employee_name.localeCompare(right.employee_name))
    .map(item => itemEdits[item.id] ? calculateSavedPayrollItem(item, itemEdits[item.id]) : item), [itemEdits, selectedRun])
  const displayedItems = view === 'individual' && selectedEmployeeId !== 'all'
    ? editedItems.filter(item => item.employee_id === selectedEmployeeId || item.employee_name === selectedEmployeeId)
    : editedItems
  const selectedItem = displayedItems[0] ?? null
  const summary = selectedRun ? buildSavedPayrollSummary({ ...selectedRun, payroll_run_items: editedItems }) : null
  const schedules = useSchedulesByRange(selectedRun?.start_date ?? '', selectedRun?.end_date ?? '')
  const selectedClockRecords = selectedRun && selectedItem?.employee_id
    ? getEmployeeClockRecords({ employeeId: selectedItem.employee_id, clockRecords, employees, department: selectedRun.department, startDate: selectedRun.start_date, endDate: selectedRun.end_date, schedules })
    : []

  const openSummary = (runId: string) => {
    const run = payrollRuns.find(item => item.id === runId)
    setSelectedRunId(runId)
    setView('department')
    setSelectedEmployeeId('all')
    setMemoEdit(run?.memo ?? '')
    setItemEdits({})
    setEditing(false)
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const runId = params.get('run')
    const run = payrollRuns.find(item => item.id === runId)
    if (run) {
      setSelectedRunId(run.id)
      setView('department')
      setSelectedEmployeeId('all')
      setMemoEdit(run.memo ?? '')
      setItemEdits({})
      setEditing(false)
    }
  }, [payrollRuns])

  const updateItemEdit = (item: PayrollRunItem, patch: Partial<PayrollRunItem>) => {
    setItemEdits(current => ({ ...current, [item.id]: calculateSavedPayrollItem(item, { ...current[item.id], ...patch }) }))
  }

  const saveEdit = async () => {
    if (!selectedRun) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/payroll-runs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: selectedRun.id, memo: memoEdit, rows: editedItems }),
      })
      const payload = (await res.json().catch(() => ({}))) as { error?: string; cash_entry_id?: string | null }
      if (!res.ok) throw new Error(payload.error ?? 'Failed to update payroll payout.')
      const totals = getPayrollTotals(editedItems.map(item => ({
        payment_method: item.payment_method ?? '',
        payout_amount: Number(item.payout_amount ?? 0),
        gross_pay: Number(item.gross_pay ?? 0),
        deductions: Number(item.deductions ?? 0),
        net_pay: Number(item.net_pay ?? 0),
      })))
      setPayrollRuns(currentRuns => currentRuns.map(run => run.id === selectedRun.id ? {
        ...run,
        memo: memoEdit.trim() || null,
        total_cash: totals.cash,
        total_check: totals.check,
        total_ach: totals.ach,
        total_gross: totals.gross,
        total_deductions: totals.deductions,
        total_net: totals.net,
        updated_at: new Date().toISOString(),
        payroll_run_items: editedItems,
      } : run))
      const sheetSync = await fetch('/api/payroll-sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: selectedRun.id }),
      })
      if (!sheetSync.ok) {
        const sheetPayload = (await sheetSync.json().catch(() => ({}))) as { error?: string }
        throw new Error(sheetPayload.error ?? 'Payroll updated, but Google Sheets sync failed.')
      }
      if (payload.cash_entry_id) {
        await fetch('/api/cash-balance-sheet-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entry_id: payload.cash_entry_id }),
        })
      }
      notifyReportingDataChanged()
      setItemEdits({})
      setEditing(false)
      setMessage('Saved payroll payout updated. This replaced the existing payroll data and synced reporting.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to update payroll payout.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6">
      <AdminSubpageHeader title="Payroll Payouts" subtitle="Search, reprint, and edit saved payroll payouts." backHref="/reporting" backLabel="Back to Reporting" />
      <ReportingNav />
      {message && <div className="mb-4 rounded-lg border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">{message}</div>}
      <div className="rounded-xl border bg-white">
        <div className="border-b p-4">
          <Label>Search Payroll Payouts</Label>
          <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by employee, department, pay date, period, or memo" />
        </div>
        <div className="overflow-x-auto">
          <Table className="min-w-[980px] text-xs">
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableHead>Status</TableHead><TableHead>Department</TableHead><TableHead>Pay Date</TableHead><TableHead>Period</TableHead>
                <TableHead className="text-right">Cash</TableHead><TableHead className="text-right">Check</TableHead><TableHead className="text-right">ACH</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Updated</TableHead><TableHead className="text-right">Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRuns.map(run => (
                <TableRow key={run.id}>
                  <TableCell><Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">Paid</Badge></TableCell>
                  <TableCell className="font-medium">{departmentOptions.find(option => option.key === run.department)?.label ?? run.department}</TableCell>
                  <TableCell>{run.pay_date}</TableCell>
                  <TableCell>{run.start_date} to {run.end_date}</TableCell>
                  <TableCell className="text-right">{formatCurrency(Number(run.total_cash ?? 0))}</TableCell>
                  <TableCell className="text-right">{formatCurrency(Number(run.total_check ?? 0))}</TableCell>
                  <TableCell className="text-right">{formatCurrency(Number(run.total_ach ?? 0))}</TableCell>
                  <TableCell className="text-right font-semibold">{formatCurrency(Number(run.total_net ?? 0))}</TableCell>
                  <TableCell>{format(new Date(run.updated_at ?? run.created_at), 'MMM d, h:mm a')}</TableCell>
                  <TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => openSummary(run.id)}>Open</Button></TableCell>
                </TableRow>
              ))}
              {filteredRuns.length === 0 && <TableRow><TableCell colSpan={10} className="py-6 text-center text-muted-foreground">No saved payroll payouts found.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!selectedRun} onOpenChange={(open) => { if (!open) setSelectedRunId(null) }}>
        <DialogContent className="w-[calc(100vw-2rem)] !max-w-6xl max-h-[90vh] overflow-y-auto p-6">
          <DialogHeader><DialogTitle>Saved Payroll Summary</DialogTitle></DialogHeader>
          {selectedRun && summary && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={selectedRunIndex < 0 || selectedRunIndex >= sortedRuns.length - 1} onClick={() => { const run = sortedRuns[selectedRunIndex + 1]; if (run) openSummary(run.id) }}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={selectedRunIndex <= 0} onClick={() => { const run = sortedRuns[selectedRunIndex - 1]; if (run) openSummary(run.id) }}>Next</Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant={view === 'department' ? 'default' : 'outline'} size="sm" onClick={() => setView('department')}>Department</Button>
                  <Button variant={view === 'individual' ? 'default' : 'outline'} size="sm" onClick={() => setView('individual')}>Individual</Button>
                  {view === 'individual' && (
                    <Select value={selectedEmployeeId === 'all' ? undefined : selectedEmployeeId} onValueChange={(value: string | null) => value && setSelectedEmployeeId(value)}>
                      <SelectTrigger className="h-8 w-48"><span>{selectedItem?.employee_name ?? 'Select employee'}</span></SelectTrigger>
                      <SelectContent>{editedItems.map(item => <SelectItem key={item.id} value={item.employee_id ?? item.employee_name}>{item.employee_name}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  <Button variant="outline" size="sm" onClick={() => printSavedPayroll(selectedRun, editedItems, clockRecords, employees, schedules)}>Reprint</Button>
                  <Button variant={editing ? 'default' : 'outline'} size="sm" onClick={() => setEditing(value => !value)}>{editing ? 'Editing' : 'Edit'}</Button>
                </div>
              </div>

              <div className="flex flex-col gap-2 rounded-xl border bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Badge variant="outline" className="border-emerald-300 bg-white text-emerald-800">Paid</Badge>
                  <p className="mt-2 text-sm font-semibold text-slate-950">{departmentOptions.find(option => option.key === selectedRun.department)?.label ?? selectedRun.department} | {selectedRun.start_date} to {selectedRun.end_date}</p>
                  <p className="text-xs text-slate-600">Pay date {selectedRun.pay_date} | Created {format(new Date(selectedRun.created_at), 'MMM d, yyyy h:mm a')}</p>
                </div>
                <div className="text-left sm:text-right"><p className="text-xs font-semibold uppercase text-emerald-700">Total Payout</p><p className="text-2xl font-bold text-emerald-950">{formatCurrency(summary.net)}</p></div>
              </div>

              {editing ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-semibold text-amber-950">Saving changes will replace the existing payroll worksheet data.</p>
                  <p className="mt-1 text-sm text-amber-900">Reports and dashboard totals will use the updated payout. If cash changes, the system records a cash adjustment.</p>
                  <div className="mt-3"><Label>Payroll Memo</Label><Textarea value={memoEdit} onChange={event => setMemoEdit(event.target.value)} /></div>
                </div>
              ) : selectedRun.memo ? (
                <div className="rounded-xl border bg-slate-50 p-3 text-sm text-slate-700"><span className="font-semibold text-slate-950">Memo: </span>{selectedRun.memo}</div>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  ['Staff', String(summary.employeeCount), 'bg-white text-slate-950'],
                  ['Hours', summary.hours.toFixed(2), 'bg-white text-slate-950'],
                  ['Cash', formatCurrency(summary.cash), 'bg-emerald-50 text-emerald-950'],
                  ['Check', formatCurrency(summary.check), 'bg-white text-slate-950'],
                  ['ACH', formatCurrency(summary.ach), 'bg-blue-50 text-blue-950'],
                  ['Tips', formatCurrency(summary.tips), 'bg-white text-slate-950'],
                  ['Base Wages', formatCurrency(summary.baseWages), 'bg-white text-slate-950'],
                  ['Top-Up', formatCurrency(summary.topUp), 'bg-white text-slate-950'],
                  ['Deductions', formatCurrency(summary.deductions), 'bg-white text-red-700'],
                  ['Total', formatCurrency(summary.net), 'bg-slate-950 text-white'],
                ].map(([label, value, className]) => (
                  <div key={label} className={`rounded-lg border p-3 ${className}`}><div className="text-xs uppercase opacity-70">{label}</div><div className="mt-1 text-xl font-bold">{value}</div></div>
                ))}
              </div>

              <div className="overflow-x-auto rounded-lg border bg-white">
                <Table className="min-w-[980px] text-xs">
                  <TableHeader><TableRow className="bg-slate-50 hover:bg-slate-50"><TableHead>Paid By</TableHead><TableHead>Name</TableHead><TableHead>Department</TableHead><TableHead className="text-right">Hours</TableHead><TableHead className="text-right">Tips</TableHead><TableHead className="text-right">Base</TableHead><TableHead className="text-right">Top-Up</TableHead><TableHead className="text-right">Commission</TableHead><TableHead className="text-right">Deductions</TableHead><TableHead className="text-right">Payout</TableHead><TableHead>Memo</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {displayedItems.map(item => (
                      <TableRow key={item.id}>
                        <TableCell>{editing ? <Select value={item.payment_method ?? undefined} onValueChange={(value: string | null) => value && updateItemEdit(item, { payment_method: value as PaymentMethod })}><SelectTrigger className="h-8 w-28"><span>{paymentMethodLabel(item.payment_method)}</span></SelectTrigger><SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="check">Check</SelectItem><SelectItem value="ach">ACH</SelectItem></SelectContent></Select> : paymentMethodLabel(item.payment_method)}</TableCell>
                        <TableCell className="font-medium">{item.employee_name}</TableCell>
                        <TableCell>{departmentOptions.find(option => option.key === item.department)?.label ?? item.department}</TableCell>
                        <TableCell className="text-right">{Number(item.hours ?? 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(Number(item.tips ?? 0))}</TableCell>
                        <TableCell className="text-right">{formatCurrency(Number(item.base_wages ?? 0))}</TableCell>
                        <TableCell className="text-right">{formatCurrency(Number(item.guarantee_top_up ?? 0))}</TableCell>
                        <TableCell className="text-right">{editing ? <Input className="h-8 text-right" type="number" step="0.01" value={Number(item.commission ?? 0)} onChange={event => updateItemEdit(item, { commission: normalizeMoney(event.target.value) })} /> : formatCurrency(Number(item.commission ?? 0))}</TableCell>
                        <TableCell className="text-right text-red-700">{editing ? <Input className="h-8 text-right" type="number" step="0.01" value={Number(item.deductions ?? 0)} onChange={event => updateItemEdit(item, { deductions: normalizeMoney(event.target.value) })} /> : formatCurrency(Number(item.deductions ?? 0))}</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(Number(item.payout_amount ?? 0))}</TableCell>
                        <TableCell>{editing ? <Input className="h-8" value={item.memo || ''} onChange={event => updateItemEdit(item, { memo: event.target.value })} /> : item.memo || ''}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {view === 'individual' && selectedItem && (
                <div className="overflow-x-auto rounded-lg border bg-white">
                  <div className="border-b bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-950">{selectedItem.employee_name} Time Records</div>
                  <Table className="min-w-[900px] text-xs">
                    <TableHeader><TableRow className="bg-slate-50 hover:bg-slate-50"><TableHead>Date</TableHead><TableHead>Clock In</TableHead><TableHead>Clock Out</TableHead><TableHead>Meal Break</TableHead><TableHead>Regular Break</TableHead><TableHead className="text-right">Unpaid Min</TableHead><TableHead className="text-right">Worked Hours</TableHead><TableHead className="text-right">Daily Payout</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {selectedClockRecords.map(record => {
                        const mealBreak = getMealBreakState(record)
                        const regularBreak = getUnpaidBreakState(record)
                        const hours = getEffectiveClockHours(record)
                        return <TableRow key={record.id}><TableCell>{record.session_date}</TableCell><TableCell>{formatTime(record.clock_in_at)}</TableCell><TableCell>{formatTime(record.clock_out_at)}</TableCell><TableCell>{mealBreak.startedAt ? `${formatTime(mealBreak.startedAt)} - ${formatTime(mealBreak.endedAt)} (${mealBreak.minutes}m)` : ''}</TableCell><TableCell>{regularBreak.startedAt ? `${formatTime(regularBreak.startedAt)} - ${formatTime(regularBreak.endedAt)} (${regularBreak.minutes}m)` : ''}</TableCell><TableCell className="text-right">{getClockBreakMinutes(record)}</TableCell><TableCell className="text-right">{hours.toFixed(2)}</TableCell><TableCell className="text-right font-semibold">{formatCurrency(calculateDailyPayout(selectedItem, hours))}</TableCell></TableRow>
                      })}
                      {selectedClockRecords.length > 0 && <TableRow className="bg-slate-50 font-semibold"><TableCell colSpan={5}>Total</TableCell><TableCell className="text-right">{selectedClockRecords.reduce((sum, record) => sum + getClockBreakMinutes(record), 0)}</TableCell><TableCell className="text-right">{selectedClockRecords.reduce((sum, record) => sum + getEffectiveClockHours(record), 0).toFixed(2)}</TableCell><TableCell className="text-right">{formatCurrency(selectedClockRecords.reduce((sum, record) => sum + calculateDailyPayout(selectedItem, getEffectiveClockHours(record)), 0))}</TableCell></TableRow>}
                      {selectedClockRecords.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">No matching time records found for this saved payout period.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              )}

              {editing && (
                <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-amber-900">This will replace existing saved payroll data and refresh reports/dashboard from the updated payout.</p>
                  <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => { setEditing(false); setItemEdits({}); setMemoEdit(selectedRun.memo ?? '') }} disabled={saving}>Cancel</Button><Button size="sm" onClick={() => void saveEdit()} disabled={saving}>{saving ? 'Saving...' : 'Save Replacement'}</Button></div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
