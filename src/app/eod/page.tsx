'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Employee, DailySession, EodReport, TipDistribution, ShiftClock } from '@/lib/types'
import { formatHours, getBusinessDate, getBusinessDateString } from '@/lib/dateUtils'
import { getEffectiveClockHours } from '@/lib/clockUtils'
import { calculateTips } from '@/lib/tipCalc'
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

interface TipRow {
  employee_id: string
  hours_worked: number
  clock_in_at: string | null
  clock_out_at: string | null
  name: string
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

function getClockTipRow(record: ShiftClock, employees: Employee[]): TipRow {
  const employee = employees.find(item => item.id === record.employee_id)
  return {
    employee_id: record.employee_id,
    hours_worked: getEffectiveClockHours(record),
    clock_in_at: record.clock_in_at,
    clock_out_at: record.clock_out_at,
    name: employee?.name ?? '',
  }
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
  const [employees, setEmployees] = useState<Employee[]>([])
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

  const [form, setForm] = useState({
    cash_total: '',
    batch_total: '',
    cc_tip: '',
    cash_tip: '',
    memo: '',
    closed_by: '',
  })
  const [tipRows, setTipRows] = useState<TipRow[]>([])
  const employeeNameById = new Map(employees.map(employee => [employee.id, employee.name]))
  const tipEligibleEmployees = employees.filter(employee => isTipEligibleRole(employee.role))
  const eodCloserEmployees = employees.filter(employee => isEodCloserRole(employee.role))

  const load = useCallback(async () => {
    const [sessRes, empRes, eodRes, clockRes] = await Promise.all([
      supabase.from('daily_sessions').select('*').eq('session_date', today).maybeSingle(),
      supabase.from('employees').select('*').eq('is_active', true).order('name'),
      supabase.from('eod_reports').select('*, tip_distributions(*, employee:employees(*))').eq('session_date', today).maybeSingle(),
      fetch(`/api/clock-events?session_date=${today}`, { cache: 'no-store' }).then(async res => (
        (await res.json().catch(() => ({}))) as { records?: ShiftClock[] }
      )),
    ])
    setSession(sessRes.data ?? null)
    setEmployees(empRes.data ?? [])
    setClockRecords(clockRes.records ?? [])

    const eod = eodRes.data as EodReport | null
    setExisting(eod)
    setCurrentReportId(eod?.id ?? null)

    if (eod) {
      setForm({
        cash_total: String(eod.cash_total),
        batch_total: String(eod.batch_total),
        cc_tip: String(eod.cc_tip),
        cash_tip: String(eod.cash_tip),
        memo: eod.memo ?? '',
        closed_by: eod.closed_by_employee_id ?? '',
      })
      setTipRows((eod.tip_distributions ?? [])
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
        }))
      setFinancialsSaved(true)
      setTipDistributionSaved(true)
    } else {
      const clockBasedRows: TipRow[] = ((clockRes.records ?? []) as ShiftClock[])
        .filter(record => {
          const emp = (empRes.data ?? []).find((employee: Employee) => employee.id === record.employee_id)
          return !!emp && isTipEligibleRole(emp.role)
        })
        .map(record => getClockTipRow(record, empRes.data ?? []))

      setTipRows(clockBasedRows)
      setFinancialsSaved(false)
      setTipDistributionSaved(false)
    }
    setLoading(false)
  }, [today])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (loading) return

    const storedFinancials = window.localStorage.getItem(getFinancialDraftKey(today))
    if (storedFinancials && !existing) {
      try {
        const parsed = JSON.parse(storedFinancials) as typeof form
        setForm(parsed)
        setFinancialsSaved(true)
      } catch {
        window.localStorage.removeItem(getFinancialDraftKey(today))
      }
    }

    const stored = window.localStorage.getItem(getTipDraftKey(today))
    if (!stored) return

    try {
      const parsed = JSON.parse(stored) as TipRow[]
      if (Array.isArray(parsed)) {
        setTipRows(parsed)
        setTipDistributionSaved(true)
      }
    } catch {
      window.localStorage.removeItem(getTipDraftKey(today))
    }
  }, [existing, loading, today])

  const openClockRecords = clockRecords.filter(record => !record.clock_out_at)
  const pendingApprovalRecords = clockRecords.filter(record => record.approval_status === 'pending_review')
  const hasOpenClockWarnings = openClockRecords.length > 0
  const isLocked = !managerOverride && (!!existing || !session || session.current_phase !== 'complete')

  const grossRevenue = (parseFloat(form.cash_total) || 0) + (parseFloat(form.batch_total) || 0)
  const tipTotal = (parseFloat(form.cc_tip) || 0) + (parseFloat(form.cash_tip) || 0)
  const totalCashDeposit = (parseFloat(form.cash_total) || 0) + (parseFloat(form.cash_tip) || 0)

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
    const clockRecord = clockRecords.find(record => record.employee_id === unusedEmp.id)
    setTipRows(prev => [...prev, {
      employee_id: unusedEmp.id,
      hours_worked: clockRecord ? getEffectiveClockHours(clockRecord) : 0,
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
      const clockRecord = clockRecords.find(record => record.employee_id === value)
      return {
        ...r,
        employee_id: value,
        name: emp?.name ?? '',
        hours_worked: clockRecord ? getEffectiveClockHours(clockRecord) : 0,
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
    window.localStorage.setItem(getFinancialDraftKey(today), JSON.stringify(form))
    setFinancialsSaved(true)
    setSaveError(null)
    setShowFinancialConfirm(true)
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

    const { error } = await supabase.from('tip_distributions').insert(rows)
    if (error) throw error
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const payload = {
        session_date: today,
        closed_by_employee_id: form.closed_by || null,
        cash_total: parseFloat(form.cash_total) || 0,
        batch_total: parseFloat(form.batch_total) || 0,
        revenue_total: grossRevenue,
        cc_tip: parseFloat(form.cc_tip) || 0,
        cash_tip: parseFloat(form.cash_tip) || 0,
        tip_total: tipTotal,
        cash_deposit: totalCashDeposit,
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
      if (!res.ok || data.success === false) {
        const message = data.errors?.join(' ') || data.error || 'Failed to send emails. Please try again.'
        throw new Error(message)
      }
      setSubmitResult({ success: true, message: `EOD report and tip emails sent successfully${typeof data.sent === 'number' ? ` (${data.sent} sent)` : '!'}` })
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
              <div className="flex justify-between"><span className="text-muted-foreground">Cash Total</span><span>${(parseFloat(form.cash_total) || 0).toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Batch Total</span><span>${(parseFloat(form.batch_total) || 0).toFixed(2)}</span></div>
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

  const eodAlreadySaved = !!existing
  const canSaveFinancials =
    form.cash_total.trim() !== '' &&
    form.batch_total.trim() !== '' &&
    form.cc_tip.trim() !== '' &&
    form.cash_tip.trim() !== ''
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
            <DialogTitle>Revenue & Tips Saved</DialogTitle>
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
            <Button className="w-full" onClick={() => setShowFinancialConfirm(false)}>
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
      <div className="p-6 max-w-4xl">
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
            {eodAlreadySaved && (
              <div className="flex flex-col items-center gap-3">
                <Button variant="outline" onClick={() => setShowUnlockPin(true)}>
                  Manager Edit Override
                </Button>
                <Button variant="destructive" onClick={() => setShowResetConfirm(true)}>
                  Reset Saved EOD
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold">End of Day — {format(businessDate, 'MMM d, yyyy')}</h1>
            </div>

            {(openClockRecords.length > 0 || pendingApprovalRecords.length > 0) && (
              <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-800">
                <p className="font-semibold">Attendance Warning</p>
                {openClockRecords.length > 0 && (
                  <p className="mt-1">{openClockRecords.length} staff member{openClockRecords.length > 1 ? 's are' : ' is'} still clocked in. Tip Distribution is using clock-in / clock-out data, so open records currently carry zero worked hours.</p>
                )}
                {pendingApprovalRecords.length > 0 && (
                  <p className="mt-1">{pendingApprovalRecords.length} auto clock-out record{pendingApprovalRecords.length > 1 ? 's are' : ' is'} pending manager review. Those hours should be checked before payroll.</p>
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

            <div className="grid grid-cols-2 gap-6">
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
                      <Label>Cash Total</Label>
                      <Input type="number" step="0.01" value={form.cash_total} onChange={e => setField('cash_total', e.target.value)} placeholder="0.00" />
                    </div>
                    <div>
                      <Label>Batch Total</Label>
                      <Input type="number" step="0.01" value={form.batch_total} onChange={e => setField('batch_total', e.target.value)} placeholder="0.00" />
                    </div>
                  </div>
                  <div>
                    <Label>Gross Revenue</Label>
                    <div className="flex h-9 w-full items-center rounded-md border border-input bg-muted px-3 text-sm font-semibold">
                      ${grossRevenue.toFixed(2)}
                    </div>
                  </div>
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
                      <Label>Total Cash Deposit</Label>
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
              <table className="w-full text-sm">
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
                {tipRows.length > 0 && (
                  <tfoot>
                    <tr className="border-t">
                      <td className="pt-2 font-semibold">Total</td>
                      <td />
                      <td className="pt-2 text-muted-foreground text-xs">{formatHours(tipRows.reduce((s, r) => s + r.hours_worked, 0))}</td>
                      <td />
                      <td className="pt-2 font-bold text-green-700">${tipResults.reduce((s, r) => s + r.net_tip, 0).toFixed(2)}</td>
                      <td />
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
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
        title="Unlock Saved EOD"
        description="Manager PIN required to reopen this EOD"
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
