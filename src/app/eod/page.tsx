'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Employee, DailySession, EodReport, TipDistribution, ShiftClock, Schedule } from '@/lib/types'
import { formatHours, getBusinessDate, getBusinessDateString } from '@/lib/dateUtils'
import { getEffectiveClockHours } from '@/lib/clockUtils'
import { calculateTips } from '@/lib/tipCalc'
import { insertTipDistributionsWithFallback } from '@/lib/tipDistributionWrite'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Lock, Plus, Trash2, Send, CheckCircle2 } from 'lucide-react'
import { format } from 'date-fns'
import { PinModal } from '@/components/layout/PinModal'
import { ClockToolbar } from '@/components/dashboard/ClockToolbar'

interface TipRow {
  employee_id: string
  hours_worked: number
  clock_in_at: string | null
  clock_out_at: string | null
  name: string
}

function aggregateClockTipRows(records: ShiftClock[], employees: Employee[]): TipRow[] {
  const grouped = new Map<string, TipRow>()

  for (const record of records) {
    const employee = employees.find(item => item.id === record.employee_id)
    if (!employee || !isTipEligibleRole(employee.role)) continue

    const existing = grouped.get(record.employee_id) ?? {
      employee_id: record.employee_id,
      hours_worked: 0,
      clock_in_at: null,
      clock_out_at: null,
      name: employee.name,
    }

    existing.hours_worked += getEffectiveClockHours(record)
    existing.clock_in_at = !existing.clock_in_at || new Date(record.clock_in_at) < new Date(existing.clock_in_at)
      ? record.clock_in_at
      : existing.clock_in_at
    existing.clock_out_at = record.clock_out_at
      ? (!existing.clock_out_at || new Date(record.clock_out_at) > new Date(existing.clock_out_at) ? record.clock_out_at : existing.clock_out_at)
      : existing.clock_out_at
    existing.name = employee.name

    grouped.set(record.employee_id, existing)
  }

  return [...grouped.values()]
}

function formatClockTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function isoToTimeValue(value: string | null) {
  if (!value) return '00:00:00'
  const date = new Date(value)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}


function getTipDraftKey(sessionDate: string) {
  return `eod-tip-distribution:${sessionDate}`
}

function getFinancialDraftKey(sessionDate: string) {
  return `eod-financials:${sessionDate}`
}

function isTipEligibleRole(role: Employee['role']) {
  return role === 'manager' || role === 'server' || role === 'busser' || role === 'runner'
}

function isEodCloserRole(role: Employee['role']) {
  return role === 'manager' || role === 'server' || role === 'busser' || role === 'runner'
}

function getStepStyles(state: 'saved' | 'dirty' | 'ready' | 'locked') {
  switch (state) {
    case 'saved':
      return {
        card: 'border-emerald-300 bg-emerald-50',
        badge: 'bg-emerald-600 text-white',
        title: 'text-emerald-950',
        body: 'text-emerald-800',
        status: 'text-emerald-700',
      }
    case 'dirty':
      return {
        card: 'border-amber-300 bg-amber-50',
        badge: 'bg-amber-500 text-white',
        title: 'text-amber-950',
        body: 'text-amber-800',
        status: 'text-amber-700',
      }
    case 'ready':
      return {
        card: 'border-blue-300 bg-blue-50',
        badge: 'bg-blue-600 text-white',
        title: 'text-blue-950',
        body: 'text-blue-800',
        status: 'text-blue-700',
      }
    default:
      return {
        card: 'border-slate-200 bg-slate-50',
        badge: 'bg-slate-300 text-slate-700',
        title: 'text-slate-900',
        body: 'text-slate-600',
        status: 'text-slate-500',
      }
  }
}

