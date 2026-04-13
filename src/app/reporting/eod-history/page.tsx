'use client'

import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { ReportingToolbar } from '@/components/reporting/ReportingToolbar'
import { notifyReportingDataChanged, useEmployees, useEodReports } from '@/components/reporting/useReportingData'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { getEffectiveClockHours } from '@/lib/clockUtils'
import { ReportPeriod, formatCurrency, getReportRange } from '@/lib/reporting'
import { calculateTips } from '@/lib/tipCalc'
import { insertTipDistributionsWithFallback } from '@/lib/tipDistributionWrite'
import { Employee, EodReport, ShiftClock } from '@/lib/types'

function isEodCloserRole(role: Employee['role']) {
  return role === 'manager' || role === 'server' || role === 'busser' || role === 'runner'
}

function isTipEligibleRole(role: Employee['role']) {
  return role === 'manager' || role === 'server' || role === 'busser' || role === 'runner'
}

function aggregateClockRowsByEmployee(records: ShiftClock[], employees: Employee[]) {
  const grouped = new Map<string, { employee_id: string; hours_worked: number; start_time: string | null; end_time: string | null }>()

  for (const record of records) {
    const employee = employees.find(item => item.id === record.employee_id)
    if (!employee || !isTipEligibleRole(employee.role)) continue

    const existing = grouped.get(record.employee_id) ?? {
      employee_id: record.employee_id,
      hours_worked: 0,
      start_time: null,
      end_time: null,
    }

    existing.hours_worked += getEffectiveClockHours(record)
    const clockInTime = record.clock_in_at ? format(new Date(record.clock_in_at), 'HH:mm:ss') : null
    const clockOutTime = record.clock_out_at ? format(new Date(record.clock_out_at), 'HH:mm:ss') : null
    existing.start_time = !existing.start_time || (clockInTime && clockInTime < existing.start_time) ? clockInTime : existing.start_time
    existing.end_time = !existing.end_time || (clockOutTime && clockOutTime > existing.end_time) ? clockOutTime : existing.end_time

    grouped.set(record.employee_id, existing)
  }

  return [...grouped.values()].filter(row => row.hours_worked > 0)
}

const EMPTY_FORM = {
  session_date: '',
  closed_by_employee_id: '',
  cash_total: '',
  batch_total: '',
  cc_tip: '',
  cash_tip: '',
  memo: '',
}

