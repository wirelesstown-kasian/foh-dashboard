'use client'

import { useMemo, useState } from 'react'
import { addWeeks, endOfWeek, format, startOfWeek } from 'date-fns'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useAppSettings } from '@/components/useAppSettings'
import { useClockRecords, useEmployees, useEodReports, notifyReportingDataChanged } from '@/components/reporting/useReportingData'
import { supabase } from '@/lib/supabase'
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

type Step = 'setup' | 'worksheet'

function defaultWeekStart() {
  return format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

function defaultWeekEnd() {
  return format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

function nextFriday() {
  return format(addWeeks(endOfWeek(new Date(), { weekStartsOn: 1 }), 1), 'yyyy-MM-dd')
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
  const [step, setStep] = useState<Step>('setup')
  const [department, setDepartment] = useState('all')
  const [startDate, setStartDate] = useState(defaultWeekStart)
  const [endDate, setEndDate] = useState(defaultWeekEnd)
  const [payDate, setPayDate] = useState(nextFriday)
  const [memo, setMemo] = useState('')
  const [rows, setRows] = useState<PayrollDraftRow[]>([])
  const [employeeToAdd, setEmployeeToAdd] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

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
  const availableEmployees = employees.filter(employee => !rows.some(row => row.employee_id === employee.id))

  const buildWorksheet = () => {
    const nextRows = buildPayrollDraftRows({
      employees,
      clockRecords,
      eodReports,
      department,
      startDate,
      endDate,
    })
    setRows(sortPayrollRows(nextRows))
    setStep('worksheet')
    setMessage(null)
  }

  const updateRow = (employeeId: string, patch: Partial<PayrollDraftRow>) => {
    setRows(currentRows => sortPayrollRows(currentRows.map(row => {
      if (row.employee_id !== employeeId) return row
      const next = { ...row, ...patch }
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
      department: 'all',
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

      notifyReportingDataChanged()
      setConfirmOpen(false)
      setMessage('Payroll worksheet saved. Wage Report and Dashboard can now use this payroll run.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save payroll worksheet.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6">
      <AdminSubpageHeader
        title="New Wage Worksheet"
        subtitle="Build payroll from approved hours, tips, outside commission, deductions, and payment method."
        backHref="/admin"
        backLabel="Back to Admin Board"
      />

      {message && (
        <div className="mb-4 rounded-xl border bg-slate-50 px-4 py-3 text-sm text-slate-700">{message}</div>
      )}

      {step === 'setup' ? (
        <div className="max-w-3xl rounded-xl border bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Department</Label>
              <Select value={department} onValueChange={(value: string | null) => value && setDepartment(value)}>
                <SelectTrigger><span>{departmentOptions.find(option => option.key === department)?.label ?? department}</span></SelectTrigger>
                <SelectContent>
                  {departmentOptions.map(option => (
                    <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Pay Date</Label>
              <Input type="date" value={payDate} onChange={event => setPayDate(event.target.value)} />
            </div>
            <div>
              <Label>Pay Range Start</Label>
              <Input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} />
            </div>
            <div>
              <Label>Pay Range End</Label>
              <Input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} />
            </div>
          </div>
          <div className="mt-4">
            <Label>Payroll Memo</Label>
            <Textarea value={memo} onChange={event => setMemo(event.target.value)} placeholder="Special attention, payroll notes, or outside reporting reminders" />
          </div>
          <div className="mt-5 flex justify-end">
            <Button onClick={buildWorksheet} disabled={!startDate || !endDate || !payDate}>Next</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium uppercase text-muted-foreground">Cash Total</p>
              <p className="mt-1 text-2xl font-bold">{formatCurrency(totals.cash)}</p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium uppercase text-muted-foreground">Check Total</p>
              <p className="mt-1 text-2xl font-bold">{formatCurrency(totals.check)}</p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium uppercase text-muted-foreground">ACH Total</p>
              <p className="mt-1 text-2xl font-bold">{formatCurrency(totals.ach)}</p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium uppercase text-muted-foreground">Deductions</p>
              <p className="mt-1 text-2xl font-bold text-red-700">{formatCurrency(totals.deductions)}</p>
            </div>
          </div>

          {hasClockFlags && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              One or more employees have auto-clock-out or open/pending clock records. Review Clock In Records before final payroll.
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3">
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
            <Button variant="outline" onClick={() => setStep('setup')}>Back</Button>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={rows.length === 0 || missingPaymentRows.length > 0}
            >
              Payout
            </Button>
          </div>

          <div className="overflow-x-auto rounded-xl border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paid By</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Tips</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">Top-Up</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Deductions</TableHead>
                  <TableHead className="text-right">Payout</TableHead>
                  <TableHead>Memo</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.employee_id}>
                    <TableCell>
                      <Select value={row.payment_method || undefined} onValueChange={(value: string | null) => value && updateRow(row.employee_id, { payment_method: value as PaymentMethod })}>
                        <SelectTrigger className="w-28"><span>{paymentMethodLabel(row.payment_method)}</span></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="check">Check</SelectItem>
                          <SelectItem value="ach">ACH</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="font-medium">{row.employee_name}</TableCell>
                    <TableCell>
                      {row.has_open_clock ? (
                        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Clock Review</Badge>
                      ) : row.has_auto_clock_out ? (
                        <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-800">Auto Out</Badge>
                      ) : (
                        <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">OK</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Input className="w-20 text-right" type="number" step="0.01" value={row.hours} onChange={event => {
                        const hours = normalizeMoney(event.target.value)
                        updateRow(row.employee_id, { hours })
                      }} />
                    </TableCell>
                    <TableCell><Input className="w-24 text-right" type="number" step="0.01" value={row.tips} onChange={event => updateRow(row.employee_id, { tips: normalizeMoney(event.target.value) })} /></TableCell>
                    <TableCell><Input className="w-24 text-right" type="number" step="0.01" value={row.base_wages} onChange={event => updateRow(row.employee_id, { base_wages: normalizeMoney(event.target.value) })} /></TableCell>
                    <TableCell><Input className="w-24 text-right" type="number" step="0.01" value={row.guarantee_top_up} onChange={event => updateRow(row.employee_id, { guarantee_top_up: normalizeMoney(event.target.value) })} /></TableCell>
                    <TableCell><Input className="w-24 text-right" type="number" step="0.01" value={row.commission} onChange={event => updateRow(row.employee_id, { commission: normalizeMoney(event.target.value) })} /></TableCell>
                    <TableCell><Input className="w-24 text-right" type="number" step="0.01" value={row.deductions} onChange={event => updateRow(row.employee_id, { deductions: normalizeMoney(event.target.value) })} /></TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatCurrency(row.payout_amount)}
                      {row.payment_method === 'cash' && row.cash_rounding > 0 && (
                        <div className="text-[11px] text-muted-foreground">rounded {formatCurrency(row.cash_rounding)}</div>
                      )}
                    </TableCell>
                    <TableCell><Input className="w-48" value={row.memo} onChange={event => updateRow(row.employee_id, { memo: event.target.value })} /></TableCell>
                    <TableCell><Button variant="ghost" size="sm" onClick={() => removeRow(row.employee_id)}>Remove</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Payout Summary</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border p-4"><p className="text-xs uppercase text-muted-foreground">Cash</p><p className="text-2xl font-bold">{formatCurrency(totals.cash)}</p></div>
            <div className="rounded-xl border p-4"><p className="text-xs uppercase text-muted-foreground">Check</p><p className="text-2xl font-bold">{formatCurrency(totals.check)}</p></div>
            <div className="rounded-xl border p-4"><p className="text-xs uppercase text-muted-foreground">ACH</p><p className="text-2xl font-bold">{formatCurrency(totals.ach)}</p></div>
          </div>
          <div className="rounded-xl border bg-slate-50 p-4 text-sm">
            Gross {formatCurrency(totals.gross)} - deductions {formatCurrency(totals.deductions)} = net {formatCurrency(totals.net)}.
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
