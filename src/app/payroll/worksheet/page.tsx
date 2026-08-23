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
import { useClockRecords, useEmployees, useEodReports, notifyReportingDataChanged } from '@/components/reporting/useReportingData'
import { supabase } from '@/lib/supabase'
import { shouldWarnMissingMealBreak } from '@/lib/clockUtils'
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
import { PaymentMethod } from '@/lib/types'
import { DepartmentDefinition } from '@/lib/appSettings'

type Step = 'setup' | 'worksheet'
type PayrollCycle = 'weekly' | 'semi_monthly'

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

function sortPayrollRows(rows: PayrollDraftRow[]) {
  const order = { cash: 0, check: 1, ach: 2, '': 3 }
  return [...rows].sort((a, b) => {
    const left = order[a.payment_method]
    const right = order[b.payment_method]
    return left - right || a.employee_name.localeCompare(b.employee_name)
  }).map((row, index) => ({ ...row, display_order: index }))
}

function printSummary({
  rows,
  totals,
  startDate,
  endDate,
  payDate,
  department,
  memo,
}: {
  rows: PayrollDraftRow[]
  totals: ReturnType<typeof getPayrollTotals>
  startDate: string
  endDate: string
  payDate: string
  department: string
  memo: string
}) {
  const printWindow = window.open('', '_blank', 'width=1200,height=800')
  if (!printWindow) return

  printWindow.document.write(`
    <html>
      <head>
        <title>Payroll Summary</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #111827; }
          h1 { margin: 0 0 4px; }
          .muted { color: #64748b; font-size: 12px; }
          .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 18px 0; }
          .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; }
          .metric { font-size: 22px; font-weight: 800; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #cbd5e1; padding: 7px; text-align: left; }
          th { background: #f1f5f9; }
          .right { text-align: right; }
          .note { margin: 14px 0; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; white-space: pre-wrap; }
        </style>
      </head>
      <body>
        <h1>Payroll Summary</h1>
        <div class="muted">${department.toUpperCase()} | ${startDate} - ${endDate} | Pay date ${payDate}</div>
        ${memo ? `<div class="note">${memo}</div>` : ''}
        <div class="cards">
          <div class="card"><div class="muted">Cash</div><div class="metric">${formatCurrency(totals.cash)}</div></div>
          <div class="card"><div class="muted">Check</div><div class="metric">${formatCurrency(totals.check)}</div></div>
          <div class="card"><div class="muted">ACH</div><div class="metric">${formatCurrency(totals.ach)}</div></div>
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
                <td>${paymentMethodLabel(row.payment_method)}</td>
                <td>${row.employee_name}</td>
                <td class="right">${row.hours.toFixed(2)}</td>
                <td class="right">${formatCurrency(row.tips)}</td>
                <td class="right">${formatCurrency(row.commission)}</td>
                <td class="right">${formatCurrency(row.deductions)}</td>
                <td class="right">${formatCurrency(row.net_pay)}</td>
                <td class="right">${formatCurrency(row.payout_amount)}</td>
                <td>${row.memo}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </body>
    </html>
  `)
  printWindow.document.close()
  printWindow.focus()
  printWindow.print()
}

