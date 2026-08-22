'use client'

import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Employee, DailySession, ShiftClock } from '@/lib/types'
import { format } from 'date-fns'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { DollarSign } from 'lucide-react'
import { getEmployeeScheduleDepartments } from '@/lib/employeeSelect'

const DENOM_VALUES: Record<string, number> = {
  d100: 100, d50: 50, d20: 20, d10: 10, d5: 5,
  d1: 1, c25: 0.25, c10: 0.10, c5: 0.05, c1: 0.01,
}
const COIN_KEYS = ['c25', 'c10', 'c5', 'c1']
const BILL_KEYS = ['d100', 'd50', 'd20', 'd10', 'd5', 'd1']
const EMPTY_DENOMS = Object.fromEntries(
  [...COIN_KEYS, ...BILL_KEYS].map(k => [k, { count: '', amount: '' }])
)

function CoinTotalRow({
  computed,
  override,
  setOverride,
  disabled,
  onLockedAttempt,
}: {
  computed: number
  override: string
  setOverride: (v: string) => void
  disabled: boolean
  onLockedAttempt: () => void
}) {
  return (
    <div className="mt-2 pt-2 border-t border-dashed">
      <div className="flex items-center gap-1.5">
        <span className="w-10 shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground w-16 text-center">Coin Total</span>
        <span className="text-xs text-muted-foreground shrink-0 invisible">×</span>
        <Input
          type="text" inputMode="decimal"
          value={override !== '' ? override : (computed > 0 ? computed.toFixed(2) : '')}
          onChange={e => { if (disabled) { onLockedAttempt(); return } const v = e.target.value; if (/^\d*\.?\d{0,2}$/.test(v)) setOverride(v) }}
          onFocus={e => { if (disabled) { onLockedAttempt(); return } if (override === '') { setOverride(computed > 0 ? computed.toFixed(2) : ''); requestAnimationFrame(() => e.target.select()) } }}
          onBlur={e => { const v = e.target.value.trim(); if (v) setOverride((parseFloat(v) || 0).toFixed(2)) }}
          disabled={disabled}
          placeholder="0.00"
          className="h-8 w-20 text-center text-xs px-1 font-semibold"
        />
      </div>
    </div>
  )
}

function BillTotalRow({
  computed,
  override,
  setOverride,
  disabled,
  onLockedAttempt,
}: {
  computed: number
  override: string
  setOverride: (v: string) => void
  disabled: boolean
  onLockedAttempt: () => void
}) {
  return (
    <div className="mt-4 rounded-xl border-2 border-emerald-400 bg-emerald-50 p-4 shadow-sm">
      <p className="text-sm font-extrabold text-emerald-900 text-center mb-3">Bill Total</p>
      <Input
        type="text" inputMode="decimal"
        value={override !== '' ? override : (computed > 0 ? computed.toFixed(2) : '')}
        onChange={e => { if (disabled) { onLockedAttempt(); return } const v = e.target.value; if (/^\d*\.?\d{0,2}$/.test(v)) setOverride(v) }}
        onFocus={e => { if (disabled) { onLockedAttempt(); return } if (override === '') { setOverride(computed > 0 ? computed.toFixed(2) : ''); requestAnimationFrame(() => e.target.select()) } }}
        onBlur={e => { const v = e.target.value.trim(); if (v) setOverride((parseFloat(v) || 0).toFixed(2)) }}
        disabled={disabled}
        placeholder="0.00"
        className="h-14 w-full text-center text-xl px-3 font-extrabold border-2 border-emerald-500 bg-white shadow-sm"
      />
      <p className="mt-2 text-center text-xs font-medium text-emerald-800">
        Enter total bills here to skip counting each denomination.
      </p>
    </div>
  )
}

interface Props {
  session: DailySession | null
  employees: Employee[]
  clockRecords: ShiftClock[]
  today: string
  businessDate: Date
  onComplete: () => void
}

function isRegisterOpener(employee: Employee) {
  const departments = getEmployeeScheduleDepartments(employee).map(department => department.trim().toLowerCase())
  const department = (employee.primary_department ?? '').trim().toLowerCase()
  const role = (employee.role ?? '').trim().toLowerCase()
  return departments.includes('server') || departments.includes('manager') || department === 'server' || department === 'manager' || role === 'server' || role === 'manager'
}

