'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, addWeeks, endOfMonth, endOfWeek, format, parseISO, startOfMonth, startOfWeek } from 'date-fns'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { ArrowLeft } from 'lucide-react'
import { useAppSettings } from '@/components/useAppSettings'
import { useClockRecords, useEmployees, useEodReports, notifyReportingDataChanged, usePayrollRuns, useSchedulesByRange } from '@/components/reporting/useReportingData'
import { supabase } from '@/lib/supabase'
import { calculateClockHoursAfterBreak, clockMatchesWorkDepartment, getClockBreakMinutes, getClockWorkDepartment, getEffectiveClockHours, getMealBreakState, getUnpaidBreakState, shouldWarnMissingMealBreak } from '@/lib/clockUtils'
import { getEmployeeScheduleDepartments } from '@/lib/employeeSelect'
import { formatCurrency } from '@/lib/reporting'
import {
  PayrollDraftRow,
  buildPayrollDraftRows,
  calculatePayrollAmounts,
  getPayrollTotals,
  normalizeMoney,
  paymentMethodLabel,
} from '@/lib/payroll'
import { CashBalanceEntry, Employee, PaymentMethod, PayrollRun, PayrollRunItem, ShiftClock } from '@/lib/types'
import { DepartmentDefinition } from '@/lib/appSettings'

type Step = 'setup' | 'worksheet'
type PayrollCycle = 'weekly' | 'semi_monthly'
type SavedPayrollRun = PayrollRun & { payroll_run_items?: PayrollRunItem[] }
type BreakEditState = {
  mealBreakStart: string
  mealBreakEnd: string
  regularBreakStart: string
  regularBreakEnd: string
}

function getPayrollCycleForDepartment(department: string, departmentDefinitions: DepartmentDefinition[] = []): PayrollCycle {
  if (department === 'all') return 'semi_monthly'
  const configuredCycle = departmentDefinitions.find(definition => definition.key === department)?.payroll_cycle
  if (configuredCycle === 'weekly' || configuredCycle === 'semi_monthly') return configuredCycle
  return department === 'server' ? 'weekly' : 'semi_monthly'
}

function getPayrollRangeFromPayDate(cycle: PayrollCycle, payDate: string) {
  const date = parseISO(payDate)

  if (cycle === 'weekly') {
    const previousWeek = addWeeks(date, -1)
    return {
      startDate: format(startOfWeek(previousWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      endDate: format(endOfWeek(previousWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    }
  }

  if (date.getDate() <= 15) {
    const previousMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1)
    return {
      startDate: format(new Date(previousMonth.getFullYear(), previousMonth.getMonth(), 16), 'yyyy-MM-dd'),
      endDate: format(endOfMonth(previousMonth), 'yyyy-MM-dd'),
    }
  }

  return {
    startDate: format(startOfMonth(date), 'yyyy-MM-dd'),
    endDate: format(new Date(date.getFullYear(), date.getMonth(), 15), 'yyyy-MM-dd'),
  }
}

function getDefaultPayDate(cycle: PayrollCycle) {
  const today = new Date()
  if (cycle === 'semi_monthly') {
    return format(today.getDate() <= 15 ? new Date(today.getFullYear(), today.getMonth(), 15) : endOfMonth(today), 'yyyy-MM-dd')
  }

  let nextDate = today
  while (nextDate.getDay() !== 5) {
    nextDate = addDays(nextDate, 1)
  }
  return format(nextDate, 'yyyy-MM-dd')
}

function getDefaultPayrollPeriod(cycle: PayrollCycle) {
  const payDate = getDefaultPayDate(cycle)
  const range = getPayrollRangeFromPayDate(cycle, payDate)
  return {
    ...range,
    payDate,
  }
}

function payrollCycleLabel(cycle: PayrollCycle) {
  return cycle === 'weekly' ? 'Weekly' : 'Semi-monthly'
}

function getSignedCashAmount(entry: Pick<CashBalanceEntry, 'entry_type' | 'amount'>) {
  return entry.entry_type === 'cash_in' ? Number(entry.amount ?? 0) : Number(entry.amount ?? 0) * -1
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

function getBreakMinutes(startIso: string | null, endIso: string | null) {
  if (!startIso || !endIso) return 0
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000))
}

function formatTime(value: string | null | undefined) {
  return value ? format(new Date(value), 'h:mm a') : ''
}

function getClockRecordEmployee(record: ShiftClock, employees: Employee[]) {
  const relatedEmployee = record.employee as Employee | Employee[] | undefined
  if (Array.isArray(relatedEmployee)) {
    return relatedEmployee[0] ?? employees.find(employee => employee.id === record.employee_id) ?? null
  }
  return relatedEmployee ?? employees.find(employee => employee.id === record.employee_id) ?? null
}

function calculateDailyPayout(row: Pick<PayrollDraftRow | PayrollRunItem, 'hours' | 'payout_amount'>, hours: number) {
  if (row.hours <= 0) return 0
  return normalizeMoney(row.payout_amount * (hours / row.hours))
}

function calculateSavedPayrollItem(item: PayrollRunItem, patch: Partial<PayrollRunItem>) {
  const paymentMethod = patch.payment_method ?? item.payment_method
  const baseWages = normalizeMoney(item.base_wages)
  const topUp = normalizeMoney(item.guarantee_top_up)
  const tips = normalizeMoney(item.tips)
  const commission = normalizeMoney(patch.commission ?? item.commission)
  const deductions = normalizeMoney(patch.deductions ?? item.deductions)
  const grossPay = normalizeMoney(baseWages + topUp + tips + commission)
  const netPay = normalizeMoney(Math.max(0, grossPay - deductions))
  const payoutAmount = paymentMethod === 'cash' ? Math.floor(netPay) : netPay

  return {
    ...item,
    ...patch,
    payment_method: paymentMethod,
    commission,
    deductions,
    gross_pay: grossPay,
    net_pay: netPay,
    payout_amount: payoutAmount,
    cash_rounding: normalizeMoney(netPay - payoutAmount),
  }
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
      return clockMatchesWorkDepartment(record, department, getClockRecordEmployee(record, employees), schedules)
    })
    .sort((left, right) => left.session_date.localeCompare(right.session_date) || left.clock_in_at.localeCompare(right.clock_in_at))
}

function sortPayrollRows(rows: PayrollDraftRow[]) {
  const order = { cash: 0, check: 1, ach: 2, '': 3 }
  return [...rows].sort((a, b) => {
    const left = order[a.payment_method]
    const right = order[b.payment_method]
    return left - right || a.employee_name.localeCompare(b.employee_name)
  }).map((row, index) => ({ ...row, display_order: index }))
}

function mergeWorksheetRowsWithClockSource(currentRows: PayrollDraftRow[], sourceRows: PayrollDraftRow[]) {
  const currentByEmployeeId = new Map(currentRows.map(row => [row.employee_id, row]))
  return sourceRows.map(sourceRow => {
    const currentRow = currentByEmployeeId.get(sourceRow.employee_id)
    if (!currentRow) return sourceRow
    const merged = {
      ...sourceRow,
      payment_method: currentRow.payment_method,
      commission: currentRow.commission,
      deductions: currentRow.deductions,
      memo: currentRow.memo,
    }
    return { ...merged, ...calculatePayrollAmounts(merged) }
  })
}

function arePayrollRowsEqual(leftRows: PayrollDraftRow[], rightRows: PayrollDraftRow[]) {
  if (leftRows.length !== rightRows.length) return false
  return leftRows.every((leftRow, index) => {
    const rightRow = rightRows[index]
    if (!rightRow) return false
    return leftRow.employee_id === rightRow.employee_id &&
      leftRow.payment_method === rightRow.payment_method &&
      leftRow.hours === rightRow.hours &&
      leftRow.tips === rightRow.tips &&
      leftRow.base_wages === rightRow.base_wages &&
      leftRow.guarantee_top_up === rightRow.guarantee_top_up &&
      leftRow.commission === rightRow.commission &&
      leftRow.deductions === rightRow.deductions &&
      leftRow.gross_pay === rightRow.gross_pay &&
      leftRow.net_pay === rightRow.net_pay &&
      leftRow.payout_amount === rightRow.payout_amount &&
      leftRow.cash_rounding === rightRow.cash_rounding &&
      leftRow.has_auto_clock_out === rightRow.has_auto_clock_out &&
      leftRow.has_open_clock === rightRow.has_open_clock &&
      leftRow.has_tip_data === rightRow.has_tip_data &&
      leftRow.memo === rightRow.memo
  })
}