export default function EodHistoryPage() {
  const { eodReports } = useEodReports()
  const employees = useEmployees()
  const [period, setPeriod] = useState<ReportPeriod>('weekly')
  const [refDate, setRefDate] = useState(new Date())
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [reports, setReports] = useState<EodReport[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingReportId, setEditingReportId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setReports(eodReports)
  }, [eodReports])

  const [startDate, endDate] = useMemo(
    () => getReportRange(period, refDate, customStart, customEnd),
    [period, refDate, customStart, customEnd]
  )
  const filteredEodReports = useMemo(
    () => reports.filter(report => report.session_date >= startDate && report.session_date <= endDate),
    [reports, endDate, startDate]
  )
  const totals = useMemo(
    () =>
      filteredEodReports.reduce(
        (sum, report) => {
          const tax = Number(report.sales_tax ?? 0)
          return {
            cash: sum.cash + report.cash_total,
            batch: sum.batch + report.batch_total,
            revenue: sum.revenue + report.revenue_total,
            tax: sum.tax + tax,
            tip: sum.tip + report.tip_total,
            net: sum.net + (report.revenue_total - tax - report.tip_total),
            deposit: sum.deposit + report.cash_deposit,
          }
        },
        { cash: 0, batch: 0, revenue: 0, tax: 0, tip: 0, net: 0, deposit: 0 }
      ),
    [filteredEodReports]
  )
  const eodCloserEmployees = useMemo(
    () => employees.filter(employee => isEodCloserRole(employee.role)),
    [employees]
  )

  const openCreateDialog = () => {
    setEditingReportId(null)
    setForm({
      ...EMPTY_FORM,
      session_date: format(refDate, 'yyyy-MM-dd'),
    })
    setSaveError(null)
    setDialogOpen(true)
  }

  const openEditDialog = (report: EodReport) => {
    setEditingReportId(report.id)
    setForm({
      session_date: report.session_date,
      closed_by_employee_id: report.closed_by_employee_id ?? '',
      cash_total: String(report.cash_total),
      batch_total: String(report.batch_total),
      cc_tip: String(report.cc_tip),
      cash_tip: String(report.cash_tip),
      memo: report.memo ?? '',
    })
    setSaveError(null)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.session_date) {
      setSaveError('Session date is required')
      return
    }

    setSaving(true)
    setSaveError(null)

    try {
      const cashTotal = Number(form.cash_total || 0)
      const batchTotal = Number(form.batch_total || 0)
      const ccTip = Number(form.cc_tip || 0)
      const cashTip = Number(form.cash_tip || 0)

      const payload = {
        session_date: form.session_date,
        closed_by_employee_id: form.closed_by_employee_id || null,
        cash_total: cashTotal,
        batch_total: batchTotal,
        revenue_total: cashTotal + batchTotal,
        cc_tip: ccTip,
        cash_tip: cashTip,
        tip_total: ccTip + cashTip,
        cash_deposit: cashTotal + cashTip,
        memo: form.memo.trim() || null,
      }

      const query = editingReportId
        ? supabase.from('eod_reports').update(payload).eq('id', editingReportId)
        : supabase.from('eod_reports').insert(payload)

      const { data, error } = await query.select().single()

      if (error || !data) {
        setSaveError(error?.message ?? 'Failed to save manual EOD entry')
        return
      }

      const reportId = (data as EodReport).id

      const clockResponse = await fetch(`/api/clock-events?session_date=${form.session_date}`, { cache: 'no-store' })
      const clockPayload = (await clockResponse.json().catch(() => ({}))) as { records?: ShiftClock[]; error?: string }
      if (!clockResponse.ok) {
        setSaveError(clockPayload.error ?? 'Failed to load clock records for tip distribution')
        return
      }

      const clockRecords = (clockPayload.records ?? []) as ShiftClock[]
      const eligibleRows = aggregateClockRowsByEmployee(clockRecords, employees)

      const tipResults = calculateTips(ccTip + cashTip, eligibleRows.map(row => ({
        employee_id: row.employee_id,
        hours_worked: row.hours_worked,
      })))

      const deleteTips = await supabase.from('tip_distributions').delete().eq('eod_report_id', reportId)
      if (deleteTips.error) {
        setSaveError(deleteTips.error.message)
        return
      }

      if (tipResults.length > 0) {
        try {
          await insertTipDistributionsWithFallback(
            supabase,
            eligibleRows.map(row => {
              const result = tipResults.find(item => item.employee_id === row.employee_id)
              return {
                eod_report_id: reportId,
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
        } catch (error) {
          setSaveError(error instanceof Error ? error.message : 'Failed to save tip distributions')
          return
        }
      }

      const { data: refreshedReport, error: refreshedError } = await supabase
        .from('eod_reports')
        .select('*, tip_distributions(*, employee:employees(*))')
        .eq('id', reportId)
        .single()

      if (refreshedError || !refreshedReport) {
        setSaveError(refreshedError?.message ?? 'Failed to refresh saved EOD entry')
        return
      }

      const nextReport = refreshedReport as EodReport
      setReports(current => {
        const remaining = current.filter(report => report.id !== nextReport.id)
        return [...remaining, nextReport].sort((a, b) => (a.session_date < b.session_date ? 1 : -1))
      })
      notifyReportingDataChanged()
      setDialogOpen(false)
      setEditingReportId(null)
      setForm(EMPTY_FORM)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6">
      <AdminSubpageHeader
        title="EOD History"
        subtitle="Store-wide financial history with consistent date controls."
        backHref="/reporting"
        backLabel="Back to Reporting"
        rightSlot={<Button onClick={openCreateDialog}>Add Manual Entry</Button>}
      />
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
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Cash Total</TableHead>
              <TableHead className="text-right">Batch Total</TableHead>
              <TableHead className="text-right">Revenue Total</TableHead>
              <TableHead className="text-right">Sales Tax</TableHead>
              <TableHead className="text-right">Tip Total</TableHead>
              <TableHead className="text-right text-emerald-700">Net Revenue</TableHead>
              <TableHead className="text-right">Cash Deposit</TableHead>
              <TableHead>Memo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEodReports.map(report => (
              <TableRow key={report.id}>
                <TableCell className="font-medium">{format(new Date(`${report.session_date}T12:00:00`), 'MMM d, yyyy')}</TableCell>
                <TableCell className="text-right">{formatCurrency(report.cash_total)}</TableCell>
                <TableCell className="text-right">{formatCurrency(report.batch_total)}</TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(report.revenue_total)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{formatCurrency(Number(report.sales_tax ?? 0))}</TableCell>
                <TableCell className="text-right text-green-700">{formatCurrency(report.tip_total)}</TableCell>
                <TableCell className="text-right font-semibold text-emerald-700">{formatCurrency(report.revenue_total - Number(report.sales_tax ?? 0) - report.tip_total)}</TableCell>
                <TableCell className="text-right">{formatCurrency(report.cash_deposit)}</TableCell>
                <TableCell className="max-w-xs text-sm text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate">{report.memo ?? '—'}</span>
                    <Button size="sm" variant="outline" onClick={() => openEditDialog(report)}>
                      Edit
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filteredEodReports.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-6 text-center text-muted-foreground">No EOD reports for this range</TableCell>
              </TableRow>
            )}
          </TableBody>
          {filteredEodReports.length > 0 && (
            <tfoot>
              <TableRow>
                <TableCell className="font-semibold">Period Total</TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(totals.cash)}</TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(totals.batch)}</TableCell>
                <TableCell className="text-right font-bold">{formatCurrency(totals.revenue)}</TableCell>
                <TableCell className="text-right font-semibold text-muted-foreground">{formatCurrency(totals.tax)}</TableCell>
                <TableCell className="text-right font-semibold text-green-700">{formatCurrency(totals.tip)}</TableCell>
                <TableCell className="text-right font-bold text-emerald-700">{formatCurrency(totals.net)}</TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(totals.deposit)}</TableCell>
                <TableCell />
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingReportId ? 'Edit Manual EOD Entry' : 'Add Manual EOD Entry'}</DialogTitle>
            <DialogDescription>
              Use this for missed days or corrections. Revenue, tips, and cash deposit recalculate automatically when you save.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Session Date</Label>
              <Input
                type="date"
                value={form.session_date}
                onChange={event => setForm(current => ({ ...current, session_date: event.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Closed By</Label>
              <Select
                value={form.closed_by_employee_id || 'none'}
                onValueChange={(value: string | null) => setForm(current => ({ ...current, closed_by_employee_id: value === 'none' ? '' : (value ?? '') }))}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {eodCloserEmployees.map(employee => (
                    <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Cash Total</Label>
              <Input
                type="number"
                step="0.01"
                value={form.cash_total}
                onChange={event => setForm(current => ({ ...current, cash_total: event.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Batch Total</Label>
              <Input
                type="number"
                step="0.01"
                value={form.batch_total}
                onChange={event => setForm(current => ({ ...current, batch_total: event.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label>CC Tip</Label>
              <Input
                type="number"
                step="0.01"
                value={form.cc_tip}
                onChange={event => setForm(current => ({ ...current, cc_tip: event.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Cash Tip</Label>
              <Input
                type="number"
                step="0.01"
                value={form.cash_tip}
                onChange={event => setForm(current => ({ ...current, cash_tip: event.target.value }))}
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label>Memo</Label>
            <Textarea
              value={form.memo}
              onChange={event => setForm(current => ({ ...current, memo: event.target.value }))}
              className="mt-1"
              rows={4}
              placeholder="Why this manual entry was added or changed"
            />
          </div>

          {saveError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {saveError}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editingReportId ? 'Save Changes' : 'Create Entry'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