export function RegisterOpenPanel({ session, employees, clockRecords, today, businessDate, onComplete }: Props) {
  const [openedBy, setOpenedBy] = useState<string>(session?.register_opened_by ?? '')
  const [coinOverride, setCoinOverride] = useState<string>('')
  const [billOverride, setBillOverride] = useState<string>('')
  const [denoms, setDenoms] = useState<Record<string, { count: string; amount: string }>>(EMPTY_DENOMS)
  const [saving, setSaving] = useState(false)
  const [openByWarning, setOpenByWarning] = useState<string | null>(null)
  const clockedInEmployeeIds = useMemo(() => new Set(
    clockRecords
      .filter(record => record.session_date === today && record.clock_in_at && !record.clock_out_at)
      .map(record => record.employee_id)
  ), [clockRecords, today])
  const eligibleOpeners = useMemo(() => {
    const employeeById = new Map(employees.map(employee => [employee.id, employee]))
    for (const record of clockRecords) {
      if (record.session_date !== today || !record.clock_in_at || record.clock_out_at) continue
      const relatedEmployee = record.employee as Employee | Employee[] | undefined
      const employee = Array.isArray(relatedEmployee) ? relatedEmployee[0] : relatedEmployee
      if (employee?.id && !employeeById.has(employee.id)) {
        employeeById.set(employee.id, employee)
      }
    }
    return [...employeeById.values()].filter(employee => isRegisterOpener(employee) && clockedInEmployeeIds.has(employee.id))
  }, [clockRecords, clockedInEmployeeIds, employees, today])
  const hasAvailableOpeners = eligibleOpeners.length > 0
  const selectedOpener = eligibleOpeners.find(e => e.id === openedBy) ?? null
  const selectedOpenerName = selectedOpener?.name ?? 'Unknown'
  const effectiveOpenedBy = selectedOpener?.id ?? ''
  const cashEntryLocked = !effectiveOpenedBy

  const requireOpenedBy = () => {
    const message = hasAvailableOpeners
      ? 'Select Opened by before entering drawer count.'
      : 'A server or manager must clock in before opening the register.'
    setOpenByWarning(message)
    return false
  }

  const computedCoin = COIN_KEYS.reduce((s, k) => s + (parseInt(denoms[k]?.count) || 0) * DENOM_VALUES[k], 0)
  const computedBill = BILL_KEYS.reduce((s, k) => s + (parseInt(denoms[k]?.count) || 0) * DENOM_VALUES[k], 0)
  const effCoin = coinOverride !== '' ? (parseFloat(coinOverride) || 0) : computedCoin
  const effBill = billOverride !== '' ? (parseFloat(billOverride) || 0) : computedBill
  const drawerTotal = effCoin + effBill
  const startingCash = drawerTotal

  const renderRow = (key: string, label: string, value: number, isCoin: boolean) => {
    const { count, amount } = denoms[key]
    return (
      <div key={key} className="flex items-center gap-1.5">
        <span className="w-10 text-right text-sm font-semibold text-slate-600 shrink-0">{label}</span>
        <Input
          type="text" inputMode="numeric" value={count}
          onChange={e => {
            if (!effectiveOpenedBy) {
              requireOpenedBy()
              return
            }
            const c = e.target.value.replace(/\D/g, '')
            const a = c ? ((parseInt(c) || 0) * value).toFixed(2) : ''
            setDenoms(nd => ({ ...nd, [key]: { count: c, amount: a } }))
            if (isCoin) setCoinOverride('')
            else setBillOverride('')
          }}
          disabled={cashEntryLocked}
          placeholder="qty" className="h-8 w-16 text-center text-xs px-1"
        />
        <span className="text-xs text-muted-foreground shrink-0">×</span>
        <Input
          type="text" inputMode="decimal" value={amount}
          onChange={e => {
            if (!effectiveOpenedBy) {
              requireOpenedBy()
              return
            }
            const raw = e.target.value
            if (!/^\d*\.?\d{0,2}$/.test(raw)) return
            const c = raw ? String(Math.round((parseFloat(raw) || 0) / value)) : ''
            setDenoms(nd => ({ ...nd, [key]: { count: c, amount: raw } }))
            if (isCoin) setCoinOverride('')
            else setBillOverride('')
          }}
          disabled={cashEntryLocked}
          placeholder="amt" className="h-8 w-20 text-center text-xs px-1"
        />
      </div>
    )
  }

  const handleOpen = async () => {
    if (!effectiveOpenedBy) {
      requireOpenedBy()
      return
    }
    setSaving(true)
    const payload = {
      session_date: today,
      starting_cash: startingCash,
      register_opened_by: effectiveOpenedBy,
      current_phase: 'pre_shift' as const,
    }
    if (session) {
      await supabase.from('daily_sessions').update(payload).eq('id', session.id)
    } else {
      await supabase.from('daily_sessions').insert(payload)
    }
    setSaving(false)
    onComplete()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Open Cash Register</p>
            <h1 className="text-xl font-bold">{format(businessDate, 'EEEE, MMMM d, yyyy')}</h1>
          </div>
          <div className="flex items-center gap-3">
            <Label className="text-sm font-medium shrink-0">Opened by</Label>
            <Select
              value={effectiveOpenedBy}
              onValueChange={(v: string | null) => {
                setOpenedBy(v ?? '')
                setOpenByWarning(null)
              }}
            >
              <SelectTrigger className="w-56 bg-white" disabled={!hasAvailableOpeners}>
                <span className={effectiveOpenedBy ? '' : 'text-muted-foreground'}>
                  {effectiveOpenedBy ? selectedOpenerName : hasAvailableOpeners ? 'Select clocked-in staff' : 'Clock in first'}
                </span>
              </SelectTrigger>
              <SelectContent>
                {eligibleOpeners.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {hasAvailableOpeners
            ? 'Select Opened by first. Only clocked-in Server or Manager department staff can open the register.'
            : 'Opened by is unavailable. A Server or Manager department employee must clock in before entering register information.'}
        </div>
        {openByWarning && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {openByWarning}
          </div>
        )}
      </div>

      <div className="mx-auto w-full max-w-2xl p-6 space-y-5">
        {/* Calculator */}
        <div
          className={`rounded-xl border bg-white p-5 shadow-sm ${cashEntryLocked ? 'opacity-60' : ''}`}
          onMouseDown={() => {
            if (cashEntryLocked) requireOpenedBy()
          }}
        >
          <h2 className="font-semibold mb-4">Count Drawer</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Coins</p>
              <div className="space-y-1.5">
                {[
                  { key: 'c25', label: '¢25', value: 0.25 },
                  { key: 'c10', label: '¢10', value: 0.10 },
                  { key: 'c5',  label: '¢5',  value: 0.05 },
                  { key: 'c1',  label: '¢1',  value: 0.01 },
                ].map(({ key, label, value }) => renderRow(key, label, value, true))}
              </div>
              <CoinTotalRow computed={computedCoin} override={coinOverride} setOverride={setCoinOverride} disabled={cashEntryLocked} onLockedAttempt={requireOpenedBy} />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Bills</p>
              <div className="space-y-1.5">
                {[
                  { key: 'd100', label: '$100', value: 100 },
                  { key: 'd50',  label: '$50',  value: 50 },
                  { key: 'd20',  label: '$20',  value: 20 },
                  { key: 'd10',  label: '$10',  value: 10 },
                  { key: 'd5',   label: '$5',   value: 5 },
                  { key: 'd1',   label: '$1',   value: 1 },
                ].map(({ key, label, value }) => renderRow(key, label, value, false))}
              </div>
            </div>
          </div>
          <BillTotalRow computed={computedBill} override={billOverride} setOverride={setBillOverride} disabled={cashEntryLocked} onLockedAttempt={requireOpenedBy} />

          {/* Drawer total summary */}
          <div className="mt-4 flex items-center gap-3 rounded-lg bg-slate-100 px-4 py-3 text-sm flex-wrap">
            <span className="text-muted-foreground">Coins</span>
            <span className="font-semibold">${effCoin.toFixed(2)}</span>
            <span className="text-muted-foreground mx-1">+</span>
            <span className="text-muted-foreground">Bills</span>
            <span className="font-semibold">${effBill.toFixed(2)}</span>
            <span className="text-muted-foreground mx-1">=</span>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Drawer Total</span>
            <span className="text-lg font-bold text-slate-700">${drawerTotal.toFixed(2)}</span>
          </div>
        </div>

        {/* Starting Cash — locked, auto-set from drawer calculator */}
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Starting Cash</h2>
            <span className="flex items-center gap-1 text-xs text-amber-700 font-medium">
              <DollarSign className="w-3.5 h-3.5" />
              Auto from drawer · read only
            </span>
          </div>
          <div className="flex items-center justify-center gap-3">
            <span className="text-4xl font-extrabold text-amber-700 tracking-tight">
              ${startingCash.toFixed(2)}
            </span>
          </div>
          {startingCash === 0 && (
            <p className="mt-2 text-center text-xs text-amber-600">Count the drawer above to set starting cash.</p>
          )}
        </div>

        {/* Open Register button */}
        <Button
          size="lg"
          className="w-full h-14 text-base font-semibold bg-emerald-600 hover:bg-emerald-700"
          onClick={handleOpen}
          disabled={saving}
        >
          {saving ? 'Opening…' : 'Open Register → Start Pre-Shift'}
        </Button>
      </div>
    </div>
  )
}
