'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Employee, Schedule, DailySession, EodReport, TipDistribution } from '@/lib/types'
import { calcHours, formatHours, getBusinessDate, getBusinessDateString } from '@/lib/dateUtils'
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
  start_time: string
  end_time: string
  name: string
}

function snapTimeToHalfHour(value: string) {
  const [hourText = '0', minuteText = '0'] = value.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const totalMinutes = hour * 60 + minute
  const snappedMinutes = Math.round(totalMinutes / 30) * 30
  const normalizedMinutes = ((snappedMinutes % (24 * 60)) + (24 * 60)) % (24 * 60)
  const nextHour = Math.floor(normalizedMinutes / 60)
  const nextMinute = normalizedMinutes % 60
  return `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`
}

function getAllowedTimeOptions() {
  const options: string[] = []
  for (let minutes = 15 * 60; minutes <= 27 * 60; minutes += 30) {
    const normalized = minutes % (24 * 60)
    const hour = Math.floor(normalized / 60)
    const minute = normalized % 60
    options.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
  }
  return options
}

function getTipDraftKey(sessionDate: string) {
  return `eod-tip-distribution:${sessionDate}`
}

export default function EodPage() {
  const businessDate = getBusinessDate()
  const today = getBusinessDateString()
  const [session, setSession] = useState<DailySession | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
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
  const [unlockError, setUnlockError] = useState<string | null>(null)
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
  const allowedTimeOptions = getAllowedTimeOptions()

  const load = useCallback(async () => {
    const [sessRes, empRes, schRes, eodRes] = await Promise.all([
      supabase.from('daily_sessions').select('*').eq('session_date', today).maybeSingle(),
      supabase.from('employees').select('*').eq('is_active', true).order('name'),
      supabase.from('schedules').select('*').eq('date', today),
      supabase.from('eod_reports').select('*, tip_distributions(*, employee:employees(*))').eq('session_date', today).maybeSingle(),
    ])
    setSession(sessRes.data ?? null)
    setEmployees(empRes.data ?? [])
    setSchedules(schRes.data ?? [])

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
      setTipRows((eod.tip_distributions ?? []).map((d: TipDistribution & { employee?: Employee }) => {
        const sched = (schRes.data ?? []).find((s: Schedule) => s.employee_id === d.employee_id)
        return {
          employee_id: d.employee_id,
          start_time: d.start_time ?? sched?.start_time ?? '00:00:00',
          end_time: d.end_time ?? sched?.end_time ?? '00:00:00',
          name: d.employee?.name ?? '',
        }
      }))
      setTipDistributionSaved(true)
    } else {
      const rows: TipRow[] = (schRes.data ?? []).map((s: Schedule) => {
        const emp = (empRes.data ?? []).find((e: Employee) => e.id === s.employee_id)
        return {
          employee_id: s.employee_id,
          start_time: s.start_time,
          end_time: s.end_time,
          name: emp?.name ?? '',
        }
      })
      setTipRows(rows)
      setTipDistributionSaved(false)
    }
    setLoading(false)
  }, [today])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (loading) return

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
  }, [loading, today])

  const isLocked = !managerOverride && (!!existing || !session || session.current_phase !== 'complete')

  const grossRevenue = (parseFloat(form.cash_total) || 0) + (parseFloat(form.batch_total) || 0)
  const tipTotal = (parseFloat(form.cc_tip) || 0) + (parseFloat(form.cash_tip) || 0)
  const totalCashDeposit = (parseFloat(form.cash_total) || 0) + (parseFloat(form.cash_tip) || 0)

  const tipResults = calculateTips(
    tipTotal,
    tipRows.map(r => ({
      employee_id: r.employee_id,
      hours_worked: calcHours(r.start_time, r.end_time),
    }))
  )

  const setField = (field: string, value: string) => setForm(f => ({ ...f, [field]: value }))

  const addTipRow = () => {
    const unusedEmp = employees.find(e => !tipRows.some(r => r.employee_id === e.id))
    if (!unusedEmp) return
    setTipDistributionSaved(false)
    const sched = schedules.find(s => s.employee_id === unusedEmp.id)
    setTipRows(prev => [...prev, {
      employee_id: unusedEmp.id,
      start_time: sched?.start_time ?? '00:00:00',
      end_time: sched?.end_time ?? '00:00:00',
      name: unusedEmp.name,
    }])
  }

  const removeTipRow = (idx: number) => {
    setTipDistributionSaved(false)
    setTipRows(prev => prev.filter((_, i) => i !== idx))
  }

  const updateTipRow = (idx: number, field: 'employee_id' | 'start_time' | 'end_time', value: string) => {
    setTipDistributionSaved(false)
    setTipRows(prev => prev.map((r, i) => {
      if (i !== idx) return r
      if (field === 'employee_id') {
        const emp = employees.find(e => e.id === value)
        const sched = schedules.find(s => s.employee_id === value)
        return {
          ...r,
          employee_id: value,
          name: emp?.name ?? '',
          start_time: sched?.start_time ?? '00:00:00',
          end_time: sched?.end_time ?? '00:00:00',
        }
      }
      return { ...r, [field]: value }
    }))
  }

  const handleTipDistributionSave = async () => {
    window.localStorage.setItem(getTipDraftKey(today), JSON.stringify(tipRows))
    setTipDistributionSaved(true)
    setSaveError(null)
  }

  const saveTipDistributions = async (reportId: string) => {
    if (tipRows.length === 0) return

    const rowsWithShiftTimes = tipRows.map(row => {
      const result = tipResults.find(r => r.employee_id === row.employee_id)
      const hoursWorked = calcHours(row.start_time, row.end_time)
      return {
        eod_report_id: reportId,
        employee_id: row.employee_id,
        start_time: row.start_time,
        end_time: row.end_time,
        hours_worked: hoursWorked,
        tip_share: result?.tip_share ?? 0,
        house_deduction: result?.house_deduction ?? 0,
        net_tip: result?.net_tip ?? 0,
      }
    })

    const insertWithTimes = await supabase.from('tip_distributions').insert(rowsWithShiftTimes)
    if (!insertWithTimes.error) return

    const isMissingShiftColumn = /start_time|end_time|schema cache|column/i.test(insertWithTimes.error.message)
    if (!isMissingShiftColumn) throw insertWithTimes.error

    const fallbackRows = rowsWithShiftTimes.map(row => ({
      eod_report_id: row.eod_report_id,
      employee_id: row.employee_id,
      hours_worked: row.hours_worked,
      tip_share: row.tip_share,
      house_deduction: row.house_deduction,
      net_tip: row.net_tip,
    }))
    const fallbackInsert = await supabase.from('tip_distributions').insert(fallbackRows)
    if (fallbackInsert.error) throw fallbackInsert.error
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
      window.localStorage.removeItem(getTipDraftKey(today))
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
                          <span className="text-muted-foreground text-xs mr-3">{row ? formatHours(calcHours(row.start_time, row.end_time)) : ''}</span>
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

  return (
    <>
      {confirmDialog}
      <div className="p-6 max-w-4xl">
        {submissionComplete ? (
          <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center p-8">
            <CheckCircle2 className="h-16 w-16 text-green-500" />
            <h1 className="text-3xl font-bold">EOD Submitted</h1>
            <p className="max-w-md text-muted-foreground">
              {submitResult?.message ?? 'EOD report and tip emails were sent successfully.'}
            </p>
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
            {eodAlreadySaved && (
              <Button variant="outline" onClick={() => setShowUnlockPin(true)}>
                Manager Edit Override
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold">End of Day — {format(businessDate, 'MMM d, yyyy')}</h1>
            </div>

            <div className="grid grid-cols-2 gap-6">
              {/* Revenue */}
              <div className="bg-white rounded-xl border p-5">
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
                        {employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
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
              <div className="bg-white rounded-xl border p-5">
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

            {/* Tip Distribution */}
            <div className="bg-white rounded-xl border p-5 mt-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-semibold">Tip Distribution</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    House takes 15% — distributing ${(tipTotal * 0.85).toFixed(2)} among staff
                  </p>
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
                    <th className="text-left pb-2 font-medium w-28">Start</th>
                    <th className="text-left pb-2 font-medium w-28">End</th>
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
                    const hrs = calcHours(row.start_time, row.end_time)
                    const tipPerHour = hrs > 0 && result ? result.net_tip / hrs : null
                    return (
                      <tr key={idx} className="border-b">
                        <td className="py-2 pr-3">
                          <Select value={row.employee_id} onValueChange={(v: string | null) => v && updateTipRow(idx, 'employee_id', v)}>
                            <SelectTrigger className="h-8">
                              <span className={row.employee_id ? '' : 'text-muted-foreground'}>
                                {employeeNameById.get(row.employee_id) ?? row.name ?? 'Select staff'}
                              </span>
                            </SelectTrigger>
                            <SelectContent>
                              {employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-2 pr-2">
                          <select
                            className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm"
                            value={row.start_time.slice(0, 5)}
                            onChange={e => updateTipRow(idx, 'start_time', snapTimeToHalfHour(e.target.value) + ':00')}
                          >
                            {allowedTimeOptions.map(option => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 pr-2">
                          <select
                            className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm"
                            value={row.end_time.slice(0, 5)}
                            onChange={e => updateTipRow(idx, 'end_time', snapTimeToHalfHour(e.target.value) + ':00')}
                          >
                            {allowedTimeOptions.map(option => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground text-xs">{formatHours(hrs)}</td>
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
                      <td /><td />
                      <td className="pt-2 text-muted-foreground text-xs">{formatHours(tipRows.reduce((s, r) => s + calcHours(r.start_time, r.end_time), 0))}</td>
                      <td />
                      <td className="pt-2 font-bold text-green-700">${tipResults.reduce((s, r) => s + r.net_tip, 0).toFixed(2)}</td>
                      <td />
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
              <div className="mt-4 flex justify-end">
                <Button size="sm" variant="outline" onClick={handleTipDistributionSave} disabled={saving || submitting}>
                  Save Tip Distribution
                </Button>
              </div>
            </div>

            <div className="mt-3 text-center text-xs text-muted-foreground">
              {!tipDistributionSaved ? 'Save Tip Distribution first before saving EOD.' : 'Tip Distribution saved and ready.'}
            </div>
            {saveError && (
              <div className="mt-2 text-center text-sm text-red-600">
                {saveError}
              </div>
            )}

            <div className="mt-3 flex justify-center">
              <Button onClick={handleSave} disabled={saving || submitting || !tipDistributionSaved}>
                {saving ? 'Saving…' : 'Save EOD'}
              </Button>
            </div>
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
    </>
  )
}
