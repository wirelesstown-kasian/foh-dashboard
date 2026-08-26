'use client'

import { useEffect, useMemo, useState } from 'react'
import { endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns'
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
import { calculateClockHoursAfterBreak, clockMatchesWorkDepartment, getClockBreakMinutes, getEffectiveClockHours, getMealBreakState, getUnpaidBreakState } from '@/lib/clockUtils'
import { getEmployeeScheduleDepartments } from '@/lib/employeeSelect'
import { calculatePayrollAmounts, getPayrollTotals, normalizeMoney, paymentMethodLabel } from '@/lib/payroll'
import { formatCurrency } from '@/lib/reporting'
import type { Employee, PaymentMethod, PayrollRun, PayrollRunItem, ShiftClock } from '@/lib/types'

type SavedPayrollRun = PayrollRun & { payroll_run_items?: PayrollRunItem[] }
type PayoutPeriod = 'week' | 'month' | 'custom'

function formatTime(value: string | null | undefined) {
  return value ? format(new Date(value), 'h:mm a') : ''
}

function isoToTimeInput(value: string | null | undefined) {
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
  const hours = normalizeMoney(patch.hours ?? item.hours)
  const employee = item.employee ?? null
  const hourlyRate = Number(employee?.hourly_wage ?? 0)
  const guaranteedRate = Number(employee?.guaranteed_hourly ?? 0)
  const tips = normalizeMoney(patch.tips ?? item.tips)
  const baseWages = patch.base_wages === undefined && patch.hours !== undefined
    ? normalizeMoney(hours * hourlyRate)
    : normalizeMoney(patch.base_wages ?? item.base_wages)
  const topUp = patch.guarantee_top_up === undefined && (patch.hours !== undefined || patch.tips !== undefined || patch.base_wages !== undefined)
    ? normalizeMoney(Math.max(0, hours * guaranteedRate - (baseWages + tips)))
    : normalizeMoney(patch.guarantee_top_up ?? item.guarantee_top_up)
  const updated = {
    ...item,
    ...patch,
    payment_method: paymentMethod,
    hours,
    base_wages: baseWages,
    guarantee_top_up: topUp,
    tips,
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

function getEditedClockHours(record: ShiftClock, edit?: { clockIn: string; clockOut: string }) {
  const clockIn = edit?.clockIn ? timeInputToIso(record.session_date, edit.clockIn) : record.clock_in_at
  const clockOut = edit?.clockOut ? timeInputToIso(record.session_date, edit.clockOut) : record.clock_out_at
  if (!clockIn || !clockOut) return 0
  return calculateClockHoursAfterBreak(clockIn, clockOut, getClockBreakMinutes(record))
}

function getDateInputValue(date: Date) {
  return format(date, 'yyyy-MM-dd')
}

function getPayoutRange(period: PayoutPeriod, refDate: string, customStart: string, customEnd: string) {
  const date = new Date(`${refDate}T12:00:00`)
  if (period === 'week') {
    return [
      format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      format(endOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    ] as const
  }
  if (period === 'month') {
    return [format(startOfMonth(date), 'yyyy-MM-dd'), format(endOfMonth(date), 'yyyy-MM-dd')] as const
  }
  return [customStart, customEnd] as const
}

function escapePrintValue(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function printSavedPayroll(run: SavedPayrollRun, items: PayrollRunItem[], clockRecords: ShiftClock[], employees: Employee[], schedules: ReturnType<typeof useSchedulesByRange>, departmentLabel: string) {
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
        <div class="muted">Department: ${escapePrintValue(departmentLabel)} | ${run.start_date} - ${run.end_date} | Pay date ${run.pay_date}</div>
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
  const { clockRecords, setClockRecords } = useClockRecords()
  const employees = useEmployees({ includeArchived: true })
  const { departmentDefinitions } = useAppSettings()
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState('all')
  const [period, setPeriod] = useState<PayoutPeriod>('month')
  const [refDate, setRefDate] = useState(getDateInputValue(new Date()))
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('all')
  const [editing, setEditing] = useState(false)
  const [memoEdit, setMemoEdit] = useState('')
  const [adjustmentMemo, setAdjustmentMemo] = useState('')
  const [adjustmentSettled, setAdjustmentSettled] = useState(false)
  const [itemEdits, setItemEdits] = useState<Record<string, Partial<PayrollRunItem>>>({})
  const [clockEdits, setClockEdits] = useState<Record<string, { clockIn: string; clockOut: string }>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const departmentOptions = useMemo(() => [
    { key: 'all', label: 'All' },
    ...departmentDefinitions.map(definition => ({ key: definition.key, label: definition.label })),
  ], [departmentDefinitions])
  const sortedRuns = useMemo(() => [...payrollRuns].sort((left, right) => right.pay_date.localeCompare(left.pay_date) || right.created_at.localeCompare(left.created_at)), [payrollRuns])
  const [rangeStart, rangeEnd] = useMemo(() => getPayoutRange(period, refDate, customStart, customEnd), [customEnd, customStart, period, refDate])
  const filteredRuns = useMemo(() => {
    const query = search.trim().toLowerCase()
    return sortedRuns.filter(run => {
      if (department !== 'all' && run.department !== department) return false
      if (rangeStart && run.end_date < rangeStart) return false
      if (rangeEnd && run.start_date > rangeEnd) return false
      const departmentLabel = departmentOptions.find(option => option.key === run.department)?.label ?? run.department
      const employeesText = (run.payroll_run_items ?? []).map(item => item.employee_name).join(' ')
      if (!query) return true
      return [departmentLabel, run.department, run.pay_date, run.start_date, run.end_date, run.memo ?? '', employeesText].join(' ').toLowerCase().includes(query)
    }).slice(0, 50)
  }, [department, departmentOptions, rangeEnd, rangeStart, search, sortedRuns])
  const selectedRun = payrollRuns.find(run => run.id === selectedRunId) ?? null
  const selectedRunIndex = selectedRun ? sortedRuns.findIndex(run => run.id === selectedRun.id) : -1
  const editedItems = useMemo(() => [...(selectedRun?.payroll_run_items ?? [])]
    .sort((left, right) => left.display_order - right.display_order || left.employee_name.localeCompare(right.employee_name))
    .map(item => itemEdits[item.id] ? calculateSavedPayrollItem(item, itemEdits[item.id]) : item), [itemEdits, selectedRun])
  const displayedItems = selectedEmployeeId !== 'all'
    ? editedItems.filter(item => item.employee_id === selectedEmployeeId || item.employee_name === selectedEmployeeId)
    : editedItems
  const selectedItem = displayedItems[0] ?? null
  const summary = selectedRun ? buildSavedPayrollSummary({ ...selectedRun, payroll_run_items: editedItems }) : null
  const schedules = useSchedulesByRange(selectedRun?.start_date ?? '', selectedRun?.end_date ?? '')
  const selectedClockRecords = selectedRun && selectedItem?.employee_id
    ? getEmployeeClockRecords({ employeeId: selectedItem.employee_id, clockRecords, employees, department: selectedRun.department, startDate: selectedRun.start_date, endDate: selectedRun.end_date, schedules })
    : []
  const selectedOriginalItem = selectedRun?.payroll_run_items?.find(item => selectedItem && item.id === selectedItem.id) ?? null
  const selectedAdjustment = selectedItem && selectedOriginalItem
    ? normalizeMoney(Number(selectedItem.payout_amount ?? 0) - Number(selectedOriginalItem.payout_amount ?? 0))
    : 0

  const openSummary = (runId: string) => {
    const run = payrollRuns.find(item => item.id === runId)
    setSelectedRunId(runId)
    setSelectedEmployeeId('all')
    setMemoEdit(run?.memo ?? '')
    setItemEdits({})
    setClockEdits({})
    setAdjustmentMemo('')
    setAdjustmentSettled(false)
    setEditing(false)
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const runId = params.get('run')
    const run = payrollRuns.find(item => item.id === runId)
    if (run) {
      setSelectedRunId(run.id)
      setSelectedEmployeeId('all')
      setMemoEdit(run.memo ?? '')
      setItemEdits({})
      setClockEdits({})
      setAdjustmentMemo('')
      setAdjustmentSettled(false)
      setEditing(false)
    }
  }, [payrollRuns])

  const updateItemEdit = (item: PayrollRunItem, patch: Partial<PayrollRunItem>) => {
    setItemEdits(current => ({ ...current, [item.id]: calculateSavedPayrollItem(item, { ...current[item.id], ...patch }) }))
  }

  const openEmployeeAdjustment = (item: PayrollRunItem) => {
    const employeeKey = item.employee_id ?? item.employee_name
    setSelectedEmployeeId(employeeKey)
    setEditing(true)
    setAdjustmentMemo('')
    setAdjustmentSettled(false)
    setClockEdits(() => {
      if (!selectedRun || !item.employee_id) return {}
      const records = getEmployeeClockRecords({
        employeeId: item.employee_id,
        clockRecords,
        employees,
        department: selectedRun.department,
        startDate: selectedRun.start_date,
        endDate: selectedRun.end_date,
        schedules,
      })
      return Object.fromEntries(records.map(record => [record.id, {
        clockIn: isoToTimeInput(record.clock_in_at),
        clockOut: isoToTimeInput(record.clock_out_at),
      }]))
    })
  }

  const updateClockEdit = (record: ShiftClock, patch: Partial<{ clockIn: string; clockOut: string }>) => {
    setClockEdits(current => {
      const previous = current[record.id] ?? {
        clockIn: isoToTimeInput(record.clock_in_at),
        clockOut: isoToTimeInput(record.clock_out_at),
      }
      const next = {
        ...current,
        [record.id]: {
          ...previous,
          ...patch,
        },
      }
      if (selectedItem) {
        const nextHours = selectedClockRecords.reduce((sum, item) => sum + getEditedClockHours(item, next[item.id]), 0)
        setItemEdits(itemEditsCurrent => ({
          ...itemEditsCurrent,
          [selectedItem.id]: calculateSavedPayrollItem(selectedOriginalItem ?? selectedItem, {
            ...(itemEditsCurrent[selectedItem.id] ?? {}),
            hours: normalizeMoney(nextHours),
          }),
        }))
      }
      return next
    })
  }

  const saveEdit = async () => {
    if (!selectedRun) return
    setSaving(true)
    setMessage(null)
    try {
      const editedClockRecords: ShiftClock[] = []
      for (const record of selectedClockRecords) {
        const edit = clockEdits[record.id]
        if (!edit) continue
        const nextClockInAt = timeInputToIso(record.session_date, edit.clockIn)
        const nextClockOutAt = timeInputToIso(record.session_date, edit.clockOut)
        if (!nextClockInAt || !nextClockOutAt) throw new Error(`Clock in and out are required for ${record.session_date}.`)
        if (new Date(nextClockOutAt).getTime() <= new Date(nextClockInAt).getTime()) throw new Error(`Clock out must be after clock in for ${record.session_date}.`)
        if (nextClockInAt === record.clock_in_at && nextClockOutAt === record.clock_out_at) continue
        const noteParts = [
          record.manager_note?.trim(),
          `Modified after payout from Payroll Payouts. ${adjustmentMemo.trim() || 'Payroll correction.'}`,
        ].filter(Boolean)
        const res = await fetch('/api/clock-events', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: record.id,
            action: 'adjust',
            session_date: record.session_date,
            clock_in_at: nextClockInAt,
            clock_out_at: nextClockOutAt,
            work_department: record.work_department ?? selectedRun.department,
            manager_note: noteParts.join('\n'),
          }),
        })
        const payload = (await res.json().catch(() => ({}))) as { record?: ShiftClock; error?: string }
        if (!res.ok || !payload.record) throw new Error(payload.error ?? 'Failed to update clock record.')
        editedClockRecords.push(payload.record)
        await fetch('/api/clock-records-sheet-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ record_id: payload.record.id }),
        })
      }

      const rowsForSave = editedItems.map(item => {
        if (!selectedItem || item.id !== selectedItem.id || selectedClockRecords.length === 0) return item
        const editedHours = selectedClockRecords.reduce((sum, record) => sum + getEditedClockHours(record, clockEdits[record.id]), 0)
        return calculateSavedPayrollItem(selectedOriginalItem ?? item, {
          ...(itemEdits[item.id] ?? {}),
          hours: normalizeMoney(editedHours),
          memo: [
            item.memo?.trim(),
            `Modified after payout${adjustmentSettled ? ' and settled' : ''}. ${adjustmentMemo.trim()}`,
          ].filter(Boolean).join(' | '),
        })
      })

      const res = await fetch('/api/payroll-runs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: selectedRun.id, memo: memoEdit, rows: rowsForSave }),
      })
      const payload = (await res.json().catch(() => ({}))) as { error?: string; cash_entry_id?: string | null; payroll_run?: SavedPayrollRun }
      if (!res.ok) throw new Error(payload.error ?? 'Failed to update payroll payout.')
      const totals = getPayrollTotals(rowsForSave.map(item => ({
        payment_method: item.payment_method ?? '',
        payout_amount: Number(item.payout_amount ?? 0),
        gross_pay: Number(item.gross_pay ?? 0),
        deductions: Number(item.deductions ?? 0),
        net_pay: Number(item.net_pay ?? 0),
      })))
      setPayrollRuns(currentRuns => currentRuns.map(run => run.id === selectedRun.id ? (
        payload.payroll_run ?? {
          ...run,
          memo: memoEdit.trim() || null,
          total_cash: totals.cash,
          total_check: totals.check,
          total_ach: totals.ach,
          total_gross: totals.gross,
          total_deductions: totals.deductions,
          total_net: totals.net,
          updated_at: new Date().toISOString(),
          payroll_run_items: rowsForSave,
        }
      ) : run))
      if (editedClockRecords.length > 0) {
        setClockRecords(current => current.map(record => editedClockRecords.find(next => next.id === record.id) ?? record))
      }
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
      setClockEdits({})
      setAdjustmentMemo('')
      setAdjustmentSettled(false)
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
      <AdminSubpageHeader title="Payroll Payouts" subtitle="Search, reprint, and edit saved payroll payouts." backHref="/admin" backLabel="Back to Admin Board" />
      <ReportingNav />
      {message && <div className="mb-4 rounded-lg border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">{message}</div>}
      <div className="rounded-xl border bg-white">
        <div className="grid gap-3 border-b p-4 lg:grid-cols-[1fr_180px_170px_1fr]">
          <div>
            <Label>Search Payroll Payouts</Label>
            <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by employee, department, pay date, period, or memo" />
          </div>
          <div>
            <Label>Department</Label>
            <Select value={department} onValueChange={(value: string | null) => value && setDepartment(value)}>
              <SelectTrigger><span>{departmentOptions.find(option => option.key === department)?.label ?? 'All'}</span></SelectTrigger>
              <SelectContent>{departmentOptions.map(option => <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Calendar</Label>
            <Select value={period} onValueChange={(value: string | null) => value && setPeriod(value as PayoutPeriod)}>
              <SelectTrigger><span>{period === 'week' ? 'Week' : period === 'month' ? 'Month' : 'Custom Range'}</span></SelectTrigger>
              <SelectContent>
                <SelectItem value="week">Week</SelectItem>
                <SelectItem value="month">Month</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {period === 'custom' ? (
              <>
                <div><Label>Start</Label><Input type="date" value={customStart} onChange={event => setCustomStart(event.target.value)} /></div>
                <div><Label>End</Label><Input type="date" value={customEnd} onChange={event => setCustomEnd(event.target.value)} /></div>
              </>
            ) : (
              <div className="sm:col-span-2">
                <Label>Time Period</Label>
                <Input type="date" value={refDate} onChange={event => setRefDate(event.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">{rangeStart} to {rangeEnd}</p>
              </div>
            )}
          </div>
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
                  {selectedEmployeeId !== 'all' && <Button variant="outline" size="sm" onClick={() => { setSelectedEmployeeId('all'); setEditing(false); setItemEdits({}); setClockEdits({}); setAdjustmentMemo(''); setAdjustmentSettled(false) }}>Back to Summary</Button>}
                  <Button variant="outline" size="sm" onClick={() => printSavedPayroll(selectedRun, editedItems, clockRecords, employees, schedules, departmentOptions.find(option => option.key === selectedRun.department)?.label ?? selectedRun.department)}>Reprint</Button>
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
                  <p className="mt-1 text-sm text-amber-900">Reports and dashboard totals will use the updated payout. If cash changes, the system records a cash adjustment. Paid records are corrected here so the rest of the app can stay locked after payout.</p>
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
                        <TableCell className="font-medium"><button type="button" className="text-left font-semibold text-blue-700 underline-offset-2 hover:underline" onClick={() => openEmployeeAdjustment(item)}>{item.employee_name}</button></TableCell>
                        <TableCell>{departmentOptions.find(option => option.key === item.department)?.label ?? item.department}</TableCell>
                        <TableCell className="text-right">{Number(item.hours ?? 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(Number(item.tips ?? 0))}</TableCell>
                        <TableCell className="text-right">{formatCurrency(Number(item.base_wages ?? 0))}</TableCell>
                        <TableCell className="text-right">{formatCurrency(Number(item.guarantee_top_up ?? 0))}</TableCell>
                        <TableCell className="text-right">{editing ? <Input className="h-8 text-right" type="number" step="0.01" value={Number(item.commission ?? 0)} onChange={event => updateItemEdit(item, { commission: normalizeMoney(event.target.value) })} /> : formatCurrency(Number(item.commission ?? 0))}</TableCell>
                        <TableCell className="text-right text-red-700">{editing ? <Input className="h-8 text-right" type="number" step="0.01" value={Number(item.deductions ?? 0)} onChange={event => updateItemEdit(item, { deductions: normalizeMoney(event.target.value) })} /> : formatCurrency(Number(item.deductions ?? 0))}</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(Number(item.payout_amount ?? 0))}</TableCell>
                        <TableCell>{editing && selectedEmployeeId !== 'all' ? <Input className="h-8" value={item.memo || ''} onChange={event => updateItemEdit(item, { memo: event.target.value })} /> : item.memo || ''}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {selectedEmployeeId !== 'all' && selectedItem && (
                <>
                <div className="grid gap-3 rounded-xl border bg-slate-50 p-4 md:grid-cols-4">
                  <div><div className="text-xs uppercase text-muted-foreground">Original Payout</div><div className="text-xl font-bold">{formatCurrency(Number(selectedOriginalItem?.payout_amount ?? 0))}</div></div>
                  <div><div className="text-xs uppercase text-muted-foreground">Updated Payout</div><div className="text-xl font-bold">{formatCurrency(Number(selectedItem.payout_amount ?? 0))}</div></div>
                  <div><div className="text-xs uppercase text-muted-foreground">{selectedAdjustment >= 0 ? 'Balance Due' : 'Credit / Overpaid'}</div><div className={`text-xl font-bold ${selectedAdjustment >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(Math.abs(selectedAdjustment))}</div></div>
                  <div><div className="text-xs uppercase text-muted-foreground">Status</div><div className="text-sm font-semibold">{selectedAdjustment === 0 ? 'No balance' : adjustmentSettled ? 'Marked settled' : 'Unsettled adjustment'}</div></div>
                  {selectedAdjustment !== 0 && !adjustmentSettled && <div className="md:col-span-4 rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 text-sm text-amber-950">Balance or credit is not marked collected/paid. You can still save, but the payout summary will show it as a post-payout modification.</div>}
                  <div className="md:col-span-3"><Label>Adjustment Reason</Label><Textarea value={adjustmentMemo} onChange={event => setAdjustmentMemo(event.target.value)} placeholder="Required note for why this paid payroll was changed" /></div>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-800 md:items-end"><input type="checkbox" checked={adjustmentSettled} onChange={event => setAdjustmentSettled(event.target.checked)} />Balance/credit collected or paid</label>
                </div>
                <div className="overflow-x-auto rounded-lg border bg-white">
                  <div className="border-b bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-950">{selectedItem.employee_name} Time Records</div>
                  <Table className="min-w-[900px] text-xs">
                    <TableHeader><TableRow className="bg-slate-50 hover:bg-slate-50"><TableHead>Date</TableHead><TableHead>Clock In</TableHead><TableHead>Clock Out</TableHead><TableHead>Meal Break</TableHead><TableHead>Regular Break</TableHead><TableHead className="text-right">Unpaid Min</TableHead><TableHead className="text-right">Worked Hours</TableHead><TableHead className="text-right">Daily Payout</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {selectedClockRecords.map(record => {
                        const mealBreak = getMealBreakState(record)
                        const regularBreak = getUnpaidBreakState(record)
                        const edit = clockEdits[record.id]
                        const hours = getEditedClockHours(record, edit)
                        return <TableRow key={record.id}><TableCell>{record.session_date}</TableCell><TableCell>{editing ? <Input className="h-8 w-28" type="time" value={edit?.clockIn ?? isoToTimeInput(record.clock_in_at)} onChange={event => updateClockEdit(record, { clockIn: event.target.value })} /> : formatTime(record.clock_in_at)}</TableCell><TableCell>{editing ? <Input className="h-8 w-28" type="time" value={edit?.clockOut ?? isoToTimeInput(record.clock_out_at)} onChange={event => updateClockEdit(record, { clockOut: event.target.value })} /> : formatTime(record.clock_out_at)}</TableCell><TableCell>{mealBreak.startedAt ? `${formatTime(mealBreak.startedAt)} - ${formatTime(mealBreak.endedAt)} (${mealBreak.minutes}m)` : ''}</TableCell><TableCell>{regularBreak.startedAt ? `${formatTime(regularBreak.startedAt)} - ${formatTime(regularBreak.endedAt)} (${regularBreak.minutes}m)` : ''}</TableCell><TableCell className="text-right">{getClockBreakMinutes(record)}</TableCell><TableCell className="text-right">{hours.toFixed(2)}</TableCell><TableCell className="text-right font-semibold">{formatCurrency(calculateDailyPayout(selectedItem, hours))}</TableCell></TableRow>
                      })}
                      {selectedClockRecords.length > 0 && <TableRow className="bg-slate-50 font-semibold"><TableCell colSpan={5}>Total</TableCell><TableCell className="text-right">{selectedClockRecords.reduce((sum, record) => sum + getClockBreakMinutes(record), 0)}</TableCell><TableCell className="text-right">{selectedClockRecords.reduce((sum, record) => sum + getEditedClockHours(record, clockEdits[record.id]), 0).toFixed(2)}</TableCell><TableCell className="text-right">{formatCurrency(selectedClockRecords.reduce((sum, record) => sum + calculateDailyPayout(selectedItem, getEditedClockHours(record, clockEdits[record.id])), 0))}</TableCell></TableRow>}
                      {selectedClockRecords.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">No matching time records found for this saved payout period.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
                </>
              )}

              {editing && (
                <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-amber-900">This will replace existing saved payroll data and refresh reports/dashboard from the updated payout.</p>
                  <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => { setEditing(false); setItemEdits({}); setClockEdits({}); setAdjustmentMemo(''); setAdjustmentSettled(false); setMemoEdit(selectedRun.memo ?? '') }} disabled={saving}>Cancel</Button><Button size="sm" onClick={() => void saveEdit()} disabled={saving}>{saving ? 'Saving...' : 'Save Replacement'}</Button></div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