export default function WageWorksheetPage() {
  const employees = useEmployees()
  const { clockRecords } = useClockRecords()
  const { eodReports } = useEodReports()
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
  const [employeeToAdd, setEmployeeToAdd] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
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
  const missingPaymentRows = rows.filter(row => !row.payment_method)
  const hasClockFlags = rows.some(row => row.has_auto_clock_out || row.has_open_clock)
  const breakReviewCounts = useMemo(() => {
    const employeeById = new Map(employees.map(employee => [employee.id, employee]))
    const counts = new Map<string, number>()
    for (const record of clockRecords) {
      if (record.session_date < startDate || record.session_date > endDate) continue
      if (shouldWarnMissingMealBreak(record, employeeById.get(record.employee_id))) {
        counts.set(record.employee_id, (counts.get(record.employee_id) ?? 0) + 1)
      }
    }
    return counts
  }, [clockRecords, employees, startDate, endDate])
  const availableEmployees = employees.filter(employee => {
    if (rows.some(row => row.employee_id === employee.id)) return false
    return department === 'all' || getEmployeeScheduleDepartments(employee).includes(department)
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

  const buildWorksheet = () => {
    const nextRows = buildPayrollDraftRows({
      employees,
      clockRecords,
      eodReports,
      department,
      startDate,
      endDate,
    }).filter(row => row.hours > 0)
    setRows(sortPayrollRows(nextRows))
    setStep('worksheet')
    window.history.pushState({ wageWorksheetStep: 'worksheet' }, '', window.location.href)
    setMessage(null)
  }

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

  const removeRow = (employeeId: string) => {
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
    })
    setRows(currentRows => sortPayrollRows([...currentRows, ...nextRows]))
    setEmployeeToAdd('')
  }

  const savePayroll = async () => {
    if (missingPaymentRows.length > 0) {
      setMessage('Select a payment method for every employee before saving.')
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const runInsert = await supabase
        .from('payroll_runs')
        .insert({
          department,
          start_date: startDate,
          end_date: endDate,
          pay_date: payDate,
          memo: memo.trim() || null,
          total_cash: totals.cash,
          total_check: totals.check,
          total_ach: totals.ach,
          total_gross: totals.gross,
          total_deductions: totals.deductions,
          total_net: totals.net,
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (runInsert.error) throw runInsert.error

      const runId = runInsert.data.id as string
      const itemInsert = await supabase.from('payroll_run_items').insert(rows.map((row, index) => ({
        run_id: runId,
        employee_id: row.employee_id || null,
        employee_name: row.employee_name,
        role: row.role || null,
        department: row.department,
        payment_method: row.payment_method,
        hours: row.hours,
        tips: row.tips,
        base_wages: row.base_wages,
        guarantee_top_up: row.guarantee_top_up,
        commission: row.commission,
        deductions: row.deductions,
        gross_pay: row.gross_pay,
        net_pay: row.net_pay,
        payout_amount: row.payout_amount,
        cash_rounding: row.cash_rounding,
        has_auto_clock_out: row.has_auto_clock_out,
        has_open_clock: row.has_open_clock,
        memo: row.memo.trim() || null,
        display_order: index,
      })))

      if (itemInsert.error) throw itemInsert.error

      const sheetSync = await fetch('/api/payroll-sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: runId }),
      })
      const sheetSyncPayload = (await sheetSync.json().catch(() => ({}))) as {
        error?: string
        payroll?: { success?: boolean; skipped?: boolean; reason?: string; sheetName?: string }
      }

      notifyReportingDataChanged()
      setConfirmOpen(false)
      if (!sheetSync.ok) {
        setMessage(`Payroll worksheet saved, but Google Sheets sync failed${sheetSyncPayload.error ? `: ${sheetSyncPayload.error}` : '.'}`)
      } else if (sheetSyncPayload.payroll?.skipped) {
        setMessage(`Payroll worksheet saved. Google Sheets sync skipped: ${sheetSyncPayload.payroll.reason ?? 'not configured.'}`)
      } else {
        setMessage(`Payroll worksheet saved and synced to Google Sheets${sheetSyncPayload.payroll?.sheetName ? ` (${sheetSyncPayload.payroll.sheetName})` : ''}. Wage Report and Dashboard can now use this payroll run.`)
      }
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
                <h2 className="text-xl font-semibold">Create Payroll Worksheet</h2>
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
              <p className="text-sm text-muted-foreground">Rows with zero recorded hours are skipped unless added manually.</p>
              <Button className="min-w-32" onClick={buildWorksheet} disabled={!startDate || !endDate || !payDate}>Next</Button>
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

          <div className="grid gap-2 md:grid-cols-4">
            <div className="rounded-lg border bg-white p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Cash Total</p>
              <p className="mt-0.5 text-xl font-bold">{formatCurrency(totals.cash)}</p>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Check Total</p>
              <p className="mt-0.5 text-xl font-bold">{formatCurrency(totals.check)}</p>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">ACH Total</p>
              <p className="mt-0.5 text-xl font-bold">{formatCurrency(totals.ach)}</p>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Deductions</p>
              <p className="mt-0.5 text-xl font-bold text-red-700">{formatCurrency(totals.deductions)}</p>
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
              onClick={() => setConfirmOpen(true)}
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
                      {breakReviewCount > 0 ? (
                        <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700">{breakReviewCount} Review</Badge>
                      ) : (
                        <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">Clear</Badge>
                      )}
                    </TableCell>
                    <TableCell className="border-r p-1 text-right align-middle">
                      <Input className="h-8 w-full text-right" type="number" step="0.01" value={row.hours} onChange={event => {
                        const hours = normalizeMoney(event.target.value)
                        updateRow(row.employee_id, { hours })
                      }} />
                    </TableCell>
                    <TableCell className="border-r p-1 align-middle"><Input className="h-8 w-full text-right" type="number" step="0.01" value={row.tips} onChange={event => updateRow(row.employee_id, { tips: normalizeMoney(event.target.value) })} /></TableCell>
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

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] !max-w-4xl p-6">
          <DialogHeader>
            <DialogTitle>Payout Summary</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="flex min-w-0 items-center justify-between gap-4 rounded-xl border bg-emerald-50 p-4">
              <p className="text-sm font-semibold uppercase text-emerald-700">Cash</p>
              <p className="text-right text-2xl font-bold leading-none text-emerald-950">{formatCurrency(totals.cash)}</p>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-4 rounded-xl border bg-slate-50 p-4">
              <p className="text-sm font-semibold uppercase text-slate-500">Check</p>
              <p className="text-right text-2xl font-bold leading-none text-slate-950">{formatCurrency(totals.check)}</p>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-4 rounded-xl border bg-blue-50 p-4">
              <p className="text-sm font-semibold uppercase text-blue-700">ACH</p>
              <p className="text-right text-2xl font-bold leading-none text-blue-950">{formatCurrency(totals.ach)}</p>
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
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => printSummary({ rows, totals, startDate, endDate, payDate, department, memo })}>Print Summary</Button>
            <Button onClick={savePayroll} disabled={saving}>{saving ? 'Saving…' : 'Save Worksheet'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