function buildWorksheetSummary(rows: PayrollDraftRow[]) {
  const hours = rows.reduce((sum, row) => sum + Number(row.hours ?? 0), 0)
  const tips = rows.reduce((sum, row) => sum + Number(row.tips ?? 0), 0)
  const baseWages = rows.reduce((sum, row) => sum + Number(row.base_wages ?? 0), 0)
  const topUp = rows.reduce((sum, row) => sum + Number(row.guarantee_top_up ?? 0), 0)
  const commission = rows.reduce((sum, row) => sum + Number(row.commission ?? 0), 0)
  const employeeCount = rows.filter(row => row.hours > 0 || row.payout_amount > 0).length
  return { hours, tips, baseWages, topUp, commission, employeeCount }
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

function escapePrintValue(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function printSummary({
  rows,
  totals,
  startDate,
  endDate,
  payDate,
  department,
  memo,
  clockRecords,
  employees,
  schedules,
}: {
  rows: PayrollDraftRow[]
  totals: ReturnType<typeof getPayrollTotals>
  startDate: string
  endDate: string
  payDate: string
  department: string
  memo: string
  clockRecords: ShiftClock[]
  employees: Employee[]
  schedules: ReturnType<typeof useSchedulesByRange>
}) {
  const printWindow = window.open('', '_blank', 'width=1200,height=800')
  if (!printWindow) return
  const summary = buildWorksheetSummary(rows)
  const employeePages = rows.map(row => {
    const records = getEmployeeClockRecords({ employeeId: row.employee_id, clockRecords, employees, department, startDate, endDate, schedules })
    const totalBreakMinutes = records.reduce((sum, record) => sum + getClockBreakMinutes(record), 0)
    const totalHours = records.reduce((sum, record) => sum + getEffectiveClockHours(record), 0)
    const totalPayout = records.reduce((sum, record) => sum + calculateDailyPayout(row, getEffectiveClockHours(record)), 0)
    return { row, records, totalBreakMinutes, totalHours, totalPayout: normalizeMoney(totalPayout) }
  })

  printWindow.document.write(`
    <html>
      <head>
        <title>Payroll Summary</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #111827; }
          h1 { margin: 0 0 4px; }
          h2 { margin: 0 0 4px; }
          .muted { color: #64748b; font-size: 12px; }
          .cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 18px 0; }
          .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; }
          .metric { font-size: 22px; font-weight: 800; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #cbd5e1; padding: 7px; text-align: left; }
          th { background: #f1f5f9; }
          .right { text-align: right; }
          .note { margin: 14px 0; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; white-space: pre-wrap; }
          .page { break-after: page; page-break-after: always; }
          .page:last-child { break-after: auto; page-break-after: auto; }
          .employee-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 14px; }
          .totals-row td { font-weight: 800; background: #f8fafc; }
        </style>
      </head>
      <body>
        <section class="page">
          <h1>Payroll Summary</h1>
          <div class="muted">${escapePrintValue(department.toUpperCase())} | ${startDate} - ${endDate} | Pay date ${payDate}</div>
          ${memo ? `<div class="note">${escapePrintValue(memo)}</div>` : ''}
          <div class="cards">
            <div class="card"><div class="muted">Staff</div><div class="metric">${summary.employeeCount}</div></div>
            <div class="card"><div class="muted">Hours</div><div class="metric">${summary.hours.toFixed(2)}</div></div>
            <div class="card"><div class="muted">Tips</div><div class="metric">${formatCurrency(summary.tips)}</div></div>
            <div class="card"><div class="muted">Base Wages</div><div class="metric">${formatCurrency(summary.baseWages)}</div></div>
            <div class="card"><div class="muted">Top-Up</div><div class="metric">${formatCurrency(summary.topUp)}</div></div>
            <div class="card"><div class="muted">Commission</div><div class="metric">${formatCurrency(summary.commission)}</div></div>
            <div class="card"><div class="muted">Cash Payout</div><div class="metric">${formatCurrency(totals.cash)}</div></div>
            <div class="card"><div class="muted">Check Payout</div><div class="metric">${formatCurrency(totals.check)}</div></div>
            <div class="card"><div class="muted">ACH Payout</div><div class="metric">${formatCurrency(totals.ach)}</div></div>
            <div class="card"><div class="muted">Net Payroll</div><div class="metric">${formatCurrency(totals.net)}</div></div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Paid By</th><th>Name</th><th class="right">Hours</th><th class="right">Tips</th><th class="right">Commission</th><th class="right">Deductions</th><th class="right">Net</th><th class="right">Payout</th><th>Memo</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(row => `
                <tr>
                  <td>${escapePrintValue(paymentMethodLabel(row.payment_method))}</td>
                  <td>${escapePrintValue(row.employee_name)}</td>
                  <td class="right">${row.hours.toFixed(2)}</td>
                  <td class="right">${row.has_tip_data ? formatCurrency(row.tips) : ''}</td>
                  <td class="right">${formatCurrency(row.commission)}</td>
                  <td class="right">${formatCurrency(row.deductions)}</td>
                  <td class="right">${formatCurrency(row.net_pay)}</td>
                  <td class="right">${formatCurrency(row.payout_amount)}</td>
                  <td>${escapePrintValue(row.memo)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </section>
        ${employeePages.map(page => `
          <section class="page">
            <div class="employee-header">
              <div>
                <h2>${escapePrintValue(page.row.employee_name)}</h2>
                <div class="muted">${startDate} - ${endDate} | Paid by ${escapePrintValue(paymentMethodLabel(page.row.payment_method))}</div>
              </div>
              <div class="right">
                <div class="muted">Total Payout</div>
                <div class="metric">${formatCurrency(page.row.payout_amount)}</div>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Clock In</th><th>Clock Out</th><th>Meal Break</th><th>Regular Break</th><th class="right">Unpaid Minutes</th><th class="right">Worked Hours</th><th class="right">Daily Payout</th>
                </tr>
              </thead>
              <tbody>
                ${page.records.map(record => {
                  const mealBreak = getMealBreakState(record)
                  const regularBreak = getUnpaidBreakState(record)
                  const hours = getEffectiveClockHours(record)
                  return `
                    <tr>
                      <td>${record.session_date}</td>
                      <td>${formatTime(record.clock_in_at)}</td>
                      <td>${formatTime(record.clock_out_at)}</td>
                      <td>${mealBreak.startedAt ? `${formatTime(mealBreak.startedAt)} - ${formatTime(mealBreak.endedAt)} (${mealBreak.minutes}m)` : ''}</td>
                      <td>${regularBreak.startedAt ? `${formatTime(regularBreak.startedAt)} - ${formatTime(regularBreak.endedAt)} (${regularBreak.minutes}m)` : ''}</td>
                      <td class="right">${getClockBreakMinutes(record)}</td>
                      <td class="right">${hours.toFixed(2)}</td>
                      <td class="right">${formatCurrency(calculateDailyPayout(page.row, hours))}</td>
                    </tr>
                  `
                }).join('')}
                <tr class="totals-row">
                  <td colspan="5">Total</td>
                  <td class="right">${page.totalBreakMinutes}</td>
                  <td class="right">${page.totalHours.toFixed(2)}</td>
                  <td class="right">${formatCurrency(page.totalPayout)}</td>
                </tr>
              </tbody>
            </table>
          </section>
        `).join('')}
      </body>
    </html>
  `)
  printWindow.document.close()
  printWindow.focus()
  printWindow.print()
}

export default function WageWorksheetPage() {
  const employees = useEmployees()
  const { clockRecords, setClockRecords } = useClockRecords()
  const { eodReports } = useEodReports()
  const { payrollRuns, setPayrollRuns } = usePayrollRuns()
  const { departmentDefinitions } = useAppSettings()
  const initialPayrollCycle = getPayrollCycleForDepartment('all', departmentDefinitions)
  const initialPayrollPeriod = getDefaultPayrollPeriod(initialPayrollCycle)
  const [step, setStep] = useState<Step>('setup')
  const [department, setDepartment] = useState('all')
  const [payrollCycle, setPayrollCycle] = useState<PayrollCycle>(initialPayrollCycle)
  const [startDate, setStartDate] = useState(initialPayrollPeriod.startDate)
  const [endDate, setEndDate] = useState(initialPayrollPeriod.endDate)
  const [payDate, setPayDate] = useState(initialPayrollPeriod.payDate)
  const [memo, setMemo] = useState('')
  const [rows, setRows] = useState<PayrollDraftRow[]>([])
  const [excludedEmployeeIds, setExcludedEmployeeIds] = useState<string[]>([])
  const [employeeToAdd, setEmployeeToAdd] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmStep, setConfirmStep] = useState<'summary' | 'final'>('summary')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [cashBalancePreview, setCashBalancePreview] = useState<number | null>(null)
  const [summaryRunId, setSummaryRunId] = useState<string | null>(null)
  const [summaryView, setSummaryView] = useState<'department' | 'individual'>('department')
  const [summaryEmployeeId, setSummaryEmployeeId] = useState<string>('all')
  const [editingSummary, setEditingSummary] = useState(false)
  const [summaryMemoEdit, setSummaryMemoEdit] = useState('')
  const [summaryItemEdits, setSummaryItemEdits] = useState<Record<string, Partial<PayrollRunItem>>>({})
  const [savingSummaryEdit, setSavingSummaryEdit] = useState(false)
  const [breakReviewEmployeeId, setBreakReviewEmployeeId] = useState<string | null>(null)
  const [breakEdits, setBreakEdits] = useState<Record<string, BreakEditState>>({})
  const [savingBreakId, setSavingBreakId] = useState<string | null>(null)
  const stepRef = useRef(step)

  useEffect(() => {
    stepRef.current = step
  }, [step])

  useEffect(() => {
    const handlePopState = () => {
      if (stepRef.current === 'worksheet') {
        setStep('setup')
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])
  const schedules = useSchedulesByRange(startDate, endDate)

  const departmentOptions = useMemo(() => [
    { key: 'all', label: 'All' },
    ...(departmentDefinitions.length > 0
      ? departmentDefinitions.map(definition => ({ key: definition.key, label: definition.label }))
      : [
          { key: 'manager', label: 'Manager' },
          { key: 'server', label: 'Server' },
          { key: 'cook', label: 'Cook' },
          { key: 'kitchen', label: 'Kitchen' },
        ]),
  ], [departmentDefinitions])

  const totals = useMemo(() => getPayrollTotals(rows), [rows])
  const worksheetSummary = useMemo(() => buildWorksheetSummary(rows), [rows])
  const recentPayrollRuns = useMemo(() => [...payrollRuns]
    .sort((left, right) => right.pay_date.localeCompare(left.pay_date) || right.created_at.localeCompare(left.created_at))
  , [payrollRuns])
  const existingPayoutRun = useMemo(() => payrollRuns.find(run => {
    if (run.start_date !== startDate || run.end_date !== endDate) return false
    return run.department === department || run.department === 'all' || department === 'all'
  }) ?? null, [department, endDate, payrollRuns, startDate])
  const selectedSummaryRun = useMemo(
    () => payrollRuns.find(run => run.id === summaryRunId) ?? null,
    [payrollRuns, summaryRunId]
  )
  const selectedSummary = selectedSummaryRun ? buildSavedPayrollSummary(selectedSummaryRun) : null
  const selectedSummaryRunIndex = selectedSummaryRun ? recentPayrollRuns.findIndex(run => run.id === selectedSummaryRun.id) : -1
  const selectedSummaryItems = useMemo(() => {
    const items = [...(selectedSummaryRun?.payroll_run_items ?? [])]
      .sort((left, right) => left.display_order - right.display_order || left.employee_name.localeCompare(right.employee_name))
      .map(item => summaryItemEdits[item.id] ? calculateSavedPayrollItem(item, summaryItemEdits[item.id]) : item)
    return summaryView === 'individual' && summaryEmployeeId !== 'all'
      ? items.filter(item => item.employee_id === summaryEmployeeId || item.employee_name === summaryEmployeeId)
      : items
  }, [selectedSummaryRun, summaryEmployeeId, summaryItemEdits, summaryView])
  const selectedSummaryItem = selectedSummaryItems[0] ?? null
  const selectedSummaryClockRecords = selectedSummaryRun && selectedSummaryItem?.employee_id
    ? getEmployeeClockRecords({
        employeeId: selectedSummaryItem.employee_id,
        clockRecords,
        employees,
        department: selectedSummaryRun.department,
        startDate: selectedSummaryRun.start_date,
        endDate: selectedSummaryRun.end_date,
        schedules,
      })
    : []
  const breakReviewRow = rows.find(row => row.employee_id === breakReviewEmployeeId) ?? null
  const breakReviewRecords = breakReviewEmployeeId
    ? getEmployeeClockRecords({ employeeId: breakReviewEmployeeId, clockRecords, employees, department, startDate, endDate, schedules })
    : []
  const missingPaymentRows = rows.filter(row => !row.payment_method)
  const hasClockFlags = rows.some(row => row.has_auto_clock_out || row.has_open_clock)
  const breakReviewCounts = useMemo(() => {
    const employeeById = new Map(employees.map(employee => [employee.id, employee]))
    const counts = new Map<string, number>()
    for (const record of clockRecords) {
      if (record.session_date < startDate || record.session_date > endDate) continue
      const employee = employeeById.get(record.employee_id)
      if (department !== 'all' && !clockMatchesWorkDepartment(record, department, employee, schedules)) continue
      if (shouldWarnMissingMealBreak(record, employee)) {
        counts.set(record.employee_id, (counts.get(record.employee_id) ?? 0) + 1)
      }
    }
    return counts
  }, [clockRecords, department, employees, endDate, schedules, startDate])
  const availableEmployees = employees.filter(employee => {
    if (rows.some(row => row.employee_id === employee.id)) return false
    if (excludedEmployeeIds.includes(employee.id)) return false
    return department === 'all' ||
      getEmployeeScheduleDepartments(employee).includes(department) ||
      clockRecords.some(record =>
        record.employee_id === employee.id &&
        record.session_date >= startDate &&
        record.session_date <= endDate &&
        clockMatchesWorkDepartment(record, department, employee, schedules)
      )
  })

  const applyPayrollPeriod = (cycle: PayrollCycle, nextPayDate = getDefaultPayDate(cycle)) => {
    const nextRange = getPayrollRangeFromPayDate(cycle, nextPayDate)
    setPayrollCycle(cycle)
    setStartDate(nextRange.startDate)
    setEndDate(nextRange.endDate)
    setPayDate(nextPayDate)
  }

  const handleDepartmentChange = (value: string) => {
    setDepartment(value)
    setEmployeeToAdd('')
    applyPayrollPeriod(getPayrollCycleForDepartment(value, departmentDefinitions))
  }

  const handlePayDateChange = (value: string) => {
    setPayDate(value)
    if (!value) return
    const nextRange = getPayrollRangeFromPayDate(payrollCycle, value)
    setStartDate(nextRange.startDate)
    setEndDate(nextRange.endDate)
  }

  const returnToSetup = () => {
    setStep('setup')
    setMessage(null)
  }

  const openPayoutConfirmation = () => {
    setConfirmStep('summary')
    setConfirmOpen(true)
  }

  const closePayoutConfirmation = (open: boolean) => {
    setConfirmOpen(open)
    if (!open) setConfirmStep('summary')
  }

  const buildWorksheet = () => {
    if (existingPayoutRun) {
      setMessage('A payroll payout already exists for this period. Open the saved payout summary to edit it instead of creating another payout.')
      openSavedSummary(existingPayoutRun.id)
      return
    }
    const nextRows = buildPayrollDraftRows({
      employees,
      clockRecords,
      eodReports,
      department,
      startDate,
      endDate,
      schedules,
    }).filter(row => row.hours > 0)
    setRows(sortPayrollRows(nextRows))
    setExcludedEmployeeIds([])
    setStep('worksheet')
    window.history.pushState({ wageWorksheetStep: 'worksheet' }, '', window.location.href)
    setMessage(null)
  }

  useEffect(() => {
    if (step !== 'worksheet') return
    const sourceRows = buildPayrollDraftRows({
      employees,
      clockRecords,
      eodReports,
      department,
      startDate,
      endDate,
      schedules,
    }).filter(row => row.hours > 0 && !excludedEmployeeIds.includes(row.employee_id))

    setRows(currentRows => {
      const nextRows = sortPayrollRows(mergeWorksheetRowsWithClockSource(currentRows, sourceRows))
      return arePayrollRowsEqual(currentRows, nextRows) ? currentRows : nextRows
    })
  }, [clockRecords, department, employees, endDate, eodReports, excludedEmployeeIds, schedules, startDate, step])

  const updateRow = (employeeId: string, patch: Partial<PayrollDraftRow>) => {
    setRows(currentRows => sortPayrollRows(currentRows.map(row => {
      if (row.employee_id !== employeeId) return row
      const employee = employees.find(item => item.id === employeeId)
      const hourlyRate = Number(employee?.hourly_wage ?? 0)
      const guaranteedRate = Number(employee?.guaranteed_hourly ?? 0)
      const next = { ...row, ...patch }
      if (employee?.commission_enabled !== true) {
        next.commission = 0
      }

      if (patch.hours !== undefined && patch.base_wages === undefined) {
        next.base_wages = normalizeMoney(next.hours * hourlyRate)
      }

      if (
        patch.guarantee_top_up === undefined &&
        (patch.hours !== undefined || patch.tips !== undefined || patch.base_wages !== undefined)
      ) {
        const guaranteeTarget = normalizeMoney(next.hours * guaranteedRate)
        next.guarantee_top_up = normalizeMoney(Math.max(0, guaranteeTarget - (next.base_wages + next.tips)))
      }

      return { ...next, ...calculatePayrollAmounts(next) }
    })))
  }

  const refreshWorksheetRow = (employeeId: string, nextClockRecords: ShiftClock[] = clockRecords) => {
    const employee = employees.find(item => item.id === employeeId)
    if (!employee) return
    const nextRows = buildPayrollDraftRows({
      employees: [employee],
      clockRecords: nextClockRecords,
      eodReports,
      department,
      startDate,
      endDate,
      schedules,
    })
    const nextRow = nextRows.find(row => row.employee_id === employeeId)
    if (!nextRow) return
    setRows(currentRows => sortPayrollRows(currentRows.map(row => {
      if (row.employee_id !== employeeId) return row
      const merged = {
        ...nextRow,
        payment_method: row.payment_method,
        commission: row.commission,
        deductions: row.deductions,
        memo: row.memo,
      }
      return { ...merged, ...calculatePayrollAmounts(merged) }
    })))
  }

  const openBreakReview = (employeeId: string) => {
    const records = getEmployeeClockRecords({ employeeId, clockRecords, employees, department, startDate, endDate, schedules })
    setBreakEdits(current => {
      const next = { ...current }
      for (const record of records) {
        const mealBreak = getMealBreakState(record)
        const regularBreak = getUnpaidBreakState(record)
        next[record.id] = {
          mealBreakStart: isoToTimeInput(mealBreak.startedAt),
          mealBreakEnd: isoToTimeInput(mealBreak.endedAt),
          regularBreakStart: isoToTimeInput(regularBreak.startedAt),
          regularBreakEnd: isoToTimeInput(regularBreak.endedAt),
        }
      }
      return next
    })
    setBreakReviewEmployeeId(employeeId)
  }

  const updateBreakEdit = (recordId: string, patch: Partial<BreakEditState>) => {
    const emptyEdit: BreakEditState = {
      mealBreakStart: '',
      mealBreakEnd: '',
      regularBreakStart: '',
      regularBreakEnd: '',
    }
    setBreakEdits(current => ({
      ...current,
      [recordId]: {
        ...(current[recordId] ?? emptyEdit),
        ...patch,
      },
    }))
  }

  const openSavedSummary = (runId: string) => {
    window.location.href = `/reporting/payroll-payouts?run=${encodeURIComponent(runId)}`
  }

  const updateSummaryItemEdit = (item: PayrollRunItem, patch: Partial<PayrollRunItem>) => {
    setSummaryItemEdits(current => ({
      ...current,
      [item.id]: calculateSavedPayrollItem(item, { ...current[item.id], ...patch }),
    }))
  }

  const saveSummaryEdit = async () => {
    if (!selectedSummaryRun) return
    const editedItems = [...(selectedSummaryRun.payroll_run_items ?? [])]
      .sort((left, right) => left.display_order - right.display_order || left.employee_name.localeCompare(right.employee_name))
      .map(item => summaryItemEdits[item.id] ? calculateSavedPayrollItem(item, summaryItemEdits[item.id]) : item)

    setSavingSummaryEdit(true)
    setMessage(null)
    try {
      const res = await fetch('/api/payroll-runs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: selectedSummaryRun.id,
          memo: summaryMemoEdit,
          rows: editedItems,
        }),
      })
      const payload = (await res.json().catch(() => ({}))) as { error?: string; run_id?: string; cash_entry_id?: string | null }
      if (!res.ok) throw new Error(payload.error ?? 'Failed to update payroll payout.')

      const updatedTotals = getPayrollTotals(editedItems.map(item => ({
        payment_method: item.payment_method ?? '',
        payout_amount: Number(item.payout_amount ?? 0),
        gross_pay: Number(item.gross_pay ?? 0),
        deductions: Number(item.deductions ?? 0),
        net_pay: Number(item.net_pay ?? 0),
      })))
      setPayrollRuns(currentRuns => currentRuns.map(run => run.id === selectedSummaryRun.id
        ? {
            ...run,
            memo: summaryMemoEdit.trim() || null,
            total_cash: updatedTotals.cash,
            total_check: updatedTotals.check,
            total_ach: updatedTotals.ach,
            total_gross: updatedTotals.gross,
            total_deductions: updatedTotals.deductions,
            total_net: updatedTotals.net,
            updated_at: new Date().toISOString(),
            payroll_run_items: editedItems,
          }
        : run
      ))

      const sheetSync = await fetch('/api/payroll-sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: selectedSummaryRun.id }),
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
      setSummaryItemEdits({})
      setEditingSummary(false)
      setMessage('Saved payroll payout updated.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to update payroll payout.')
    } finally {
      setSavingSummaryEdit(false)
    }
  }

  const saveBreakEdit = async (record: ShiftClock) => {
    const edit = breakEdits[record.id]
    if (!edit) return
    const mealBreakStartAt = timeInputToIso(record.session_date, edit.mealBreakStart)
    const mealBreakEndAt = timeInputToIso(record.session_date, edit.mealBreakEnd)
    const regularBreakStartAt = timeInputToIso(record.session_date, edit.regularBreakStart)
    const regularBreakEndAt = timeInputToIso(record.session_date, edit.regularBreakEnd)
    if (
      (mealBreakStartAt && mealBreakEndAt && new Date(mealBreakEndAt).getTime() <= new Date(mealBreakStartAt).getTime()) ||
      (regularBreakStartAt && regularBreakEndAt && new Date(regularBreakEndAt).getTime() <= new Date(regularBreakStartAt).getTime())
    ) {
      setMessage('Break end must be after break start.')
      return
    }

    setSavingBreakId(record.id)
    setMessage(null)
    try {
      const res = await fetch('/api/clock-events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: record.id,
          action: 'adjust',
          session_date: record.session_date,
          clock_in_at: record.clock_in_at,
          clock_out_at: record.clock_out_at,
          meal_break_started_at: mealBreakStartAt,
          meal_break_ended_at: mealBreakEndAt,
          meal_break_minutes: getBreakMinutes(mealBreakStartAt, mealBreakEndAt),
          unpaid_break_started_at: regularBreakStartAt,
          unpaid_break_ended_at: regularBreakEndAt,
          unpaid_break_minutes: getBreakMinutes(regularBreakStartAt, regularBreakEndAt),
          work_department: getClockWorkDepartment(record, getClockRecordEmployee(record, employees) ?? undefined),
          manager_note: record.manager_note,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { record?: ShiftClock; error?: string }
      if (!res.ok || !json.record) throw new Error(json.error ?? 'Failed to save break time.')
      const nextClockRecords = clockRecords.map(item => item.id === record.id ? json.record! : item)
      setClockRecords(nextClockRecords)
      refreshWorksheetRow(record.employee_id, nextClockRecords)
      const sheetSync = await fetch('/api/clock-records-sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record_id: json.record.id }),
      })
      if (!sheetSync.ok) {
        const payload = (await sheetSync.json().catch(() => ({}))) as { error?: string }
        throw new Error(payload.error ?? 'Break saved, but clock record Google Sheets sync failed.')
      }
      notifyReportingDataChanged()
      setMessage('Break time updated. Rebuild the worksheet if tip distribution changed for this date.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save break time.')
    } finally {
      setSavingBreakId(null)
    }
  }

  const removeRow = (employeeId: string) => {
    setExcludedEmployeeIds(current => current.includes(employeeId) ? current : [...current, employeeId])
    setRows(currentRows => currentRows.filter(row => row.employee_id !== employeeId))
  }

  const addEmployee = () => {
    const employee = employees.find(item => item.id === employeeToAdd)
    if (!employee) return
    const nextRows = buildPayrollDraftRows({
      employees: [employee],
      clockRecords,
      eodReports,
      department,
      startDate,
      endDate,
      schedules,
    })
    setRows(currentRows => sortPayrollRows([...currentRows, ...nextRows]))
    setExcludedEmployeeIds(current => current.filter(id => id !== employeeToAdd))
    setEmployeeToAdd('')
  }

  const getCurrentCashOnHand = async () => {
    const [{ data: reports, error: reportsError }, { data: cashEntries, error: cashEntriesError }] = await Promise.all([
      supabase.from('eod_reports').select('actual_cash_on_hand'),
      supabase.from('cash_balance_entries').select('entry_type, amount'),
    ])

    if (reportsError) throw reportsError
    if (cashEntriesError) throw cashEntriesError

    const eodCashTotal = (reports ?? []).reduce((sum, report) => (
      sum + Number((report as { actual_cash_on_hand?: number | null }).actual_cash_on_hand ?? 0)
    ), 0)
    const cashEntryTotal = ((cashEntries ?? []) as Array<Pick<CashBalanceEntry, 'entry_type' | 'amount'>>).reduce((sum, entry) => (
      sum + getSignedCashAmount(entry)
    ), 0)

    return normalizeMoney(eodCashTotal + cashEntryTotal)
  }

  useEffect(() => {
    if (!confirmOpen) return
    let mounted = true
    void (async () => {
      try {
        const cashOnHand = await getCurrentCashOnHand()
        if (mounted) setCashBalancePreview(cashOnHand)
      } catch {
        if (mounted) setCashBalancePreview(null)
      }
    })()
    return () => {
      mounted = false
    }
  }, [confirmOpen])

  const recordPayrollCashOut = async (runId: string) => {
    const cashTotal = normalizeMoney(totals.cash)
    if (cashTotal <= 0) {
      return { recorded: false, skipped: true, reason: 'No cash payout.' }
    }

    const departmentLabel = departmentOptions.find(option => option.key === department)?.label ?? department
    const cashPaidDetails = rows
      .filter(row => row.payment_method === 'cash' && row.payout_amount > 0)
      .map(row => `${row.employee_name} ${formatCurrency(row.payout_amount)}`)
      .join(', ')
    const description = [
      `Wage Worksheet cash payout - ${departmentLabel}`,
      `${startDate} to ${endDate}`,
      `Pay date ${payDate}`,
      `Run ${runId}`,
      `Total ${formatCurrency(cashTotal)}`,
      cashPaidDetails ? `Employees: ${cashPaidDetails}` : null,
      memo.trim() ? `Memo: ${memo.trim()}` : null,
    ].filter(Boolean).join(' | ')

    const { data: entry, error } = await supabase
      .from('cash_balance_entries')
      .insert({
        entry_date: payDate,
        entry_type: 'cash_out' as const,
        amount: cashTotal,
        description,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error || !entry) {
      return { recorded: false, skipped: false, error: error?.message ?? 'Failed to record payroll cash out.' }
    }

    const cashOnHand = await getCurrentCashOnHand()
    setCashBalancePreview(cashOnHand)
    const sheetSync = await fetch('/api/cash-balance-sheet-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry_id: (entry as CashBalanceEntry).id, cash_on_hand: cashOnHand }),
    })
    const sheetPayload = (await sheetSync.json().catch(() => ({}))) as {
      error?: string
      skipped?: boolean
      reason?: string
    }

    return {
      recorded: true,
      cashOnHand,
      skipped: sheetPayload.skipped === true,
      reason: sheetPayload.reason,
      error: sheetSync.ok ? undefined : sheetPayload.error ?? 'Cash log Google Sheets sync failed.',
    }
  }

  const savePayroll = async () => {
    if (missingPaymentRows.length > 0) {
      setMessage('Select a payment method for every employee before saving.')
      return
    }
    if (existingPayoutRun) {
      setMessage('A payroll payout already exists for this period. Open the saved payout summary to edit it instead of creating another payout.')
      openSavedSummary(existingPayoutRun.id)
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const payrollSave = await fetch('/api/payroll-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          department,
          start_date: startDate,
          end_date: endDate,
          pay_date: payDate,
          memo: memo.trim() || null,
          totals,
          rows,
        }),
      })
      const payrollSavePayload = (await payrollSave.json().catch(() => ({}))) as {
        error?: string
        run_id?: string
      }

      if (!payrollSave.ok || !payrollSavePayload.run_id) {
        throw new Error(payrollSavePayload.error ?? 'Failed to save payroll worksheet.')
      }

      const runId = payrollSavePayload.run_id

      const sheetSync = await fetch('/api/payroll-sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: runId }),
      })
      const sheetSyncPayload = (await sheetSync.json().catch(() => ({}))) as {
        error?: string
        payroll?: { success?: boolean; skipped?: boolean; reason?: string; sheetName?: string }
      }
      const cashOutResult = await recordPayrollCashOut(runId)
      const summaryEmail = await fetch('/api/send-payroll-summary-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: runId }),
      })
      const summaryEmailPayload = (await summaryEmail.json().catch(() => ({}))) as {
        error?: string
        skipped?: boolean
        reason?: string
      }

      notifyReportingDataChanged()
      setConfirmOpen(false)
      const notices = ['Payroll worksheet saved.']
      if (!sheetSync.ok) {
        notices.push(`Payroll Google Sheets sync failed${sheetSyncPayload.error ? `: ${sheetSyncPayload.error}` : '.'}`)
      } else if (sheetSyncPayload.payroll?.skipped) {
        notices.push(`Payroll Google Sheets sync skipped: ${sheetSyncPayload.payroll.reason ?? 'not configured.'}`)
      } else {
        notices.push(`Payroll synced to Google Sheets${sheetSyncPayload.payroll?.sheetName ? ` (${sheetSyncPayload.payroll.sheetName})` : ''}.`)
      }
      if (cashOutResult.recorded) {
        notices.push(`Cash payout was recorded as Cash Out. Current cash on hand: ${formatCurrency(cashOutResult.cashOnHand ?? 0)}.`)
        if (cashOutResult.error) {
          notices.push(`Cash log Google Sheets sync failed: ${cashOutResult.error}`)
        } else if (cashOutResult.skipped) {
          notices.push(`Cash log Google Sheets sync skipped: ${cashOutResult.reason ?? 'not configured.'}`)
        } else {
          notices.push('Cash log synced to Google Sheets.')
        }
      } else if (cashOutResult.error) {
        notices.push(`Cash payout was not recorded: ${cashOutResult.error}`)
      }
      if (!summaryEmail.ok) {
        notices.push(`Payroll summary email failed: ${summaryEmailPayload.error ?? 'unknown error'}`)
      } else if (summaryEmailPayload.skipped) {
        notices.push(`Payroll summary email skipped: ${summaryEmailPayload.reason ?? 'not configured.'}`)
      } else {
        notices.push('Payroll summary email sent.')
      }
      notices.push('Wage Report and Dashboard can now use this payroll run.')
      setMessage(notices.join(' '))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save payroll worksheet.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4">
      {message && (
        <div className="mb-4 rounded-xl border bg-slate-50 px-4 py-3 text-sm text-slate-700">{message}</div>
      )}

      {step === 'setup' ? (
        <div className="max-w-7xl overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="border-b bg-slate-950 px-5 py-4 text-white">
            <Link
              href="/admin"
              className="mb-2 inline-flex items-center gap-1.5 text-sm text-slate-300 transition-colors hover:text-white"
            >
              <ArrowLeft className="size-4" />
              Back to Admin Board
            </Link>
            <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Wage Worksheet</h2>
              </div>
              <div className="rounded-lg border border-white/20 px-3 py-1.5 text-right">
                <div className="text-xs uppercase text-slate-300">Selected Period</div>
                <div className="text-sm font-semibold">{startDate} to {endDate}</div>
              </div>
            </div>
          </div>

          <div className="p-5">
            <div className="grid gap-5 xl:grid-cols-[1.5fr_0.5fr]">
              <div className="space-y-3">
                <div className="grid gap-3 lg:grid-cols-3">
                  <div className="rounded-xl border bg-white p-4">
                    <div className="mb-3 flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white">1</div>
                      <div>
                        <h3 className="font-semibold text-slate-950">Department</h3>
                        <p className="text-xs text-muted-foreground">Choose staff group.</p>
                      </div>
                    </div>
                    <div className="grid gap-3">
                      <div>
                        <Label>Department</Label>
                        <Select value={department} onValueChange={(value: string | null) => value && handleDepartmentChange(value)}>
                          <SelectTrigger><span>{departmentOptions.find(option => option.key === department)?.label ?? department}</span></SelectTrigger>
                          <SelectContent>
                            {departmentOptions.map(option => (
                              <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Payroll Type</Label>
                        <div className="flex h-9 items-center rounded-md border border-input bg-slate-50 px-3 text-sm font-medium text-slate-700">
                          {payrollCycleLabel(payrollCycle)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border bg-white p-4">
                    <div className="mb-3 flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white">2</div>
                      <div>
                        <h3 className="font-semibold text-slate-950">Pay Date</h3>
                        <p className="text-xs text-muted-foreground">Generates period.</p>
                      </div>
                    </div>
                    <div>
                      <Label>Pay Date</Label>
                      <Input type="date" value={payDate} onChange={event => handlePayDateChange(event.target.value)} />
                    </div>
                  </div>

                  <div className="rounded-xl border bg-white p-4">
                    <div className="mb-3 flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white">3</div>
                      <div>
                        <h3 className="font-semibold text-slate-950">Pay Period Confirm</h3>
                        <p className="text-xs text-muted-foreground">Review or adjust range.</p>
                      </div>
                    </div>
                    <div className="grid gap-3">
                      <div>
                        <Label>Pay Range Start</Label>
                        <Input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} />
                      </div>
                      <div>
                        <Label>Pay Range End</Label>
                        <Input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border bg-white p-4">
                  <Label>Payroll Memo</Label>
                  <Textarea
                    className="min-h-20"
                    value={memo}
                    onChange={event => setMemo(event.target.value)}
                    placeholder="Special attention, payroll notes, or outside reporting reminders"
                  />
                </div>
              </div>

              <div className="rounded-xl border bg-slate-50 p-4 xl:sticky xl:top-4 xl:self-start">
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-semibold uppercase text-slate-500">Period Rule</p>
                    <p className="mt-1 text-base font-semibold text-slate-950">
                      {payrollCycle === 'weekly' ? 'Previous Mon-Sun week' : 'Previous half-month'}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      Changing the pay date updates the range. Managers can still edit the start and end dates.
                    </p>
                  </div>
                  <div className="grid gap-2 text-sm">
                    <div className="rounded-lg border bg-white p-2.5">
                      <div className="text-xs uppercase text-slate-400">Department</div>
                      <div className="mt-1 font-semibold text-slate-900">{departmentOptions.find(option => option.key === department)?.label ?? department}</div>
                    </div>
                    <div className="rounded-lg border bg-white p-2.5">
                      <div className="text-xs uppercase text-slate-400">Pay Type</div>
                      <div className="mt-1 font-semibold text-slate-900">{payrollCycleLabel(payrollCycle)}</div>
                    </div>
                    <div className="rounded-lg border bg-white p-2.5">
                      <div className="text-xs uppercase text-slate-400">Pay Date</div>
                      <div className="mt-1 font-semibold text-slate-900">{payDate || 'Select date'}</div>
                    </div>
                    <div className="rounded-lg border bg-white p-2.5">
                      <div className="text-xs uppercase text-slate-400">Range</div>
                      <div className="mt-1 font-semibold text-slate-900">{startDate && endDate ? `${startDate} to ${endDate}` : 'Select range'}</div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                    Payroll type is loaded from Roles & Departments for the selected department.
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <div>
                <p className="text-sm text-muted-foreground">Rows with zero recorded hours are skipped unless added manually.</p>
                {existingPayoutRun && (
                  <p className="mt-1 text-sm font-medium text-red-700">
                    Payout already saved for this period. Open the saved payout summary to edit it.
                  </p>
                )}
              </div>
              <Button className="min-w-32" onClick={buildWorksheet} disabled={!startDate || !endDate || !payDate || !!existingPayoutRun}>Next</Button>
            </div>
          </div>

          <div className="mt-4 rounded-xl border bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-slate-950">Saved Payroll Payouts</h3>
                <p className="text-xs text-muted-foreground">Search, reprint, and edit saved payouts from Reporting.</p>
              </div>
              <Link
                href="/reporting/payroll-payouts"
                className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Open Payroll Payouts
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={returnToSetup}>
                <ArrowLeft className="size-4" /> Back
              </Button>
              <Link
                href="/admin"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <ArrowLeft className="size-4" /> Admin Board
              </Link>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              {departmentOptions.find(option => option.key === department)?.label ?? department} | {startDate} to {endDate} | Pay date {payDate}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border bg-white p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Staff</p>
              <p className="mt-0.5 text-xl font-bold">{worksheetSummary.employeeCount}</p>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Hours</p>
              <p className="mt-0.5 text-xl font-bold">{worksheetSummary.hours.toFixed(2)}</p>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Tips</p>
              <p className="mt-0.5 text-xl font-bold">{formatCurrency(worksheetSummary.tips)}</p>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Base Wages</p>
              <p className="mt-0.5 text-xl font-bold">{formatCurrency(worksheetSummary.baseWages)}</p>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Top-Up</p>
              <p className="mt-0.5 text-xl font-bold">{formatCurrency(worksheetSummary.topUp)}</p>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Commission</p>
              <p className="mt-0.5 text-xl font-bold">{formatCurrency(worksheetSummary.commission)}</p>
            </div>
            <div className="rounded-lg border bg-emerald-50 p-3">
              <p className="text-xs font-medium uppercase text-emerald-700">Cash Payout</p>
              <p className="mt-0.5 text-xl font-bold text-emerald-950">{formatCurrency(totals.cash)}</p>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Check Payout</p>
              <p className="mt-0.5 text-xl font-bold">{formatCurrency(totals.check)}</p>
            </div>
            <div className="rounded-lg border bg-blue-50 p-3">
              <p className="text-xs font-medium uppercase text-blue-700">ACH Payout</p>
              <p className="mt-0.5 text-xl font-bold text-blue-950">{formatCurrency(totals.ach)}</p>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Net Payroll</p>
              <p className="mt-0.5 text-xl font-bold">{formatCurrency(totals.net)}</p>
              {totals.deductions > 0 && (
                <p className="mt-1 text-xs text-red-700">{formatCurrency(totals.deductions)} deducted</p>
              )}
            </div>
          </div>

          {hasClockFlags && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              One or more employees have auto-clock-out or open/pending clock records. Review Clock In Records before final payroll.
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-white p-2">
            <div className="min-w-64">
              <Label>Add Employee</Label>
              <Select value={employeeToAdd || undefined} onValueChange={(value: string | null) => value && setEmployeeToAdd(value)}>
                <SelectTrigger><span>{employees.find(employee => employee.id === employeeToAdd)?.name ?? 'Select staff'}</span></SelectTrigger>
                <SelectContent>
                  {availableEmployees.map(employee => (
                    <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={addEmployee} disabled={!employeeToAdd}>Add</Button>
            <Button
              onClick={openPayoutConfirmation}
              disabled={rows.length === 0 || missingPaymentRows.length > 0}
            >
              Payout
            </Button>
          </div>

          <div className="overflow-x-auto rounded-lg border bg-white">
            <Table className="min-w-[1280px] table-fixed border-collapse text-xs">
              <colgroup>
                <col className="w-28" />
                <col className="w-40" />
                <col className="w-28" />
                <col className="w-32" />
                <col className="w-20" />
                <col className="w-24" />
                <col className="w-24" />
                <col className="w-24" />
                <col className="w-28" />
                <col className="w-28" />
                <col className="w-28" />
                <col className="w-44" />
                <col className="w-24" />
              </colgroup>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead className="h-9 border-r px-2 py-1 align-middle">Paid By</TableHead>
                  <TableHead className="h-9 border-r px-2 py-1 align-middle">Name</TableHead>
                  <TableHead className="h-9 border-r px-2 py-1 align-middle">Status</TableHead>
                  <TableHead className="h-9 border-r px-2 py-1 align-middle">Breaktime Review</TableHead>
                  <TableHead className="h-9 border-r px-2 py-1 text-right align-middle">Hours</TableHead>
                  <TableHead className="h-9 border-r px-2 py-1 text-right align-middle">Tips</TableHead>
                  <TableHead className="h-9 border-r px-2 py-1 text-right align-middle">Base</TableHead>
                  <TableHead className="h-9 border-r px-2 py-1 text-right align-middle">Top-Up</TableHead>
                  <TableHead className="h-9 border-r px-2 py-1 text-right align-middle">Commission</TableHead>
                  <TableHead className="h-9 border-r px-2 py-1 text-right align-middle">Deductions</TableHead>
                  <TableHead className="h-9 border-r px-2 py-1 text-right align-middle">Payout</TableHead>
                  <TableHead className="h-9 border-r px-2 py-1 align-middle">Memo</TableHead>
                  <TableHead className="h-9 px-2 py-1 align-middle" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const employee = employees.find(item => item.id === row.employee_id)
                  const hourlyRate = Number(employee?.hourly_wage ?? 0)
                  const commissionAvailable = employee?.commission_enabled === true
                  const breakReviewCount = breakReviewCounts.get(row.employee_id) ?? 0

                  return (
                  <TableRow key={row.employee_id} className="border-b">
                    <TableCell className="border-r p-1 align-middle">
                      <Select value={row.payment_method || undefined} onValueChange={(value: string | null) => value && updateRow(row.employee_id, { payment_method: value as PaymentMethod })}>
                        <SelectTrigger className="h-8 w-full"><span>{paymentMethodLabel(row.payment_method)}</span></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="check">Check</SelectItem>
                          <SelectItem value="ach">ACH</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="border-r px-2 py-1 align-middle font-medium">{row.employee_name}</TableCell>
                    <TableCell className="border-r p-1 align-middle">
                      {row.has_open_clock ? (
                        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Clock Review</Badge>
                      ) : row.has_auto_clock_out ? (
                        <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-800">Auto Out</Badge>
                      ) : (
                        <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">Verified</Badge>
                      )}
                    </TableCell>
                    <TableCell className="border-r p-1 align-middle">
                      <Button
                        variant="outline"
                        size="sm"
                        className={breakReviewCount > 0 ? 'h-8 border-red-300 bg-red-50 text-red-700 hover:bg-red-100' : 'h-8'}
                        onClick={() => openBreakReview(row.employee_id)}
                      >
                        {breakReviewCount > 0 ? `${breakReviewCount} Review` : 'View'}
                      </Button>
                    </TableCell>
                    <TableCell className="border-r p-1 text-right align-middle">
                      <Input className="h-8 w-full text-right" type="number" step="0.01" value={row.hours} onChange={event => {
                        const hours = normalizeMoney(event.target.value)
                        updateRow(row.employee_id, { hours })
                      }} />
                    </TableCell>
                    <TableCell className="border-r p-1 align-middle">
                      <Input
                        className="h-8 w-full text-right"
                        type="number"
                        step="0.01"
                        value={row.has_tip_data || row.tips > 0 ? row.tips : ''}
                        onChange={event => updateRow(row.employee_id, { tips: normalizeMoney(event.target.value), has_tip_data: event.target.value.trim().length > 0 })}
                      />
                    </TableCell>
                    <TableCell className="border-r p-1 align-middle">
                      <Input className="h-8 w-full text-right" type="number" step="0.01" value={row.base_wages} onChange={event => updateRow(row.employee_id, { base_wages: normalizeMoney(event.target.value) })} />
                      <div className="mt-0.5 text-right text-[10px] leading-none text-muted-foreground">
                        {formatCurrency(hourlyRate)}/hr
                      </div>
                    </TableCell>
                    <TableCell className="border-r p-1 align-middle"><Input className="h-8 w-full text-right" type="number" step="0.01" value={row.guarantee_top_up} onChange={event => updateRow(row.employee_id, { guarantee_top_up: normalizeMoney(event.target.value) })} /></TableCell>
                    <TableCell className="border-r p-1 align-middle">
                      <Input
                        className="h-8 w-full text-right disabled:bg-slate-100"
                        type="number"
                        step="0.01"
                        value={commissionAvailable ? row.commission : 0}
                        disabled={!commissionAvailable}
                        title={commissionAvailable ? undefined : 'Commission unavailable for this staffing profile'}
                        onChange={event => updateRow(row.employee_id, { commission: normalizeMoney(event.target.value) })}
                      />
                      {!commissionAvailable && (
                        <div className="mt-0.5 text-right text-[10px] leading-none text-muted-foreground">Unavailable</div>
                      )}
                    </TableCell>
                    <TableCell className="border-r p-1 align-middle"><Input className="h-8 w-full text-right" type="number" step="0.01" value={row.deductions} onChange={event => updateRow(row.employee_id, { deductions: normalizeMoney(event.target.value) })} /></TableCell>
                    <TableCell className="border-r p-1 text-right align-middle font-semibold">
                      {formatCurrency(row.payout_amount)}
                      {row.payment_method === 'cash' && row.cash_rounding > 0 && (
                        <div className="text-[10px] leading-none text-muted-foreground">rounded {formatCurrency(row.cash_rounding)}</div>
                      )}
                    </TableCell>
                    <TableCell className="border-r p-1 align-middle"><Input className="h-8 w-full" value={row.memo} onChange={event => updateRow(row.employee_id, { memo: event.target.value })} /></TableCell>
                    <TableCell className="p-1 align-middle"><Button variant="ghost" size="sm" onClick={() => removeRow(row.employee_id)}>Remove</Button></TableCell>
                  </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <Dialog open={!!breakReviewEmployeeId} onOpenChange={(open) => { if (!open) setBreakReviewEmployeeId(null) }}>
        <DialogContent className="w-[calc(100vw-2rem)] !max-w-6xl max-h-[90vh] overflow-y-auto p-6">
          <DialogHeader>
            <DialogTitle>Breaktime Review</DialogTitle>
          </DialogHeader>
          {breakReviewRow && (
            <div className="space-y-4">
              <div className="rounded-xl border bg-slate-50 p-3">
                <p className="font-semibold text-slate-950">{breakReviewRow.employee_name}</p>
                <p className="text-xs text-muted-foreground">{startDate} to {endDate} | All clock records in this payroll period</p>
              </div>
              <div className="overflow-x-auto rounded-lg border bg-white">
                <Table className="min-w-[980px] text-xs">
                  <TableHeader>
                    <TableRow className="bg-slate-50 hover:bg-slate-50">
                      <TableHead>Date</TableHead>
                      <TableHead>Clock In</TableHead>
                      <TableHead>Clock Out</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Meal Start</TableHead>
                      <TableHead>Meal End</TableHead>
                      <TableHead>Break Start</TableHead>
                      <TableHead>Break End</TableHead>
                      <TableHead className="text-right">Unpaid Min</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Save</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {breakReviewRecords.map(record => {
                      const edit = breakEdits[record.id] ?? {
                        mealBreakStart: isoToTimeInput(getMealBreakState(record).startedAt),
                        mealBreakEnd: isoToTimeInput(getMealBreakState(record).endedAt),
                        regularBreakStart: isoToTimeInput(getUnpaidBreakState(record).startedAt),
                        regularBreakEnd: isoToTimeInput(getUnpaidBreakState(record).endedAt),
                      }
                      const mealStartAt = timeInputToIso(record.session_date, edit.mealBreakStart)
                      const mealEndAt = timeInputToIso(record.session_date, edit.mealBreakEnd)
                      const regularStartAt = timeInputToIso(record.session_date, edit.regularBreakStart)
                      const regularEndAt = timeInputToIso(record.session_date, edit.regularBreakEnd)
                      const editedBreakMinutes = getBreakMinutes(mealStartAt, mealEndAt) + getBreakMinutes(regularStartAt, regularEndAt)
                      const editedHours = record.clock_out_at
                        ? calculateClockHoursAfterBreak(record.clock_in_at, record.clock_out_at, editedBreakMinutes)
                        : 0
                      const needsReview = shouldWarnMissingMealBreak(record, employees.find(employee => employee.id === record.employee_id))

                      return (
                        <TableRow key={record.id} className={needsReview ? 'bg-red-50/50' : undefined}>
                          <TableCell>{record.session_date}</TableCell>
                          <TableCell>{formatTime(record.clock_in_at)}</TableCell>
                          <TableCell>{formatTime(record.clock_out_at)}</TableCell>
                          <TableCell>
                            {needsReview ? (
                              <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700">Review</Badge>
                            ) : (
                              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">Logged</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Input className="h-8" type="time" value={edit.mealBreakStart} onChange={event => updateBreakEdit(record.id, { mealBreakStart: event.target.value })} />
                          </TableCell>
                          <TableCell>
                            <Input className="h-8" type="time" value={edit.mealBreakEnd} onChange={event => updateBreakEdit(record.id, { mealBreakEnd: event.target.value })} />
                          </TableCell>
                          <TableCell>
                            <Input className="h-8" type="time" value={edit.regularBreakStart} onChange={event => updateBreakEdit(record.id, { regularBreakStart: event.target.value })} />
                          </TableCell>
                          <TableCell>
                            <Input className="h-8" type="time" value={edit.regularBreakEnd} onChange={event => updateBreakEdit(record.id, { regularBreakEnd: event.target.value })} />
                          </TableCell>
                          <TableCell className="text-right">{editedBreakMinutes}</TableCell>
                          <TableCell className="text-right">{editedHours.toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" onClick={() => void saveBreakEdit(record)} disabled={savingBreakId === record.id}>
                              {savingBreakId === record.id ? 'Saving...' : 'Save'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    {breakReviewRecords.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={11} className="py-6 text-center text-muted-foreground">No clock records found for this employee in the worksheet period.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedSummaryRun} onOpenChange={(open) => { if (!open) setSummaryRunId(null) }}>
        <DialogContent className="w-[calc(100vw-2rem)] !max-w-5xl max-h-[90vh] overflow-y-auto p-6">
          <DialogHeader>
            <DialogTitle>Saved Payroll Summary</DialogTitle>
          </DialogHeader>
          {selectedSummaryRun && selectedSummary && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={selectedSummaryRunIndex < 0 || selectedSummaryRunIndex >= recentPayrollRuns.length - 1}
                    onClick={() => {
                      const nextRun = recentPayrollRuns[selectedSummaryRunIndex + 1]
                      if (nextRun) openSavedSummary(nextRun.id)
                    }}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={selectedSummaryRunIndex <= 0}
                    onClick={() => {
                      const nextRun = recentPayrollRuns[selectedSummaryRunIndex - 1]
                      if (nextRun) openSavedSummary(nextRun.id)
                    }}
                  >
                    Next
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant={summaryView === 'department' ? 'default' : 'outline'} size="sm" onClick={() => setSummaryView('department')}>Department</Button>
                  <Button variant={summaryView === 'individual' ? 'default' : 'outline'} size="sm" onClick={() => setSummaryView('individual')}>Individual</Button>
                  <Button variant={editingSummary ? 'default' : 'outline'} size="sm" onClick={() => setEditingSummary(value => !value)}>
                    {editingSummary ? 'Editing' : 'Edit'}
                  </Button>
                  {summaryView === 'individual' && (
                    <Select value={summaryEmployeeId === 'all' ? undefined : summaryEmployeeId} onValueChange={(value: string | null) => value && setSummaryEmployeeId(value)}>
                      <SelectTrigger className="h-8 w-48">
                        <span>{selectedSummaryItem?.employee_name ?? 'Select employee'}</span>
                      </SelectTrigger>
                      <SelectContent>
                        {[...(selectedSummaryRun.payroll_run_items ?? [])]
                          .sort((left, right) => left.display_order - right.display_order || left.employee_name.localeCompare(right.employee_name))
                          .map(item => (
                            <SelectItem key={item.id} value={item.employee_id ?? item.employee_name}>{item.employee_name}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2 rounded-xl border bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Badge variant="outline" className="border-emerald-300 bg-white text-emerald-800">Payout Saved</Badge>
                  <p className="mt-2 text-sm font-semibold text-slate-950">
                    {departmentOptions.find(option => option.key === selectedSummaryRun.department)?.label ?? selectedSummaryRun.department} | {selectedSummaryRun.start_date} to {selectedSummaryRun.end_date}
                  </p>
                  <p className="text-xs text-slate-600">
                    Pay date {selectedSummaryRun.pay_date} | Created {format(new Date(selectedSummaryRun.created_at), 'MMM d, yyyy h:mm a')}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-xs font-semibold uppercase text-emerald-700">Total Payout</p>
                  <p className="text-2xl font-bold text-emerald-950">{formatCurrency(selectedSummary.net)}</p>
                </div>
              </div>

              {selectedSummaryRun.memo && (
                <div className="rounded-xl border bg-slate-50 p-3 text-sm text-slate-700">
                  <span className="font-semibold text-slate-950">Memo: </span>{selectedSummaryRun.memo}
                </div>
              )}
              {editingSummary && (
                <div className="rounded-xl border bg-white p-3">
                  <Label>Payroll Memo</Label>
                  <Textarea value={summaryMemoEdit} onChange={event => setSummaryMemoEdit(event.target.value)} />
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-lg border bg-white p-3">
                  <div className="text-xs uppercase text-muted-foreground">Staff</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{selectedSummary.employeeCount}</div>
                </div>
                <div className="rounded-lg border bg-white p-3">
                  <div className="text-xs uppercase text-muted-foreground">Hours</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{selectedSummary.hours.toFixed(2)}</div>
                </div>
                <div className="rounded-lg border bg-white p-3">
                  <div className="text-xs uppercase text-muted-foreground">Tips</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{formatCurrency(selectedSummary.tips)}</div>
                </div>
                <div className="rounded-lg border bg-white p-3">
                  <div className="text-xs uppercase text-muted-foreground">Base Wages</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{formatCurrency(selectedSummary.baseWages)}</div>
                </div>
                <div className="rounded-lg border bg-white p-3">
                  <div className="text-xs uppercase text-muted-foreground">Top-Up</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{formatCurrency(selectedSummary.topUp)}</div>
                </div>
                <div className="rounded-lg border bg-white p-3">
                  <div className="text-xs uppercase text-muted-foreground">Commission</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{formatCurrency(selectedSummary.commission)}</div>
                </div>
                <div className="rounded-lg border bg-emerald-50 p-3">
                  <div className="text-xs uppercase text-emerald-700">Cash</div>
                  <div className="mt-1 text-xl font-bold text-emerald-950">{formatCurrency(selectedSummary.cash)}</div>
                </div>
                <div className="rounded-lg border bg-white p-3">
                  <div className="text-xs uppercase text-muted-foreground">Check</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{formatCurrency(selectedSummary.check)}</div>
                </div>
                <div className="rounded-lg border bg-blue-50 p-3">
                  <div className="text-xs uppercase text-blue-700">ACH</div>
                  <div className="mt-1 text-xl font-bold text-blue-950">{formatCurrency(selectedSummary.ach)}</div>
                </div>
                <div className="rounded-lg border bg-white p-3">
                  <div className="text-xs uppercase text-muted-foreground">Deductions</div>
                  <div className="mt-1 text-xl font-bold text-red-700">{formatCurrency(selectedSummary.deductions)}</div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border bg-white">
                <Table className="min-w-[980px] text-xs">
                  <TableHeader>
                    <TableRow className="bg-slate-50 hover:bg-slate-50">
                      <TableHead>Paid By</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Tips</TableHead>
                      <TableHead className="text-right">Base</TableHead>
                      <TableHead className="text-right">Top-Up</TableHead>
                      <TableHead className="text-right">Commission</TableHead>
                      <TableHead className="text-right">Deductions</TableHead>
                      <TableHead className="text-right">Payout</TableHead>
                      <TableHead>Memo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedSummaryItems.map(item => (
                        <TableRow key={item.id}>
                          <TableCell>
                            {editingSummary ? (
                              <Select value={item.payment_method ?? undefined} onValueChange={(value: string | null) => value && updateSummaryItemEdit(item, { payment_method: value as PaymentMethod })}>
                                <SelectTrigger className="h-8 w-28"><span>{paymentMethodLabel(item.payment_method)}</span></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="cash">Cash</SelectItem>
                                  <SelectItem value="check">Check</SelectItem>
                                  <SelectItem value="ach">ACH</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : paymentMethodLabel(item.payment_method)}
                          </TableCell>
                          <TableCell className="font-medium">{item.employee_name}</TableCell>
                          <TableCell>{departmentOptions.find(option => option.key === item.department)?.label ?? item.department}</TableCell>
                          <TableCell className="text-right">{Number(item.hours ?? 0).toFixed(2)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(Number(item.tips ?? 0))}</TableCell>
                          <TableCell className="text-right">{formatCurrency(Number(item.base_wages ?? 0))}</TableCell>
                          <TableCell className="text-right">{formatCurrency(Number(item.guarantee_top_up ?? 0))}</TableCell>
                          <TableCell className="text-right">
                            {editingSummary ? (
                              <Input className="h-8 text-right" type="number" step="0.01" value={Number(item.commission ?? 0)} onChange={event => updateSummaryItemEdit(item, { commission: normalizeMoney(event.target.value) })} />
                            ) : formatCurrency(Number(item.commission ?? 0))}
                          </TableCell>
                          <TableCell className="text-right text-red-700">
                            {editingSummary ? (
                              <Input className="h-8 text-right" type="number" step="0.01" value={Number(item.deductions ?? 0)} onChange={event => updateSummaryItemEdit(item, { deductions: normalizeMoney(event.target.value) })} />
                            ) : formatCurrency(Number(item.deductions ?? 0))}
                          </TableCell>
                          <TableCell className="text-right font-semibold">{formatCurrency(Number(item.payout_amount ?? 0))}</TableCell>
                          <TableCell>
                            {editingSummary ? (
                              <Input className="h-8" value={item.memo || ''} onChange={event => updateSummaryItemEdit(item, { memo: event.target.value })} />
                            ) : item.memo || ''}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>

              {editingSummary && (
                <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-amber-900">
                    Editing this saved payout updates the original payroll record. If cash payout changes, a cash in/out adjustment will be recorded.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setEditingSummary(false); setSummaryItemEdits({}); setSummaryMemoEdit(selectedSummaryRun.memo ?? '') }} disabled={savingSummaryEdit}>Cancel</Button>
                    <Button size="sm" onClick={() => void saveSummaryEdit()} disabled={savingSummaryEdit}>{savingSummaryEdit ? 'Saving...' : 'Save Changes'}</Button>
                  </div>
                </div>
              )}

              {summaryView === 'individual' && selectedSummaryItem && (
                <div className="overflow-x-auto rounded-lg border bg-white">
                  <div className="border-b bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-950">
                    {selectedSummaryItem.employee_name} Time Records
                  </div>
                  <Table className="min-w-[900px] text-xs">
                    <TableHeader>
                      <TableRow className="bg-slate-50 hover:bg-slate-50">
                        <TableHead>Date</TableHead>
                        <TableHead>Clock In</TableHead>
                        <TableHead>Clock Out</TableHead>
                        <TableHead>Meal Break</TableHead>
                        <TableHead>Regular Break</TableHead>
                        <TableHead className="text-right">Unpaid Min</TableHead>
                        <TableHead className="text-right">Worked Hours</TableHead>
                        <TableHead className="text-right">Daily Payout</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedSummaryClockRecords.map(record => {
                        const mealBreak = getMealBreakState(record)
                        const regularBreak = getUnpaidBreakState(record)
                        const hours = getEffectiveClockHours(record)
                        return (
                          <TableRow key={record.id}>
                            <TableCell>{record.session_date}</TableCell>
                            <TableCell>{formatTime(record.clock_in_at)}</TableCell>
                            <TableCell>{formatTime(record.clock_out_at)}</TableCell>
                            <TableCell>{mealBreak.startedAt ? `${formatTime(mealBreak.startedAt)} - ${formatTime(mealBreak.endedAt)} (${mealBreak.minutes}m)` : ''}</TableCell>
                            <TableCell>{regularBreak.startedAt ? `${formatTime(regularBreak.startedAt)} - ${formatTime(regularBreak.endedAt)} (${regularBreak.minutes}m)` : ''}</TableCell>
                            <TableCell className="text-right">{getClockBreakMinutes(record)}</TableCell>
                            <TableCell className="text-right">{hours.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-semibold">{formatCurrency(calculateDailyPayout(selectedSummaryItem, hours))}</TableCell>
                          </TableRow>
                        )
                      })}
                      {selectedSummaryClockRecords.length > 0 && (
                        <TableRow className="bg-slate-50 font-semibold">
                          <TableCell colSpan={5}>Total</TableCell>
                          <TableCell className="text-right">{selectedSummaryClockRecords.reduce((sum, record) => sum + getClockBreakMinutes(record), 0)}</TableCell>
                          <TableCell className="text-right">{selectedSummaryClockRecords.reduce((sum, record) => sum + getEffectiveClockHours(record), 0).toFixed(2)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(selectedSummaryClockRecords.reduce((sum, record) => sum + calculateDailyPayout(selectedSummaryItem, getEffectiveClockHours(record)), 0))}</TableCell>
                        </TableRow>
                      )}
                      {selectedSummaryClockRecords.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">No matching time records found for this saved payout period.</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={closePayoutConfirmation}>
        <DialogContent className="w-[calc(100vw-2rem)] !max-w-4xl p-6">
          <DialogHeader>
            <DialogTitle>{confirmStep === 'summary' ? 'Payout Summary' : 'Confirm Save Payroll'}</DialogTitle>
          </DialogHeader>
          {confirmStep === 'summary' ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-lg border bg-white p-3">
                  <div className="text-xs uppercase text-muted-foreground">Staff</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{worksheetSummary.employeeCount}</div>
                </div>
                <div className="rounded-lg border bg-white p-3">
                  <div className="text-xs uppercase text-muted-foreground">Hours</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{worksheetSummary.hours.toFixed(2)}</div>
                </div>
                <div className="rounded-lg border bg-white p-3">
                  <div className="text-xs uppercase text-muted-foreground">Tips</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{formatCurrency(worksheetSummary.tips)}</div>
                </div>
                <div className="rounded-lg border bg-white p-3">
                  <div className="text-xs uppercase text-muted-foreground">Base Wages</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{formatCurrency(worksheetSummary.baseWages)}</div>
                </div>
                <div className="rounded-lg border bg-white p-3">
                  <div className="text-xs uppercase text-muted-foreground">Top-Up</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{formatCurrency(worksheetSummary.topUp)}</div>
                </div>
                <div className="rounded-lg border bg-white p-3">
                  <div className="text-xs uppercase text-muted-foreground">Commission</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{formatCurrency(worksheetSummary.commission)}</div>
                </div>
                <div className="rounded-lg border bg-emerald-50 p-3">
                  <div className="text-xs uppercase text-emerald-700">Cash Payout</div>
                  <div className="mt-1 text-xl font-bold text-emerald-950">{formatCurrency(totals.cash)}</div>
                </div>
                <div className="rounded-lg border bg-red-50 p-3">
                  <div className="text-xs uppercase text-red-700">Cash After Payout</div>
                  <div className="mt-1 text-xl font-bold text-red-950">
                    {cashBalancePreview == null ? 'Loading...' : formatCurrency(cashBalancePreview - totals.cash)}
                  </div>
                </div>
                <div className="rounded-lg border bg-white p-3">
                  <div className="text-xs uppercase text-muted-foreground">Check Payout</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{formatCurrency(totals.check)}</div>
                </div>
                <div className="rounded-lg border bg-blue-50 p-3">
                  <div className="text-xs uppercase text-blue-700">ACH Payout</div>
                  <div className="mt-1 text-xl font-bold text-blue-950">{formatCurrency(totals.ach)}</div>
                </div>
                <div className="rounded-lg border bg-white p-3">
                  <div className="text-xs uppercase text-muted-foreground">Net Payroll</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{formatCurrency(totals.net)}</div>
                </div>
              </div>
              <div className="grid gap-3 rounded-xl border bg-slate-50 p-4 text-sm sm:grid-cols-3">
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Gross</div>
                  <div className="mt-1 font-semibold text-slate-950">{formatCurrency(totals.gross)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Deductions</div>
                  <div className="mt-1 font-semibold text-red-700">{formatCurrency(totals.deductions)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Net</div>
                  <div className="mt-1 font-semibold text-slate-950">{formatCurrency(totals.net)}</div>
                </div>
              </div>
              {totals.cash > 0 && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                  Saving this worksheet records a Cash Out for {formatCurrency(totals.cash)} in EOD History / Cash In-Out with a wage worksheet note.
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-950">Final confirmation before saving payroll payout</p>
                <p className="mt-1 text-sm text-amber-900">
                  This creates a saved payroll payout for {departmentOptions.find(option => option.key === department)?.label ?? department}, {startDate} to {endDate}, with pay date {payDate}.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border bg-white p-3">
                  <div className="text-xs uppercase text-muted-foreground">Employees</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{worksheetSummary.employeeCount}</div>
                </div>
                <div className="rounded-lg border bg-emerald-50 p-3">
                  <div className="text-xs uppercase text-emerald-700">Cash Out</div>
                  <div className="mt-1 text-xl font-bold text-emerald-950">{formatCurrency(totals.cash)}</div>
                </div>
                <div className="rounded-lg border bg-white p-3">
                  <div className="text-xs uppercase text-muted-foreground">Non-Cash</div>
                  <div className="mt-1 text-xl font-bold text-slate-950">{formatCurrency(totals.check + totals.ach)}</div>
                </div>
                <div className="rounded-lg border bg-slate-950 p-3 text-white">
                  <div className="text-xs uppercase text-slate-300">Total Payout</div>
                  <div className="mt-1 text-xl font-bold">{formatCurrency(totals.net)}</div>
                </div>
              </div>
              <div className="rounded-xl border bg-white p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-950">When confirmed, the system will:</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border bg-slate-50 p-3">Create the saved payroll payout record.</div>
                  <div className="rounded-lg border bg-slate-50 p-3">Save each employee payout line and paid-by method.</div>
                  <div className="rounded-lg border bg-slate-50 p-3">Record cash payout as Cash Out when cash total is above $0.</div>
                  <div className="rounded-lg border bg-slate-50 p-3">Sync payroll and cash log to Google Sheets, then email the admin summary.</div>
                </div>
              </div>
              {hasClockFlags && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  Clock review still exists on this worksheet. Confirm only if these records are intentionally ready for payout.
                </div>
              )}
            </div>
          )}
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <Button className="w-full sm:w-auto" variant="outline" onClick={() => printSummary({ rows, totals, startDate, endDate, payDate, department, memo, clockRecords, employees, schedules })}>Print Summary</Button>
            {confirmStep === 'summary' ? (
              <Button className="w-full sm:w-auto" onClick={() => setConfirmStep('final')}>Continue</Button>
            ) : (
              <>
                <Button className="w-full sm:w-auto" variant="outline" onClick={() => setConfirmStep('summary')} disabled={saving}>Back</Button>
                <Button className="w-full sm:w-auto" onClick={savePayroll} disabled={saving}>{saving ? 'Saving...' : 'Confirm & Save Payroll'}</Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