export default function EodPage() {
  const businessDate = getBusinessDate()
  const today = getBusinessDateString()
  const [session, setSession] = useState<DailySession | null>(null)
  const [appCanManageAdmin, setAppCanManageAdmin] = useState(false)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [clockRecords, setClockRecords] = useState<ShiftClock[]>([])
  const [existing, setExisting] = useState<EodReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null)
  const [currentReportId, setCurrentReportId] = useState<string | null>(null)
  const [submissionComplete, setSubmissionComplete] = useState(false)
  const [managerOverride, setManagerOverride] = useState(false)
  const [showUnlockPin, setShowUnlockPin] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [showResetPin, setShowResetPin] = useState(false)
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const [resetError, setResetError] = useState<string | null>(null)
  const [showFinancialConfirm, setShowFinancialConfirm] = useState(false)
  const [showClockWarningConfirm, setShowClockWarningConfirm] = useState(false)
  const [financialsSaved, setFinancialsSaved] = useState(false)
  const [tipDistributionSaved, setTipDistributionSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [startingCash, setStartingCash] = useState<number>(0)
  const [coinSubtotalOverride, setCoinSubtotalOverride] = useState<string>('')
  const [billSubtotalOverride, setBillSubtotalOverride] = useState<string>('')
  const [denoms, setDenoms] = useState<Record<string, { count: string; amount: string }>>({
    d100: { count: '', amount: '' }, d50: { count: '', amount: '' },
    d20: { count: '', amount: '' },  d10: { count: '', amount: '' },
    d5:  { count: '', amount: '' },  d1:  { count: '', amount: '' },
    c25: { count: '', amount: '' },  c10: { count: '', amount: '' },
    c5:  { count: '', amount: '' },  c1:  { count: '', amount: '' },
  })

  const [form, setForm] = useState({
    cash_total: '',
    net_revenue: '',
    cc_tip: '',
    cash_tip: '',
    sales_tax: '',
    memo: '',
    closed_by: '',
  })
  const [tipRows, setTipRows] = useState<TipRow[]>([])
  const employeeNameById = new Map(employees.map(employee => [employee.id, employee.name]))
  const tipEligibleEmployees = employees.filter(employee => isTipEligibleRole(employee.role))
  const eodCloserEmployees = employees.filter(employee => isEodCloserRole(employee.role))

  const toFinancialForm = useCallback((value: Partial<{
    cash_total: string | number | null
    batch_total: string | number | null
    net_revenue: string | number | null
    tip_total: string | number | null
    cc_tip: string | number | null
    cash_tip: string | number | null
    sales_tax: string | number | null
    memo: string | null
    closed_by: string | null
  }>) => {
    const cashTotal = value.cash_total != null ? String(value.cash_total) : ''
    const salesTax = value.sales_tax != null ? String(value.sales_tax) : ''
    const hasLegacyRevenueValues =
      value.batch_total != null ||
      value.net_revenue != null ||
      cashTotal.trim() !== '' ||
      salesTax.trim() !== ''
    const resolvedNetRevenue = value.net_revenue != null
      ? String(value.net_revenue)
      : hasLegacyRevenueValues
        ? String(
            Math.max(
              0,
              (Number(value.cash_total ?? 0) || 0) +
              (Number(value.batch_total ?? 0) || 0) -
              (Number(value.sales_tax ?? 0) || 0) -
              (Number(value.tip_total ?? 0) || 0)
            )
          )
        : ''

    return {
      cash_total: cashTotal,
      net_revenue: resolvedNetRevenue,
      cc_tip: value.cc_tip != null ? String(value.cc_tip) : '',
      cash_tip: value.cash_tip != null ? String(value.cash_tip) : '',
      sales_tax: salesTax,
      memo: value.memo ?? '',
      closed_by: value.closed_by ?? '',
    }
  }, [])

  const load = useCallback(async () => {
    const [sessRes, empRes, schRes, eodRes, clockRes, appSessionRes] = await Promise.all([
      supabase.from('daily_sessions').select('*').eq('session_date', today).maybeSingle(),
      supabase.from('employees').select('id, name, phone, email, role, primary_department, hourly_wage, guaranteed_hourly, birth_date, login_enabled, is_active, created_at').eq('is_active', true).order('name'),
      supabase.from('schedules').select('*').eq('date', today),
      supabase.from('eod_reports').select('*, tip_distributions(*, employee:employees(*))').eq('session_date', today).maybeSingle(),
      fetch(`/api/clock-events?session_date=${today}`, { cache: 'no-store' }).then(async res => (
        (await res.json().catch(() => ({}))) as { records?: ShiftClock[] }
      )),
      fetch('/api/app-session', { cache: 'no-store' }).then(async res => (
        (await res.json().catch(() => ({}))) as { can_manage_admin?: boolean }
      )),
    ])
    setSession(sessRes.data ?? null)
    setAppCanManageAdmin(appSessionRes.can_manage_admin === true)
    setStartingCash(Number(sessRes.data?.starting_cash ?? 0))
    setEmployees(empRes.data ?? [])
    setSchedules(schRes.data ?? [])
    setClockRecords(clockRes.records ?? [])

    const eod = eodRes.data as EodReport | null
    setExisting(eod)
    setCurrentReportId(eod?.id ?? null)

    if (eod) {
      const savedTipRows = (eod.tip_distributions ?? [])
        .filter((d: TipDistribution & { employee?: Employee }) => {
          const role = d.employee?.role ?? (empRes.data ?? []).find((employee: Employee) => employee.id === d.employee_id)?.role
          return !!role && isTipEligibleRole(role)
        })
        .map((d: TipDistribution & { employee?: Employee }) => {
          const clockRecord = (clockRes.records ?? []).find((record: ShiftClock) => record.employee_id === d.employee_id)
          return {
            employee_id: d.employee_id,
            hours_worked: Number(d.hours_worked ?? 0),
            clock_in_at: clockRecord?.clock_in_at ?? null,
            clock_out_at: clockRecord?.clock_out_at ?? null,
            name: d.employee?.name ?? '',
          }
        })

      setForm(toFinancialForm({
        cash_total: eod.cash_total,
        batch_total: eod.batch_total,
        tip_total: eod.tip_total,
        cc_tip: eod.cc_tip,
        cash_tip: eod.cash_tip,
        sales_tax: eod.sales_tax,
        memo: eod.memo,
        closed_by: eod.closed_by_employee_id,
      }))
      if (savedTipRows.length > 0) {
        setTipRows(savedTipRows)
      } else {
        const clockBasedRows = aggregateClockTipRows((clockRes.records ?? []) as ShiftClock[], empRes.data ?? [])
        setTipRows(clockBasedRows)
      }
      setFinancialsSaved(true)
      setTipDistributionSaved(savedTipRows.length > 0)
    } else {
      const clockBasedRows = aggregateClockTipRows((clockRes.records ?? []) as ShiftClock[], empRes.data ?? [])

      setTipRows(clockBasedRows)
      setFinancialsSaved(false)
      setTipDistributionSaved(false)
    }
    setLoading(false)
  }, [toFinancialForm, today])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (loading) return

    const storedFinancials = window.localStorage.getItem(getFinancialDraftKey(today))
    if (storedFinancials && !existing) {
      try {
        const parsed = JSON.parse(storedFinancials) as Partial<typeof form & { batch_total?: string }>
        setForm(toFinancialForm(parsed))
        setFinancialsSaved(true)
      } catch {
        window.localStorage.removeItem(getFinancialDraftKey(today))
      }
    }

    const stored = window.localStorage.getItem(getTipDraftKey(today))
    if (!stored || ((existing?.tip_distributions?.length ?? 0) > 0)) return

    try {
      const parsed = JSON.parse(stored) as TipRow[]
      if (Array.isArray(parsed)) {
        setTipRows(parsed)
        setTipDistributionSaved(true)
      }
    } catch {
      window.localStorage.removeItem(getTipDraftKey(today))
    }
  }, [existing, loading, toFinancialForm, today])

  const openClockRecords = clockRecords.filter(record => !record.clock_out_at)
  const openClockStaff = openClockRecords.map(record => ({
    id: record.id,
    employeeName: employeeNameById.get(record.employee_id) ?? 'Unknown staff',
    clockInAt: record.clock_in_at,
  }))
  const pendingApprovalRecords = clockRecords.filter(record => record.approval_status === 'pending_review')
  const hasOpenClockWarnings = openClockRecords.length > 0
  const hasManagerAccess = managerOverride || appCanManageAdmin
  const hasFinalizedEod = !!existing && (existing.tip_distributions?.length ?? 0) > 0
  const isLocked = !hasManagerAccess && (hasFinalizedEod || !session || session.current_phase !== 'complete')

  const DENOM_VALUES: Record<string, number> = {
    d100: 100, d50: 50, d20: 20, d10: 10, d5: 5,
    d1: 1, c25: 0.25, c10: 0.10, c5: 0.05, c1: 0.01,
  }
  const COIN_KEYS = ['c25', 'c10', 'c5', 'c1']
  const BILL_KEYS = ['d100', 'd50', 'd20', 'd10', 'd5', 'd1']
  const computedCoinTotal = COIN_KEYS.reduce((s, k) => s + (parseInt(denoms[k]?.count) || 0) * DENOM_VALUES[k], 0)
  const computedBillTotal = BILL_KEYS.reduce((s, k) => s + (parseInt(denoms[k]?.count) || 0) * DENOM_VALUES[k], 0)
  const effectiveCoinTotal = coinSubtotalOverride !== '' ? (parseFloat(coinSubtotalOverride) || 0) : computedCoinTotal
  const effectiveBillTotal = billSubtotalOverride !== '' ? (parseFloat(billSubtotalOverride) || 0) : computedBillTotal
  const registerTotal = effectiveCoinTotal + effectiveBillTotal
  const cashFromDrawer = Math.max(0, registerTotal - startingCash)

  const cashTotal = parseFloat(form.cash_total) || 0
  const netRevenue = parseFloat(form.net_revenue) || 0
  const tipTotal = (parseFloat(form.cc_tip) || 0) + (parseFloat(form.cash_tip) || 0)
  const salesTax = parseFloat(form.sales_tax) || 0
  const grossRevenue = netRevenue + salesTax + tipTotal
  const batchTotal = grossRevenue - cashTotal
  const totalCashDeposit = cashTotal + (parseFloat(form.cash_tip) || 0)

  const tipResults = calculateTips(
    tipTotal,
    tipRows.map(r => ({
      employee_id: r.employee_id,
      hours_worked: r.hours_worked,
    }))
  )

  const setField = (field: string, value: string) => {
    setFinancialsSaved(false)
    setForm(f => ({ ...f, [field]: value }))
  }

  const addTipRow = () => {
      const unusedEmp = tipEligibleEmployees.find(e => !tipRows.some(r => r.employee_id === e.id))
    if (!unusedEmp) return
    setTipDistributionSaved(false)
    const employeeClockRows = aggregateClockTipRows(clockRecords.filter(record => record.employee_id === unusedEmp.id), employees)
    const clockRecord = employeeClockRows[0]
    setTipRows(prev => [...prev, {
      employee_id: unusedEmp.id,
      hours_worked: clockRecord?.hours_worked ?? 0,
      clock_in_at: clockRecord?.clock_in_at ?? null,
      clock_out_at: clockRecord?.clock_out_at ?? null,
      name: unusedEmp.name,
    }])
  }

  const removeTipRow = (idx: number) => {
    setTipDistributionSaved(false)
    setTipRows(prev => prev.filter((_, i) => i !== idx))
  }

  const updateTipRowEmployee = (idx: number, value: string) => {
    setTipDistributionSaved(false)
    setTipRows(prev => prev.map((r, i) => {
      if (i !== idx) return r
      const emp = tipEligibleEmployees.find(e => e.id === value)
      const employeeClockRows = aggregateClockTipRows(clockRecords.filter(record => record.employee_id === value), employees)
      const clockRecord = employeeClockRows[0]
      return {
        ...r,
        employee_id: value,
        name: emp?.name ?? '',
        hours_worked: clockRecord?.hours_worked ?? 0,
        clock_in_at: clockRecord?.clock_in_at ?? null,
        clock_out_at: clockRecord?.clock_out_at ?? null,
      }
    }))
  }

  const handleTipDistributionSave = async () => {
    window.localStorage.setItem(getTipDraftKey(today), JSON.stringify(tipRows))
    setTipDistributionSaved(true)
    setSaveError(null)
  }

  const handleFinancialSave = async () => {
    if (batchTotal < 0) {
      setSaveError('Net revenue plus sales tax and total tip must be at least as much as cash amount.')
      return
    }

    window.localStorage.setItem(getFinancialDraftKey(today), JSON.stringify(form))
    setSaveError(null)

    try {
      const payload = {
        session_date: today,
        closed_by_employee_id: form.closed_by || null,
        starting_cash: startingCash,
        cash_total: cashTotal,
        batch_total: batchTotal,
        revenue_total: grossRevenue,
        cc_tip: parseFloat(form.cc_tip) || 0,
        cash_tip: parseFloat(form.cash_tip) || 0,
        tip_total: tipTotal,
        cash_deposit: totalCashDeposit,
        sales_tax: salesTax,
        memo: form.memo || null,
        updated_at: new Date().toISOString(),
      }

      let reportId = currentReportId

      if (existing) {
        const updateResult = await supabase
          .from('eod_reports')
          .update(payload)
          .eq('id', existing.id)
          .select()
          .single()

        if (updateResult.error || !updateResult.data) throw updateResult.error ?? new Error('Failed to save revenue and tips.')
        reportId = updateResult.data.id
        setExisting(current => current
          ? { ...current, ...(updateResult.data as EodReport), tip_distributions: current.tip_distributions }
          : (updateResult.data as EodReport)
        )
      } else {
        const insertResult = await supabase
          .from('eod_reports')
          .insert(payload)
          .select()
          .single()

        if (insertResult.error || !insertResult.data) throw insertResult.error ?? new Error('Failed to save revenue and tips.')
        reportId = insertResult.data.id
        setExisting({ ...(insertResult.data as EodReport), tip_distributions: [] })
      }

      setCurrentReportId(reportId ?? null)
      setFinancialsSaved(true)
      setShowFinancialConfirm(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save revenue and tips.'
      setSaveError(message)
    }
  }

  const saveTipDistributions = async (reportId: string) => {
    if (tipRows.length === 0) return

    const rows = tipRows.map(row => {
      const result = tipResults.find(r => r.employee_id === row.employee_id)
      return {
        eod_report_id: reportId,
        employee_id: row.employee_id,
        start_time: row.clock_in_at ? isoToTimeValue(row.clock_in_at) : null,
        end_time: row.clock_out_at ? isoToTimeValue(row.clock_out_at) : null,
        hours_worked: row.hours_worked,
        tip_share: result?.tip_share ?? 0,
        house_deduction: result?.house_deduction ?? 0,
        net_tip: result?.net_tip ?? 0,
      }
    })

    await insertTipDistributionsWithFallback(supabase, rows)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      if (batchTotal < 0) {
        throw new Error('Net revenue plus sales tax and total tip must be at least as much as cash amount.')
      }

      const payload = {
        session_date: today,
        closed_by_employee_id: form.closed_by || null,
        starting_cash: startingCash,
        cash_total: cashTotal,
        batch_total: batchTotal,
        revenue_total: grossRevenue,
        cc_tip: parseFloat(form.cc_tip) || 0,
        cash_tip: parseFloat(form.cash_tip) || 0,
        tip_total: tipTotal,
        cash_deposit: totalCashDeposit,
        sales_tax: salesTax,
        memo: form.memo || null,
        updated_at: new Date().toISOString(),
      }

      let reportId: string
      if (existing) {
        const updateResult = await supabase.from('eod_reports').update(payload).eq('id', existing.id)
        if (updateResult.error) throw updateResult.error
        reportId = existing.id
        const deleteResult = await supabase.from('tip_distributions').delete().eq('eod_report_id', existing.id)
        if (deleteResult.error) throw deleteResult.error
      } else {
        const insertResult = await supabase.from('eod_reports').insert(payload).select().single()
        if (insertResult.error || !insertResult.data) throw insertResult.error ?? new Error('Failed to save EOD')
        reportId = insertResult.data.id
      }

      await saveTipDistributions(reportId)
      const sheetSync = await fetch('/api/eod-sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_id: reportId }),
      })
      const sheetSyncPayload = await sheetSync.json().catch(() => ({})) as {
        error?: string
        eod?: { error?: string; success?: boolean; skipped?: boolean; reason?: string }
        cashLog?: { error?: string; success?: boolean; skipped?: boolean; reason?: string }
      }
      if (!sheetSync.ok) {
        const detail = [
          sheetSyncPayload.eod?.error ? `EOD sheet: ${sheetSyncPayload.eod.error}` : '',
          sheetSyncPayload.cashLog?.error ? `Cash Log: ${sheetSyncPayload.cashLog.error}` : '',
          sheetSyncPayload.error ?? '',
        ].filter(Boolean).join(' | ')
        setSaveError(`EOD saved, but Google Sheets sync failed${detail ? `: ${detail}` : '.'}`)
      }

      await load()
      window.localStorage.removeItem(getFinancialDraftKey(today))
      window.localStorage.removeItem(getTipDraftKey(today))
      setFinancialsSaved(true)
      setTipDistributionSaved(true)
      setCurrentReportId(reportId)
      setSubmissionComplete(false)
      setShowConfirm(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save EOD.'
      setSaveError(message)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveClick = () => {
    if (hasOpenClockWarnings) {
      setShowClockWarningConfirm(true)
      return
    }
    void handleSave()
  }

  const handleSubmit = async () => {
    if (!currentReportId) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/send-eod-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eod_report_id: currentReportId }),
      })
      const data = await res.json().catch(() => ({})) as { success?: boolean; sent?: number; errors?: string[]; error?: string }
      if (res.status >= 500 || (!res.ok && res.status !== 207)) {
        const message = data.error || 'Failed to send emails. Please try again.'
        throw new Error(message)
      }
      // 207 = partial success (some sent, some failed e.g. missing email address)
      const sentCount = typeof data.sent === 'number' ? data.sent : null
      const partialNote = data.errors?.length ? ` (${data.errors.length} skipped — missing email)` : ''
      setSubmitResult({ success: true, message: `EOD report sent${sentCount !== null ? ` — ${sentCount} email${sentCount !== 1 ? 's' : ''} delivered` : ''}${partialNote}.` })
      setSubmissionComplete(true)
      setShowConfirm(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send emails. Please try again.'
      setSubmitResult({ success: false, message })
    }
    setSubmitting(false)
  }

  const handleManagerUnlock = async (pin: string) => {
    setUnlockError(null)

    const res = await fetch('/api/manager-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    })

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setUnlockError(data.error ?? 'Manager PIN required')
      throw new Error(data.error ?? 'Manager PIN required')
    }

    setManagerOverride(true)
    setShowUnlockPin(false)
  }

  const handleManagerReset = async (pin: string) => {
    if (!existing) {
      setResetError('No saved EOD report to reset.')
      throw new Error('No saved EOD report to reset.')
    }

    setResetError(null)

    const pinRes = await fetch('/api/manager-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    })

    if (!pinRes.ok) {
      const data = (await pinRes.json().catch(() => ({}))) as { error?: string }
      const message = data.error ?? 'Manager PIN required'
      setResetError(message)
      throw new Error(message)
    }

    setSaving(true)
    try {
      const deleteTips = await supabase.from('tip_distributions').delete().eq('eod_report_id', existing.id)
      if (deleteTips.error) throw deleteTips.error

      const deleteReport = await supabase.from('eod_reports').delete().eq('id', existing.id)
      if (deleteReport.error) throw deleteReport.error

      setExisting(null)
      setCurrentReportId(null)
      setSubmissionComplete(false)
      setShowConfirm(false)
      setSubmitResult(null)
      setManagerOverride(false)
      window.localStorage.removeItem(getFinancialDraftKey(today))
      window.localStorage.removeItem(getTipDraftKey(today))
      await load()
      setShowResetPin(false)
      setShowResetConfirm(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset EOD.'
      setResetError(message)
      throw error instanceof Error ? error : new Error(message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-muted-foreground">Loading…</div>

  const closedByName = employees.find(e => e.id === form.closed_by)?.name ?? 'N/A'

  // Confirm dialog rendered outside locked gate so it persists after session is reset
  const confirmDialog = (
    <Dialog open={showConfirm} onOpenChange={v => { if (!v) { setShowConfirm(false); setSubmitResult(null) } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>EOD Summary — {format(businessDate, 'MMM d, yyyy')}</DialogTitle>
        </DialogHeader>

        {submitResult ? (
          <div className={`rounded-lg p-4 text-center ${submitResult.success ? 'bg-green-50 border border-green-300' : 'bg-red-50 border border-red-300'}`}>
            {submitResult.success && <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />}
            <p className={`font-medium ${submitResult.success ? 'text-green-800' : 'text-red-700'}`}>{submitResult.message}</p>
            <Button className="mt-4 w-full" onClick={() => { setShowConfirm(false); setSubmitResult(null) }}>Close</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Closed By</span><span className="font-medium">{closedByName}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Starting Cash</span><span>${startingCash.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Cash Amount</span><span>${cashTotal.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Net Revenue</span><span>${netRevenue.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Sales Tax</span><span>${salesTax.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Calculated Batch</span><span>${batchTotal.toFixed(2)}</span></div>
              <div className="flex justify-between font-semibold border-t pt-2"><span>Gross Revenue</span><span>${grossRevenue.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">CC Tips</span><span>${(parseFloat(form.cc_tip) || 0).toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Cash Tips</span><span>${(parseFloat(form.cash_tip) || 0).toFixed(2)}</span></div>
              <div className="flex justify-between font-semibold border-t pt-2"><span>Tip Total</span><span className="text-green-700">${tipTotal.toFixed(2)}</span></div>
              <div className="flex justify-between font-semibold"><span>Total Cash Deposit</span><span>${totalCashDeposit.toFixed(2)}</span></div>
              {form.memo && <div className="border-t pt-2 text-muted-foreground italic">{form.memo}</div>}
            </div>

            {tipResults.length > 0 && (
              <div>
                <p className="text-sm font-semibold mb-2">Tip Distribution</p>
                <div className="space-y-1">
                  {tipResults.map(r => {
                    const emp = employees.find(e => e.id === r.employee_id)
                    const row = tipRows.find(tr => tr.employee_id === r.employee_id)
                    const hasEmail = !!emp?.email
                    return (
                      <div key={r.employee_id} className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-1.5">
                        <div>
                          <span className="font-medium">{emp?.name}</span>
                          {hasEmail
                            ? <span className="ml-2 text-xs text-green-600">✓ email</span>
                            : <span className="ml-2 text-xs text-amber-500">no email</span>
                          }
                        </div>
                        <div className="text-right">
                          <span className="text-muted-foreground text-xs mr-3">{row ? formatHours(row.hours_worked) : ''}</span>
                          <span className="font-semibold text-green-700">${r.net_tip.toFixed(2)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-2">Employees with email will receive their individual tip breakdown.</p>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowConfirm(false)}>Back to Edit</Button>
              <Button className="flex-1" onClick={handleSubmit} disabled={submitting}>
                <Send className="w-4 h-4 mr-2" />
                {submitting ? 'Sending…' : 'Submit & Send Emails'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )

  const eodAlreadySaved = hasFinalizedEod
  const canSaveFinancials =
    form.cash_total.trim() !== '' &&
    form.net_revenue.trim() !== '' &&
    form.cc_tip.trim() !== '' &&
    form.cash_tip.trim() !== '' &&
    form.sales_tax.trim() !== '' &&
    batchTotal >= 0
  const financialStepState: 'saved' | 'dirty' | 'locked' =
    financialsSaved ? 'saved' : canSaveFinancials ? 'dirty' : 'locked'
  const tipStepState: 'saved' | 'dirty' | 'ready' | 'locked' =
    !financialsSaved ? 'locked' : tipDistributionSaved ? 'saved' : 'dirty'
  const eodStepState: 'saved' | 'ready' | 'locked' =
    eodAlreadySaved && !managerOverride ? 'saved' : financialsSaved && tipDistributionSaved ? 'ready' : 'locked'
  const financialStyles = getStepStyles(financialStepState)
  const tipStyles = getStepStyles(tipStepState)
  const eodStyles = getStepStyles(eodStepState)

  return (
    <>
      {confirmDialog}
      <Dialog open={showFinancialConfirm} onOpenChange={setShowFinancialConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{hasOpenClockWarnings ? 'Clock-Out Check Required' : 'Revenue & Tips Saved'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="rounded-lg border bg-amber-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Cash Drop Amount</p>
              <p className="mt-1 text-2xl font-bold text-amber-900">${totalCashDeposit.toFixed(2)}</p>
            </div>
            <div className="rounded-lg border bg-gray-50 p-4 text-gray-700">
              <p className="font-medium">Drop Instructions</p>
              <p className="mt-2">Combine this cash amount with the Toast printout slip and place it in the cash drop.</p>
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-amber-900">
                <p className="font-medium">Before Tip Distribution</p>
                <p className="mt-1">Make sure everyone clocks out before you proceed. Tip Distribution uses clock-in / clock-out hours, so tips will not calculate correctly until clock-outs are completed.</p>
              </div>
              <p className="mt-2">Next, complete the Tip Distribution section below. After Tip Distribution is saved, `Save EOD` will activate.</p>
            </div>

            {hasOpenClockWarnings && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
                <p className="font-medium">These staff members are still clocked in:</p>
                <div className="mt-3 space-y-2">
                  {openClockStaff.map((record) => (
                    <div key={record.id} className="flex items-center justify-between rounded-md bg-white/70 px-3 py-2 text-sm">
                      <span className="font-medium">{record.employeeName}</span>
                      <span className="text-red-700">In since {formatClockTime(record.clockInAt)}</span>
                    </div>
                  ))}
                </div>
                <Button
                  className="mt-4 w-full"
                  onClick={() => {
                    setShowFinancialConfirm(false)
                    document.getElementById('clock-actions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                >
                  Go to Clock In / Clock Out
                </Button>
              </div>
            )}

            <Button className="w-full" variant={hasOpenClockWarnings ? 'outline' : 'default'} onClick={() => setShowFinancialConfirm(false)}>
              Continue to Tip Distribution
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={showClockWarningConfirm} onOpenChange={setShowClockWarningConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Clock-Out Warning</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
              <p className="font-medium">{openClockRecords.length} staff member{openClockRecords.length > 1 ? 's are' : ' is'} still clocked in.</p>
              <p className="mt-2">You can still save EOD, but open clock records should be checked again before payroll. Tip Distribution is using current clock-based hours.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowClockWarningConfirm(false)}>
                Back
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  setShowClockWarningConfirm(false)
                  void handleSave()
                }}
              >
                Save Anyway
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Saved EOD</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-900">
              <p className="font-medium">This will remove the saved EOD values for {format(businessDate, 'MMM d, yyyy')}.</p>
              <p className="mt-2">After reset, the screen will reload with current clock-based tip rows so the report can be replaced.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowResetConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => {
                  setShowResetConfirm(false)
                  setShowResetPin(true)
                }}
              >
                Continue
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <div className="max-w-4xl p-6">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">End of Day — {format(businessDate, 'MMM d, yyyy')}</h1>
          </div>
          <div id="clock-actions" className="flex justify-start md:justify-end">
            <ClockToolbar schedules={schedules} clockRecords={clockRecords} today={today} onRefresh={load} />
          </div>
        </div>

        {submissionComplete ? (
          <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center p-8">
            <CheckCircle2 className="h-16 w-16 text-green-500" />
            <h1 className="text-3xl font-bold">EOD Submitted</h1>
            <p className="max-w-md text-muted-foreground">
              {submitResult?.message ?? 'EOD report and tip emails were sent successfully.'}
            </p>
            {(openClockRecords.length > 0 || pendingApprovalRecords.length > 0) && (
              <div className="max-w-lg rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-800">
                Attendance warning: some shift records still need follow-up. Open clock-outs should be checked again before final payroll review.
              </div>
            )}
            <div className="rounded-xl border bg-muted/40 px-6 py-4 text-sm text-muted-foreground">
              This EOD is now locked. Managers can still reopen it with override if needed.
            </div>
          </div>
        ) : isLocked ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
            <Lock className="w-16 h-16 text-gray-300" />
            <h2 className="text-2xl font-bold text-gray-400">EOD Locked</h2>
            <p className="text-muted-foreground max-w-sm">
              {eodAlreadySaved
                ? "Today's EOD has been saved. Complete tomorrow's tasks to unlock the next EOD."
                : 'Complete all tasks on the Dashboard (Pre-Shift → Operations → Closing) to unlock EOD.'
              }
            </p>
            {(openClockRecords.length > 0 || pendingApprovalRecords.length > 0) && (
              <div className="max-w-md rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {openClockRecords.length > 0 && <p>{openClockRecords.length} open clock-out{openClockRecords.length > 1 ? 's' : ''} still need attention.</p>}
                {pendingApprovalRecords.length > 0 && <p className="mt-1">{pendingApprovalRecords.length} auto clock-out{pendingApprovalRecords.length > 1 ? 's are' : ' is'} pending manager approval.</p>}
              </div>
            )}
            <div className="flex flex-col items-center gap-3">
              <Button variant="outline" onClick={() => setShowUnlockPin(true)}>
                Manager PIN Access
              </Button>
              <p className="max-w-sm text-xs text-muted-foreground">
                Managers can open EOD from here without waiting for all dashboard tasks to be completed.
              </p>
            </div>
            {eodAlreadySaved && (
              <div className="flex flex-col items-center gap-3">
                <Button variant="outline" onClick={() => setShowUnlockPin(true)}>
                  Manager Edit Override
                </Button>
                {hasOpenClockWarnings && (
                  <Button
                    variant="outline"
                    onClick={() => document.getElementById('clock-actions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  >
                    Go to Clock In / Clock Out
                  </Button>
                )}
                <Button variant="destructive" onClick={() => setShowResetConfirm(true)}>
                  Reset Saved EOD
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            {appCanManageAdmin && !managerOverride && (
              <div className="mb-6 rounded-xl border border-blue-300 bg-blue-50 px-5 py-4 text-sm text-blue-800">
                Manager access is active. You can view and prepare EOD before all dashboard tasks are complete.
              </div>
            )}
            {(openClockRecords.length > 0 || pendingApprovalRecords.length > 0) && (
              <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-800">
                <p className="font-semibold">Attendance Warning</p>
                {openClockRecords.length > 0 && (
                  <p className="mt-1">{openClockRecords.length} staff member{openClockRecords.length > 1 ? 's are' : ' is'} still clocked in. Tip Distribution is using clock-in / clock-out data, so open records currently carry zero worked hours.</p>
                )}
                {pendingApprovalRecords.length > 0 && (
                  <p className="mt-1">{pendingApprovalRecords.length} auto clock-out record{pendingApprovalRecords.length > 1 ? 's are' : ' is'} pending manager review. Those hours should be checked before payroll.</p>
                )}
                {openClockRecords.length > 0 && (
                  <Button
                    variant="outline"
                    className="mt-3"
                    onClick={() => document.getElementById('clock-actions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  >
                    Open Clock In / Clock Out
                  </Button>
                )}
              </div>
            )}

            <div className="mb-6 grid gap-3 md:grid-cols-3">
              <div className={`rounded-xl border p-4 text-center ${financialStyles.card}`}>
                <div className="flex flex-col items-center gap-2">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${financialStyles.badge}`}>1</span>
                  <div className={`font-semibold ${financialStyles.title}`}>Revenue & Tips</div>
                </div>
                <p className={`mt-2 text-xs ${financialStyles.body}`}>Enter revenue totals and save to unlock tip distribution.</p>
                <p className={`mt-2 text-[11px] font-semibold uppercase tracking-wide ${financialStyles.status}`}>
                  {financialsSaved ? 'Saved' : canSaveFinancials ? 'Ready to Save' : 'Waiting for Input'}
                </p>
              </div>
              <div className={`rounded-xl border p-4 text-center ${tipStyles.card}`}>
                <div className="flex flex-col items-center gap-2">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${tipStyles.badge}`}>2</span>
                  <div className={`font-semibold ${tipStyles.title}`}>Tip Distribution</div>
                </div>
                <p className={`mt-2 text-xs ${tipStyles.body}`}>Save FOH tip recipients and shift hours before final EOD save.</p>
                <p className={`mt-2 text-[11px] font-semibold uppercase tracking-wide ${tipStyles.status}`}>
                  {!financialsSaved ? 'Locked' : tipDistributionSaved ? 'Saved' : 'Needs Save'}
                </p>
              </div>
              <div className={`rounded-xl border p-4 text-center ${eodStyles.card}`}>
                <div className="flex flex-col items-center gap-2">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${eodStyles.badge}`}>3</span>
                  <div className={`font-semibold ${eodStyles.title}`}>Save EOD</div>
                </div>
                <p className={`mt-2 text-xs ${eodStyles.body}`}>Lock the report and move to the final send flow.</p>
                <p className={`mt-2 text-[11px] font-semibold uppercase tracking-wide ${eodStyles.status}`}>
                  {eodAlreadySaved && !managerOverride ? 'Saved' : financialsSaved && tipDistributionSaved ? 'Ready to Save' : 'Locked'}
                </p>
              </div>
            </div>

            {/* Cash Drawer Counter */}
            <div className={`rounded-xl border p-5 ${financialStyles.card}`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold">Cash Drawer Count</h2>
                <div className="flex items-center gap-3 rounded-lg bg-amber-50 border border-amber-300 px-4 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">Starting Cash</span>
                  <span className="text-xl font-bold text-amber-800">${startingCash.toFixed(2)}</span>
                </div>
              </div>

              {(() => {
                const coins = [
                  { key: 'c25', label: '¢25', value: 0.25 },
                  { key: 'c10', label: '¢10', value: 0.10 },
                  { key: 'c5',  label: '¢5',  value: 0.05 },
                  { key: 'c1',  label: '¢1',  value: 0.01 },
                ]
                const bills = [
                  { key: 'd100', label: '$100', value: 100 },
                  { key: 'd50',  label: '$50',  value: 50 },
                  { key: 'd20',  label: '$20',  value: 20 },
                  { key: 'd10',  label: '$10',  value: 10 },
                  { key: 'd5',   label: '$5',   value: 5 },
                  { key: 'd1',   label: '$1',   value: 1 },
                ]
                const recomputeCashTotal = (newDenoms: typeof denoms, coinOverride: string, billOverride: string) => {
                  const cCoins = COIN_KEYS.reduce((s, k) => s + (parseInt(newDenoms[k]?.count) || 0) * DENOM_VALUES[k], 0)
                  const cBills = BILL_KEYS.reduce((s, k) => s + (parseInt(newDenoms[k]?.count) || 0) * DENOM_VALUES[k], 0)
                  const effCoins = coinOverride !== '' ? (parseFloat(coinOverride) || 0) : cCoins
                  const effBills = billOverride !== '' ? (parseFloat(billOverride) || 0) : cBills
                  const total = effCoins + effBills
                  const hasAny = Object.values(newDenoms).some(d => d.count !== '') || coinOverride !== '' || billOverride !== ''
                  if (hasAny) setField('cash_total', Math.max(0, total - startingCash).toFixed(2))
                }
                const renderRow = ({ key, label, value }: { key: string; label: string; value: number }) => {
                  const { count, amount } = denoms[key]
                  const isCoin = COIN_KEYS.includes(key)
                  return (
                    <div key={key} className="flex items-center gap-1.5">
                      <span className="w-9 text-right text-sm font-semibold text-slate-600 shrink-0">{label}</span>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={count}
                        onChange={e => {
                          const c = e.target.value
                          const a = c ? ((parseInt(c) || 0) * value).toFixed(2) : ''
                          const newDenoms = { ...denoms, [key]: { count: c, amount: a } }
                          setDenoms(newDenoms)
                          // clear subtotal override for this group when counting individually
                          const newCoinOverride = isCoin ? '' : coinSubtotalOverride
                          const newBillOverride = !isCoin ? '' : billSubtotalOverride
                          if (isCoin) setCoinSubtotalOverride('')
                          else setBillSubtotalOverride('')
                          recomputeCashTotal(newDenoms, newCoinOverride, newBillOverride)
                        }}
                        placeholder="개수"
                        className="h-8 w-16 text-center text-xs px-1"
                      />
                      <span className="text-xs text-muted-foreground shrink-0">×</span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={amount}
                        onChange={e => {
                          const a = e.target.value
                          const c = a ? String(Math.round((parseFloat(a) || 0) / value)) : ''
                          const newDenoms = { ...denoms, [key]: { count: c, amount: a } }
                          setDenoms(newDenoms)
                          const newCoinOverride = isCoin ? '' : coinSubtotalOverride
                          const newBillOverride = !isCoin ? '' : billSubtotalOverride
                          if (isCoin) setCoinSubtotalOverride('')
                          else setBillSubtotalOverride('')
                          recomputeCashTotal(newDenoms, newCoinOverride, newBillOverride)
                        }}
                        placeholder="금액"
                        className="h-8 w-20 text-center text-xs px-1"
                      />
                    </div>
                  )
                }
                const renderSubtotalRow = ({ label, computed, override, setOverride, isCoin }: {
                  label: string; computed: number; override: string;
                  setOverride: (v: string) => void; isCoin: boolean
                }) => (
                  <div className={`mt-2 pt-2 border-t border-dashed ${isCoin ? '' : 'rounded-xl border-2 border-emerald-400 bg-emerald-50 px-4 py-4 shadow-sm'}`}>
                    <div className={`flex items-center gap-1.5 ${isCoin ? '' : 'justify-center'}`}>
                      <span className="w-9 shrink-0" />
                      <span className={`font-semibold uppercase tracking-wide text-center ${isCoin ? 'text-[11px] text-muted-foreground w-16' : 'text-sm font-extrabold text-emerald-900 w-28'}`}>
                        {isCoin ? label : 'Bill Total'}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0 invisible">×</span>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={override}
                        onChange={e => {
                          const nextValue = e.target.value
                          if (!/^\d*\.?\d{0,2}$/.test(nextValue)) return

                          setOverride(nextValue)
                          recomputeCashTotal(denoms, isCoin ? nextValue : coinSubtotalOverride, isCoin ? billSubtotalOverride : nextValue)
                        }}
                        onFocus={e => {
                          if (override === '') {
                            const initialValue = computed > 0 ? computed.toFixed(2) : ''
                            setOverride(initialValue)
                            requestAnimationFrame(() => e.target.select())
                          }
                        }}
                        onBlur={e => {
                          const trimmed = e.target.value.trim()
                          if (trimmed === '') {
                            setOverride('')
                            recomputeCashTotal(denoms, isCoin ? '' : coinSubtotalOverride, isCoin ? billSubtotalOverride : '')
                            return
                          }

                          const numericValue = Number(trimmed)
                          if (!Number.isFinite(numericValue)) return

                          const formattedValue = numericValue.toFixed(2)
                          setOverride(formattedValue)
                          recomputeCashTotal(denoms, isCoin ? formattedValue : coinSubtotalOverride, isCoin ? billSubtotalOverride : formattedValue)
                        }}
                        placeholder="0.00"
                        className={isCoin ? 'h-8 w-20 text-center text-xs px-1 font-semibold' : 'h-12 w-36 text-center text-lg px-3 font-extrabold border-2 border-emerald-500 bg-white shadow-sm'}
                      />
                    </div>
                    {!isCoin && (
                      <p className="mt-3 text-center text-sm font-bold leading-5 text-emerald-900">
                        Enter the total bills here if you want to skip counting each bill. This updates the <span className="font-bold">Cash Amount</span> below.
                      </p>
                    )}
                  </div>
                )
                return (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Coins</p>
                      <div className="space-y-1.5">{coins.map(renderRow)}</div>
                      {renderSubtotalRow({ label: 'Coin Total', computed: computedCoinTotal, override: coinSubtotalOverride, setOverride: setCoinSubtotalOverride, isCoin: true })}
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Bills</p>
                      <div className="space-y-1.5">{bills.map(renderRow)}</div>
                      {renderSubtotalRow({ label: 'Bill Total', computed: computedBillTotal, override: billSubtotalOverride, setOverride: setBillSubtotalOverride, isCoin: false })}
                    </div>
                  </div>
                )
              })()}

              <div className="flex items-center gap-3 rounded-lg bg-slate-100 px-4 py-3 text-sm flex-wrap">
                <span className="text-muted-foreground">Register Total</span>
                <span className="font-semibold">${registerTotal.toFixed(2)}</span>
                <span className="text-muted-foreground mx-1">−</span>
                <span className="text-muted-foreground">Starting Cash</span>
                <span className="font-semibold text-amber-700">${startingCash.toFixed(2)}</span>
                <span className="text-muted-foreground mx-1">=</span>
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cash Total</span>
                <span className={`text-lg font-bold ${registerTotal === 0 ? 'text-slate-400' : cashFromDrawer >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  ${cashFromDrawer.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Revenue */}
              <div className={`rounded-xl border p-5 ${financialStyles.card}`}>
                <h2 className="font-semibold mb-4">Revenue</h2>
                <div className="space-y-3">
                  <div>
                    <Label>Closed By</Label>
                    <Select value={form.closed_by} onValueChange={(v: string | null) => setField('closed_by', v ?? '')}>
                      <SelectTrigger>
                        <span className={form.closed_by ? '' : 'text-muted-foreground'}>
                          {form.closed_by ? (employeeNameById.get(form.closed_by) ?? 'Unknown staff') : 'Select staff'}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {eodCloserEmployees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Cash Amount</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={form.cash_total}
                        readOnly
                        aria-readonly="true"
                        placeholder="0.00"
                        className="bg-muted font-semibold text-slate-700"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">Imported from the cash drawer calculator above.</p>
                    </div>
                    <div>
                      <Label>Net Revenue</Label>
                      <Input type="number" step="0.01" value={form.net_revenue} onChange={e => setField('net_revenue', e.target.value)} placeholder="0.00" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Sales Tax</Label>
                      <Input type="number" step="0.01" value={form.sales_tax} onChange={e => setField('sales_tax', e.target.value)} placeholder="0.00" />
                    </div>
                    <div>
                      <Label>Calculated Batch</Label>
                      <div className="flex h-9 w-full items-center rounded-md border border-input bg-muted px-3 text-sm font-semibold">
                        ${batchTotal.toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <div>
                    <Label>Gross Revenue</Label>
                    <div className="flex h-9 w-full items-center rounded-md border border-input bg-muted px-3 text-sm font-semibold">
                      ${grossRevenue.toFixed(2)}
                    </div>
                  </div>
                  {batchTotal < 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      Net revenue plus sales tax and total tip must be at least as much as cash amount.
                    </div>
                  )}
                </div>
              </div>

              {/* Tips */}
              <div className={`rounded-xl border p-5 ${financialStyles.card}`}>
                <h2 className="font-semibold mb-4">Tips</h2>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>CC Tips</Label>
                      <Input type="number" step="0.01" value={form.cc_tip} onChange={e => setField('cc_tip', e.target.value)} placeholder="0.00" />
                    </div>
                    <div>
                      <Label>Cash Tips</Label>
                      <Input type="number" step="0.01" value={form.cash_tip} onChange={e => setField('cash_tip', e.target.value)} placeholder="0.00" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Tip Total</Label>
                      <div className="flex h-9 w-full items-center rounded-md border border-input bg-muted px-3 text-sm font-semibold">
                        ${tipTotal.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <Label>Expected Cash</Label>
                      <div className="flex h-9 w-full items-center rounded-md border border-input bg-muted px-3 text-sm font-semibold">
                        ${totalCashDeposit.toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <div>
                    <Label>Memo</Label>
                    <Textarea value={form.memo} onChange={e => setField('memo', e.target.value)} placeholder="Notes…" className="h-16 resize-none" />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex justify-center">
              <Button
                onClick={handleFinancialSave}
                disabled={!canSaveFinancials || saving || submitting}
                className={`h-12 min-w-64 text-base font-semibold ${
                  financialsSaved ? 'bg-emerald-600 hover:bg-emerald-700' : ''
                }`}
              >
                {financialsSaved ? 'Revenue & Tips Saved' : 'Save Revenue & Tips'}
              </Button>
            </div>
            <div className="mt-2 text-center text-xs text-muted-foreground">
              {!financialsSaved ? 'Fill in revenue and tip totals, then save to unlock Tip Distribution.' : 'Revenue and tips saved. Continue with Tip Distribution.'}
            </div>

            {/* Tip Distribution */}
            <div className={`rounded-xl border p-5 mt-6 ${tipStyles.card} ${!financialsSaved ? 'pointer-events-none opacity-60' : ''}`}>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">2</span>
                    <h2 className="font-semibold">Tip Distribution</h2>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    House takes 15% — distributing ${(tipTotal * 0.85).toFixed(2)} among staff using clock-in / clock-out hours
                  </p>
                  {!financialsSaved && (
                    <p className="mt-1 text-xs text-amber-600">Save Revenue & Tips first to activate this section.</p>
                  )}
                  {hasOpenClockWarnings && (
                    <p className="mt-1 text-xs text-amber-700">Warning: one or more team members are still clocked in. Open records stay at zero hours until clock-out is completed.</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={addTipRow}>
                    <Plus className="w-4 h-4 mr-1" /> Add Staff
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-135">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left pb-2 font-medium">Name</th>
                    <th className="text-left pb-2 font-medium w-40">Clock In / Out</th>
                    <th className="text-left pb-2 font-medium w-20">Hrs</th>
                    <th className="text-left pb-2 font-medium w-20">Share %</th>
                    <th className="text-left pb-2 font-medium w-28">Tip Amount</th>
                    <th className="text-left pb-2 font-medium w-24">Tip / Hr</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {tipRows.map((row, idx) => {
                    const result = tipResults.find(r => r.employee_id === row.employee_id)
                    const tipPerHour = row.hours_worked > 0 && result ? result.net_tip / row.hours_worked : null
                    return (
                      <tr key={idx} className="border-b">
                        <td className="py-2 pr-3">
                          <Select value={row.employee_id} onValueChange={(v: string | null) => v && updateTipRowEmployee(idx, v)}>
                            <SelectTrigger className="h-8">
                              <span className={row.employee_id ? '' : 'text-muted-foreground'}>
                                {employeeNameById.get(row.employee_id) ?? row.name ?? 'Select staff'}
                              </span>
                            </SelectTrigger>
                            <SelectContent>
                              {tipEligibleEmployees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">
                          {row.clock_in_at ? formatClockTime(row.clock_in_at) : '—'}
                          {' – '}
                          {row.clock_out_at ? formatClockTime(row.clock_out_at) : <span className="text-amber-500">open</span>}
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground text-xs">{formatHours(row.hours_worked)}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{result ? (result.tip_share * 100).toFixed(1) + '%' : '—'}</td>
                        <td className="py-2 font-semibold text-green-700">{result ? `$${result.net_tip.toFixed(2)}` : '—'}</td>
                        <td className="py-2 text-sm text-gray-700">{tipPerHour !== null ? `$${tipPerHour.toFixed(2)}` : '—'}</td>
                        <td className="py-2">
                          <Button size="sm" variant="ghost" className="text-red-400 h-7 w-7 p-0" onClick={() => removeTipRow(idx)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                  {tipRows.length === 0 && (
                    <tr><td colSpan={8} className="text-center text-muted-foreground py-4 text-sm">No staff added. Click &quot;Add Staff&quot; above.</td></tr>
                  )}
                </tbody>
              </table>
              </div>
              <div className={`mt-5 rounded-xl border px-4 py-4 text-center ${
                tipDistributionSaved ? 'border-emerald-200 bg-emerald-50' : 'border-blue-200 bg-blue-50'
              }`}>
                <div className={`text-sm font-semibold ${tipDistributionSaved ? 'text-emerald-900' : 'text-blue-900'}`}>
                  {tipDistributionSaved ? 'Step 2 Saved' : 'Step 2 Ready'}
                </div>
                <div className={`mt-1 text-xs ${tipDistributionSaved ? 'text-emerald-700' : 'text-blue-700'}`}>
                  Save tip recipients and clock-based hours before final EOD save.
                </div>
                <Button
                  className={`mt-4 h-12 min-w-64 text-base font-semibold ${
                    tipDistributionSaved ? 'bg-emerald-600 hover:bg-emerald-700' : ''
                  }`}
                  variant={tipDistributionSaved ? 'default' : 'outline'}
                  onClick={handleTipDistributionSave}
                  disabled={saving || submitting}
                >
                  {tipDistributionSaved ? 'Tip Distribution Saved' : 'Save Tip Distribution'}
                </Button>
              </div>
            </div>

            <div className="mt-3 text-center text-xs text-muted-foreground">
              {!financialsSaved
                ? 'Save Revenue & Tips first.'
                : !tipDistributionSaved
                  ? 'Save Tip Distribution first before saving EOD.'
                  : 'Tip Distribution saved and ready.'}
            </div>
            {saveError && (
              <div className="mt-2 text-center text-sm text-red-600">
                {saveError}
              </div>
            )}

            <div className="mt-4 flex justify-center">
              <Button
                onClick={handleSaveClick}
                disabled={saving || submitting || !financialsSaved || !tipDistributionSaved}
                className={`h-12 min-w-64 text-base font-semibold ${
                  eodAlreadySaved && !managerOverride ? 'bg-emerald-600 hover:bg-emerald-700' : ''
                }`}
              >
                {saving ? 'Saving…' : eodAlreadySaved && !managerOverride ? 'EOD Saved' : 'Save EOD'}
              </Button>
            </div>
            {existing && (
              <div className="mt-4 flex justify-center">
                <Button variant="destructive" onClick={() => setShowResetConfirm(true)} disabled={saving || submitting}>
                  Reset Saved EOD
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      <PinModal
        open={showUnlockPin}
        title="Unlock EOD"
        description="Enter manager PIN to open this EOD screen"
        onConfirm={handleManagerUnlock}
        onClose={() => { setShowUnlockPin(false); setUnlockError(null) }}
        error={unlockError}
      />
      <PinModal
        open={showResetPin}
        title="Reset Saved EOD"
        description="Manager PIN required to reset and replace this saved EOD"
        onConfirm={handleManagerReset}
        onClose={() => { setShowResetPin(false); setResetError(null) }}
        error={resetError}
      />
    </>
  )
}
