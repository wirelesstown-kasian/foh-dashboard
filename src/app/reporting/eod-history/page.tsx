'use client'

import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { PinModal } from '@/components/layout/PinModal'
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
import { CashBalanceEntry, Employee, EodReport, ShiftClock } from '@/lib/types'
import { getCashVariance, getExpectedCashDeposit } from '@/lib/eodVariance'

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
  sales_tax: '',
  cc_tip: '',
  cash_tip: '',
  actual_cash_on_hand: '',
  variance_note: '',
  memo: '',
}

const EMPTY_CASH_ENTRY_FORM = {
  entry_date: '',
  cash_in_amount: '',
  cash_out_amount: '',
  description: '',
}

function getSignedCashAmount(entry: CashBalanceEntry) {
  return entry.entry_type === 'cash_in' ? Number(entry.amount) : Number(entry.amount) * -1
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
  const [showEditPin, setShowEditPin] = useState(false)
  const [editPinError, setEditPinError] = useState<string | null>(null)
  const [cashEntryForm, setCashEntryForm] = useState({
    ...EMPTY_CASH_ENTRY_FORM,
    entry_date: format(new Date(), 'yyyy-MM-dd'),
  })
  const [cashEntries, setCashEntries] = useState<CashBalanceEntry[]>([])
  const [inlineAudit, setInlineAudit] = useState<Record<string, { batchTotal: string; actualCash: string; varianceNote: string }>>({})
  const [auditSavingId, setAuditSavingId] = useState<string | null>(null)
  const [savedAuditIds, setSavedAuditIds] = useState<Set<string>>(new Set())
  const [saveAllRunning, setSaveAllRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cashEntrySaving, setCashEntrySaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)

  useEffect(() => {
    setReports(eodReports)
    setInlineAudit(current => {
      const next = { ...current }
      for (const report of eodReports) {
        next[report.id] = {
          batchTotal: current[report.id]?.batchTotal ?? String(report.batch_total ?? 0),
          actualCash: current[report.id]?.actualCash ?? (report.actual_cash_on_hand > 0 ? String(report.actual_cash_on_hand) : ''),
          varianceNote: current[report.id]?.varianceNote ?? report.variance_note ?? '',
        }
      }
      return next
    })
    setSavedAuditIds(current => {
      const next = new Set(current)
      for (const report of eodReports) {
        if (Number(report.actual_cash_on_hand ?? 0) > 0) next.add(report.id)
      }
      return next
    })
  }, [eodReports])

  useEffect(() => {
    let mounted = true
    void (async () => {
      const { data, error } = await supabase
        .from('cash_balance_entries')
        .select('*')
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false })
      if (!mounted || error) return
      setCashEntries((data ?? []) as CashBalanceEntry[])
    })()
    return () => {
      mounted = false
    }
  }, [])

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
            variance: sum.variance + Number(report.cash_variance ?? 0),
          }
        },
        { cash: 0, batch: 0, revenue: 0, tax: 0, tip: 0, net: 0, deposit: 0, variance: 0 }
      ),
    [filteredEodReports]
  )
  const filteredCashEntries = useMemo(
    () => cashEntries.filter(entry => entry.entry_date >= startDate && entry.entry_date <= endDate),
    [cashEntries, endDate, startDate]
  )
  const eodCloserEmployees = useMemo(
    () => employees.filter(employee => isEodCloserRole(employee.role)),
    [employees]
  )
  const currentCarryingCash = useMemo(() => {
    const eodCashTotal = reports.reduce((sum, report) => sum + Number(report.actual_cash_on_hand ?? 0), 0)
    const cashEntryTotal = cashEntries.reduce((sum, entry) => sum + getSignedCashAmount(entry), 0)
    return eodCashTotal + cashEntryTotal
  }, [cashEntries, reports])
  const runningBalanceByEntryId = useMemo(() => {
    const sortedEntries = [...filteredCashEntries].sort((left, right) => {
      if (left.entry_date !== right.entry_date) return right.entry_date.localeCompare(left.entry_date)
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    })
    const balances = new Map<string, number>()
    let newerAdjustments = 0

    for (const entry of sortedEntries) {
      balances.set(entry.id, currentCarryingCash - newerAdjustments)
      newerAdjustments += getSignedCashAmount(entry)
    }

    return balances
  }, [currentCarryingCash, filteredCashEntries])

  useEffect(() => {
    setInlineAudit(current => {
      const next = { ...current }
      for (const report of filteredEodReports) {
        if (next[report.id]) continue
        next[report.id] = {
          batchTotal: String(report.batch_total ?? 0),
          actualCash: report.actual_cash_on_hand > 0 ? String(report.actual_cash_on_hand) : '',
          varianceNote: report.variance_note ?? '',
        }
      }
      return next
    })
  }, [filteredEodReports])

  const openCreateDialog = () => {
    setEditingReportId(null)
    setForm({
      ...EMPTY_FORM,
      session_date: format(refDate, 'yyyy-MM-dd'),
    })
    setSaveError(null)
    setSaveNotice(null)
    setDialogOpen(true)
  }

  const openEditDialog = (report: EodReport) => {
    setEditingReportId(report.id)
    setForm({
      session_date: report.session_date,
      closed_by_employee_id: report.closed_by_employee_id ?? '',
      cash_total: String(report.cash_total),
      batch_total: String(report.batch_total),
      sales_tax: report.sales_tax != null ? String(report.sales_tax) : '',
      cc_tip: String(report.cc_tip),
      cash_tip: String(report.cash_tip),
      actual_cash_on_hand: report.actual_cash_on_hand > 0 ? String(report.actual_cash_on_hand) : '',
      variance_note: report.variance_note ?? '',
      memo: report.memo ?? '',
    })
    setSaveError(null)
    setSaveNotice(null)
    setDialogOpen(true)
  }

  const handleCashEntrySubmit = async () => {
    if (!cashEntryForm.entry_date || !cashEntryForm.description.trim()) {
      setSaveError('Date and description are required for cash in / cash out.')
      return
    }

    setCashEntrySaving(true)
    setSaveError(null)
    setSaveNotice(null)

    try {
      const cashInAmount = cashEntryForm.cash_in_amount.trim() ? Number(cashEntryForm.cash_in_amount) : 0
      const cashOutAmount = cashEntryForm.cash_out_amount.trim() ? Number(cashEntryForm.cash_out_amount) : 0

      if (cashInAmount <= 0 && cashOutAmount <= 0) {
        setSaveError('Enter a cash in amount, a cash out amount, or both.')
        return
      }
      if ((cashEntryForm.cash_in_amount.trim() && (Number.isNaN(cashInAmount) || cashInAmount <= 0)) || (cashEntryForm.cash_out_amount.trim() && (Number.isNaN(cashOutAmount) || cashOutAmount <= 0))) {
        setSaveError('Cash in and cash out amounts must be greater than 0.')
        return
      }

      const timestamp = new Date().toISOString()
      const payloads = [
        ...(cashInAmount > 0 ? [{
          entry_date: cashEntryForm.entry_date,
          entry_type: 'cash_in' as const,
          amount: cashInAmount,
          description: cashEntryForm.description.trim(),
          updated_at: timestamp,
        }] : []),
        ...(cashOutAmount > 0 ? [{
          entry_date: cashEntryForm.entry_date,
          entry_type: 'cash_out' as const,
          amount: cashOutAmount,
          description: cashEntryForm.description.trim(),
          updated_at: timestamp,
        }] : []),
      ]

      const { data, error } = await supabase
        .from('cash_balance_entries')
        .insert(payloads)
        .select()

      if (error || !data || data.length === 0) {
        setSaveError(error?.message ?? 'Failed to save cash movement entry.')
        return
      }

      const entries = data as CashBalanceEntry[]

      // Calculate running balance for each new entry using the same logic as the UI display
      let runningBalance = currentCarryingCash
      // entries are in insertion order (cash_in first if both), compute balance sequentially
      for (const entry of entries) {
        runningBalance += entry.entry_type === 'cash_in' ? Number(entry.amount) : -Number(entry.amount)
        const sheetSync = await fetch('/api/cash-balance-sheet-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entry_id: entry.id, cash_on_hand: runningBalance }),
        })
        if (!sheetSync.ok) {
          const payload = await sheetSync.json().catch(() => ({})) as { error?: string }
          setSaveError(`Cash movement saved, but Google Sheets sync failed: ${payload.error ?? 'unknown error'}`)
          break
        }
      }

      setCashEntries(current =>
        [...entries, ...current].sort((left, right) => {
          if (left.entry_date !== right.entry_date) return right.entry_date.localeCompare(left.entry_date)
          return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
        })
      )
      setCashEntryForm(current => ({
        ...EMPTY_CASH_ENTRY_FORM,
        entry_date: current.entry_date,
      }))
      setSaveNotice(`${entries.length} cash movement record${entries.length === 1 ? '' : 's'} saved for ${cashEntryForm.entry_date}.`)
    } finally {
      setCashEntrySaving(false)
    }
  }

  const handleSave = async (editedByName?: string | null) => {
    if (!form.session_date) {
      setSaveError('Session date is required')
      return
    }

    setSaving(true)
    setSaveError(null)
    setSaveNotice(null)

    try {
      const cashTotal = Number(form.cash_total || 0)
      const batchTotal = Number(form.batch_total || 0)
      const salesTax = Number(form.sales_tax || 0)
      const ccTip = Number(form.cc_tip || 0)
      const cashTip = Number(form.cash_tip || 0)
      const actualCashOnHand = Number(form.actual_cash_on_hand || 0)
      const expectedCash = getExpectedCashDeposit(cashTotal, cashTip)
      const cashVariance = getCashVariance(actualCashOnHand, cashTotal, cashTip)
      const nextMemo = editingReportId
        ? [
          form.memo.trim(),
          editedByName ? `[Edited ${new Date().toLocaleString('en-US')}] by ${editedByName}` : '',
        ].filter(Boolean).join('\n')
        : form.memo.trim()

      const payload = {
        session_date: form.session_date,
        closed_by_employee_id: form.closed_by_employee_id || null,
        cash_total: cashTotal,
        batch_total: batchTotal,
        revenue_total: cashTotal + batchTotal,
        sales_tax: salesTax,
        cc_tip: ccTip,
        cash_tip: cashTip,
        tip_total: ccTip + cashTip,
        cash_deposit: expectedCash,
        actual_cash_on_hand: actualCashOnHand,
        cash_variance: cashVariance,
        variance_note: form.variance_note.trim() || null,
        memo: nextMemo || null,
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

      const sheetSync = await fetch('/api/eod-sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_id: reportId }),
      })
      if (!sheetSync.ok) {
        const payload = await sheetSync.json().catch(() => ({})) as { error?: string }
        setSaveError(`Manual EOD entry saved, but Google Sheets sync failed: ${payload.error ?? 'unknown error'}`)
      }

      setReports(current => {
        const remaining = current.filter(report => report.id !== nextReport.id)
        return [...remaining, nextReport].sort((a, b) => (a.session_date < b.session_date ? 1 : -1))
      })
      notifyReportingDataChanged()
      setDialogOpen(false)
      setEditingReportId(null)
      setForm(EMPTY_FORM)
      setSaveNotice(`EOD report saved. Variance: ${formatCurrency(nextReport.cash_variance ?? 0)}.`)
    } finally {
      setSaving(false)
    }
  }

  const handleEditPinConfirm = async (pin: string) => {
    setEditPinError(null)

    const response = await fetch('/api/manager-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string }
      const message = payload.error ?? 'Manager PIN required'
      setEditPinError(message)
      throw new Error(message)
    }

    const payload = await response.json() as { managerId?: string }
    const editedByName = employees.find(employee => employee.id === payload.managerId)?.name ?? 'Manager'
    setShowEditPin(false)
    await handleSave(editedByName)
  }

  const handleSaveClick = async () => {
    if (editingReportId) {
      setEditPinError(null)
      setShowEditPin(true)
      return
    }
    await handleSave()
  }

  const handleAuditSave = async (report: EodReport) => {
    const currentAudit = inlineAudit[report.id] ?? { batchTotal: String(report.batch_total ?? 0), actualCash: '', varianceNote: '' }
    const hasBatchInput = currentAudit.batchTotal.trim() !== ''
    const hasActualInput = currentAudit.actualCash.trim() !== ''

    if (!hasBatchInput && !hasActualInput) {
      setSaveError('Enter a batch total, actual cash on hand, or both.')
      return
    }

    setAuditSavingId(report.id)
    setSaveError(null)
    setSaveNotice(null)

    try {
      const batchTotal = hasBatchInput ? Number(currentAudit.batchTotal || 0) : Number(report.batch_total ?? 0)
      const actualCashOnHand = hasActualInput ? Number(currentAudit.actualCash || 0) : Number(report.actual_cash_on_hand ?? 0)
      const hasActualCashValue = hasActualInput || Number(report.actual_cash_on_hand ?? 0) > 0
      const cashVariance = hasActualCashValue
        ? getCashVariance(actualCashOnHand, Number(report.cash_total ?? 0), Number(report.cash_tip ?? 0))
        : Number(report.cash_variance ?? 0)

      const { error } = await supabase
        .from('eod_reports')
        .update({
          batch_total: batchTotal,
          revenue_total: Number(report.cash_total ?? 0) + batchTotal,
          actual_cash_on_hand: actualCashOnHand,
          cash_variance: cashVariance,
          variance_note: currentAudit.varianceNote.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', report.id)

      if (error) {
        setSaveError(error.message)
        return
      }

      const sheetSync = await fetch('/api/eod-sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_id: report.id }),
      })
      if (!sheetSync.ok) {
        const payload = await sheetSync.json().catch(() => ({})) as { error?: string }
        setSaveError(`Cash audit saved, but Google Sheets sync failed: ${payload.error ?? 'unknown error'}`)
      }

      notifyReportingDataChanged()
      setReports(current => current.map(item => item.id === report.id ? {
        ...item,
        batch_total: batchTotal,
        revenue_total: Number(item.cash_total ?? 0) + batchTotal,
        actual_cash_on_hand: actualCashOnHand,
        cash_variance: cashVariance,
        variance_note: currentAudit.varianceNote.trim() || null,
      } : item))
      setSavedAuditIds(current => new Set([...current, report.id]))
      setSaveNotice(
        hasActualCashValue
          ? `EOD audit saved for ${report.session_date}. Variance: ${formatCurrency(cashVariance)}.`
          : `Batch total saved for ${report.session_date}.`
      )
    } finally {
      setAuditSavingId(null)
    }
  }

  const hasInlineAuditChanges = (report: EodReport) => {
    const audit = inlineAudit[report.id]
    if (!audit) return false

    const currentBatch = audit.batchTotal.trim()
    const currentActual = audit.actualCash.trim()
    const currentNote = audit.varianceNote.trim()

    const originalBatch = String(report.batch_total ?? 0)
    const originalActual = report.actual_cash_on_hand > 0 ? String(report.actual_cash_on_hand) : ''
    const originalNote = (report.variance_note ?? '').trim()

    return currentBatch !== originalBatch || currentActual !== originalActual || currentNote !== originalNote
  }

  const handleSaveAll = async () => {
    const pending = filteredEodReports.filter(report => {
      const audit = inlineAudit[report.id]
      const hasValue = (((audit?.actualCash ?? '').trim() !== '') || ((audit?.batchTotal ?? '').trim() !== ''))
      return hasValue && hasInlineAuditChanges(report) && !savedAuditIds.has(report.id)
    })
    if (pending.length === 0) return
    setSaveAllRunning(true)
    setSaveError(null)
    setSaveNotice(null)
    for (const report of pending) {
      await handleAuditSave(report)
    }
    setSaveAllRunning(false)
    setSaveNotice(`${pending.length} record${pending.length === 1 ? '' : 's'} saved.`)
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
        {saveNotice && (
          <div className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {saveNotice}
          </div>
        )}
        {saveError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {saveError}
          </div>
        )}
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
        <div className="mb-5 rounded-2xl border bg-slate-50/70 p-3">
          <div className="grid gap-3 xl:grid-cols-[1.55fr_0.45fr]">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Cash In / Cash Out</div>
              <div className="mt-2 grid gap-2 md:grid-cols-[140px_120px_120px_110px]">
                <div>
                  <Label className="text-xs text-muted-foreground">Date</Label>
                  <Input
                    type="date"
                    value={cashEntryForm.entry_date}
                    onChange={event => setCashEntryForm(current => ({ ...current, entry_date: event.target.value }))}
                    className="mt-1 h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs text-emerald-700">Cash In Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={cashEntryForm.cash_in_amount}
                    onChange={event => setCashEntryForm(current => ({ ...current, cash_in_amount: event.target.value }))}
                    className="mt-1 h-8 border-emerald-200 text-xs text-emerald-700 placeholder:text-emerald-300"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label className="text-xs text-red-700">Cash Out Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={cashEntryForm.cash_out_amount}
                    onChange={event => setCashEntryForm(current => ({ ...current, cash_out_amount: event.target.value }))}
                    className="mt-1 h-8 border-red-200 text-xs text-red-700 placeholder:text-red-300"
                    placeholder="0.00"
                  />
                </div>
                <div className="flex items-end">
                  <Button className="h-8 w-full text-xs" onClick={() => void handleCashEntrySubmit()} disabled={cashEntrySaving}>
                    {cashEntrySaving ? 'Saving…' : 'Submit'}
                  </Button>
                </div>
              </div>
              <div className="mt-2">
                <Label className="text-xs text-muted-foreground">Description</Label>
                <Input
                  value={cashEntryForm.description}
                  onChange={event => setCashEntryForm(current => ({ ...current, description: event.target.value }))}
                  className="mt-1 h-8 text-xs"
                  placeholder="Why cash was added or taken out"
                />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-xl border bg-white p-3">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Current Cash On Hand</div>
                <div className="mt-1 text-2xl font-bold text-slate-950">{formatCurrency(currentCarryingCash)}</div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Read-only review value.</p>
              </div>
            </div>
          </div>
          <div className="mt-3 rounded-xl border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">Date</TableHead>
                  <TableHead className="w-[92px]">Type</TableHead>
                  <TableHead className="w-[110px] text-right">Amount</TableHead>
                  <TableHead className="w-[130px] text-right">Running Balance</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCashEntries.map(entry => (
                  <TableRow key={entry.id}>
                    <TableCell className="py-2 text-xs font-medium">{format(new Date(`${entry.entry_date}T12:00:00`), 'MMM d, yyyy')}</TableCell>
                    <TableCell className="py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${entry.entry_type === 'cash_in' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                        {entry.entry_type === 'cash_in' ? 'Cash In' : 'Cash Out'}
                      </span>
                    </TableCell>
                    <TableCell className={`py-2 text-right text-xs font-semibold ${entry.entry_type === 'cash_in' ? 'text-emerald-700' : 'text-red-700'}`}>
                      {entry.entry_type === 'cash_in' ? '+' : '-'}{formatCurrency(Number(entry.amount))}
                    </TableCell>
                    <TableCell className="py-2 text-right text-xs font-semibold text-slate-900">
                      {formatCurrency(runningBalanceByEntryId.get(entry.id) ?? 0)}
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">{entry.description}</TableCell>
                  </TableRow>
                ))}
                {filteredCashEntries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-4 text-center text-sm text-muted-foreground">
                      No cash in / cash out records for this range yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[92px]">Date</TableHead>
              <TableHead className="w-[88px] text-right">Cash</TableHead>
              <TableHead className="w-[124px]">Batch Total</TableHead>
              <TableHead className="w-[96px] text-right">Gross Revenue</TableHead>
              <TableHead className="w-[82px] text-right">Tax</TableHead>
              <TableHead className="w-[82px] text-right">Tips</TableHead>
              <TableHead className="w-[96px] text-right text-emerald-700">Net Revenue</TableHead>
              <TableHead className="w-[96px] text-right">Deposit</TableHead>
              <TableHead className="w-[150px]">Actual Cash</TableHead>
              <TableHead className="w-[90px] text-right">Variance</TableHead>
              <TableHead className="w-[180px]">Variance Note</TableHead>
              <TableHead className="w-[120px]">Memo</TableHead>
              <TableHead className="w-35 text-right">
                <Button
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => void handleSaveAll()}
                  disabled={saveAllRunning || filteredEodReports.every(r => !hasInlineAuditChanges(r) || savedAuditIds.has(r.id))}
                >
                  {saveAllRunning ? 'Saving…' : 'Save All'}
                </Button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEodReports.map(report => (
              <TableRow key={report.id}>
                <TableCell className="py-2 text-xs font-medium">{format(new Date(`${report.session_date}T12:00:00`), 'MMM d')}</TableCell>
                <TableCell className="py-2 text-right text-xs">{formatCurrency(report.cash_total)}</TableCell>
                <TableCell className="py-2">
                  <Input
                    type="number"
                    step="0.01"
                    value={inlineAudit[report.id]?.batchTotal ?? String(report.batch_total ?? 0)}
                    onChange={event => {
                      setSavedAuditIds(current => { const next = new Set(current); next.delete(report.id); return next })
                      setInlineAudit(current => ({
                        ...current,
                        [report.id]: {
                          batchTotal: event.target.value,
                          actualCash: current[report.id]?.actualCash ?? (report.actual_cash_on_hand > 0 ? String(report.actual_cash_on_hand) : ''),
                          varianceNote: current[report.id]?.varianceNote ?? report.variance_note ?? '',
                        },
                      }))
                    }}
                    placeholder="Batch total"
                    className="h-8 text-xs"
                  />
                </TableCell>
                <TableCell className="py-2 text-right text-xs font-semibold">{formatCurrency(Number(report.cash_total ?? 0) + Number(inlineAudit[report.id]?.batchTotal ?? report.batch_total ?? 0))}</TableCell>
                <TableCell className="py-2 text-right text-xs text-muted-foreground">{formatCurrency(Number(report.sales_tax ?? 0))}</TableCell>
                <TableCell className="py-2 text-right text-xs text-green-700">{formatCurrency(report.tip_total)}</TableCell>
                <TableCell className="py-2 text-right text-xs font-semibold text-emerald-700">{formatCurrency((Number(report.cash_total ?? 0) + Number(inlineAudit[report.id]?.batchTotal ?? report.batch_total ?? 0)) - Number(report.sales_tax ?? 0) - Number(report.tip_total ?? 0))}</TableCell>
                <TableCell className="py-2 text-right text-xs">{formatCurrency(report.cash_deposit)}</TableCell>
                <TableCell className="py-2">
                  <Input
                    type="number"
                    step="0.01"
                    value={inlineAudit[report.id]?.actualCash ?? ''}
                    onChange={event => {
                      setSavedAuditIds(current => { const next = new Set(current); next.delete(report.id); return next })
                      setInlineAudit(current => ({
                        ...current,
                        [report.id]: {
                          batchTotal: current[report.id]?.batchTotal ?? String(report.batch_total ?? 0),
                          actualCash: event.target.value,
                          varianceNote: current[report.id]?.varianceNote ?? report.variance_note ?? '',
                        },
                      }))
                    }}
                    placeholder="Actual cash required"
                    className="h-8 text-xs"
                  />
                </TableCell>
                <TableCell className="py-2 text-right text-xs font-semibold">
                  {(inlineAudit[report.id]?.actualCash ?? '').trim() === '' ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (() => {
                    const variance = getCashVariance(Number(inlineAudit[report.id]?.actualCash), Number(report.cash_total ?? 0), Number(report.cash_tip ?? 0))
                    return <span className={variance === 0 ? '' : variance > 0 ? 'text-emerald-700' : 'text-red-700'}>{formatCurrency(variance)}</span>
                  })()}
                </TableCell>
                <TableCell className="py-2">
                  <Input
                    value={inlineAudit[report.id]?.varianceNote ?? ''}
                    onChange={event => setInlineAudit(current => ({
                      ...current,
                      [report.id]: {
                        batchTotal: current[report.id]?.batchTotal ?? String(report.batch_total ?? 0),
                        actualCash: current[report.id]?.actualCash ?? (report.actual_cash_on_hand > 0 ? String(report.actual_cash_on_hand) : ''),
                        varianceNote: event.target.value,
                      },
                    }))}
                    placeholder="Explain any over / short amount"
                    className="h-8 text-xs"
                  />
                </TableCell>
                <TableCell className="max-w-[120px] py-2 text-xs text-muted-foreground">
                  <span className="truncate block">{report.memo ?? '—'}</span>
                </TableCell>
                <TableCell className="py-2 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openEditDialog(report)}>
                      Edit
                    </Button>
                    {savedAuditIds.has(report.id) ? (
                      <Button size="sm" className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-600 cursor-default" disabled>
                        Saved
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => void handleAuditSave(report)}
                        disabled={
                          auditSavingId === report.id ||
                          !hasInlineAuditChanges(report)
                        }
                      >
                        {auditSavingId === report.id ? 'Saving…' : 'Save'}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filteredEodReports.length === 0 && (
              <TableRow>
                <TableCell colSpan={13} className="py-6 text-center text-muted-foreground">No EOD reports for this range</TableCell>
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
                <TableCell className={`text-right font-semibold ${totals.variance === 0 ? '' : totals.variance > 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(totals.variance)}</TableCell>
                <TableCell />
                <TableCell />
                <TableCell />
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingReportId ? 'Edit Manual EOD Entry' : 'Add Manual EOD Entry'}</DialogTitle>
            <DialogDescription>
              Use this for missed days or corrections. Revenue, tips, and cash audit values recalculate automatically when you save.
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
                  <span className={form.closed_by_employee_id ? '' : 'text-muted-foreground'}>
                    {form.closed_by_employee_id
                      ? (employees.find(employee => employee.id === form.closed_by_employee_id)?.name ?? 'Unknown staff')
                      : 'None'}
                  </span>
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
              <Label>EOD Cash</Label>
              <Input
                type="number"
                step="0.01"
                value={form.cash_total}
                onChange={event => setForm(current => ({ ...current, cash_total: event.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Total Batch Amount</Label>
              <Input
                type="number"
                step="0.01"
                value={form.batch_total}
                onChange={event => setForm(current => ({ ...current, batch_total: event.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Sales Tax</Label>
              <Input
                type="number"
                step="0.01"
                value={form.sales_tax}
                onChange={event => setForm(current => ({ ...current, sales_tax: event.target.value }))}
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
            <div>
              <Label>Actual Cash on Hand</Label>
              <Input
                type="number"
                step="0.01"
                value={form.actual_cash_on_hand}
                onChange={event => setForm(current => ({ ...current, actual_cash_on_hand: event.target.value }))}
                className="mt-1"
              />
            </div>
          </div>

          <div className="rounded-xl border bg-amber-50/60 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Cash Audit</div>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div>
                <Label>Actual Cash on Hand</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.actual_cash_on_hand}
                  onChange={event => setForm(current => ({ ...current, actual_cash_on_hand: event.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Variance</Label>
                {form.actual_cash_on_hand.trim() === '' ? (
                  <div className="mt-1 flex h-10 items-center rounded-md border bg-white px-3 text-sm text-muted-foreground">
                    Enter actual cash
                  </div>
                ) : (() => {
                  const variance = getCashVariance(Number(form.actual_cash_on_hand), Number(form.cash_total || 0), Number(form.cash_tip || 0))
                  return (
                    <div className={`mt-1 flex h-10 items-center rounded-md border bg-white px-3 text-sm font-semibold ${variance === 0 ? '' : variance > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {formatCurrency(variance)}
                    </div>
                  )
                })()}
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Actual Cash on Hand - (EOD Cash + Cash Tip) = Variance
            </p>
          </div>

          <div>
            <Label>Variance Note</Label>
            <Textarea
              value={form.variance_note}
              onChange={event => setForm(current => ({ ...current, variance_note: event.target.value }))}
              className="mt-1"
              rows={3}
              placeholder="Explain any over / short amount"
            />
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
            <Button onClick={handleSaveClick} disabled={saving}>
              {saving ? 'Saving…' : editingReportId ? 'Save Changes' : 'Create Entry'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PinModal
        open={showEditPin}
        title="Approve EOD Edit"
        description="Enter manager PIN to save these EOD changes"
        onConfirm={handleEditPinConfirm}
        onClose={() => { setShowEditPin(false); setEditPinError(null) }}
        error={editPinError}
      />
    </div>
  )
}
