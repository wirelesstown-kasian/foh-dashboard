'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Employee, DailySession } from '@/lib/types'
import { format } from 'date-fns'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { DollarSign } from 'lucide-react'

const DENOM_VALUES: Record<string, number> = {
  d100: 100, d50: 50, d20: 20, d10: 10, d5: 5,
  d1: 1, c25: 0.25, c10: 0.10, c5: 0.05, c1: 0.01,
}
const COIN_KEYS = ['c25', 'c10', 'c5', 'c1']
const BILL_KEYS = ['d100', 'd50', 'd20', 'd10', 'd5', 'd1']
const EMPTY_DENOMS = Object.fromEntries(
  [...COIN_KEYS, ...BILL_KEYS].map(k => [k, { count: '', amount: '' }])
)

interface Props {
  session: DailySession | null
  employees: Employee[]
  today: string
  businessDate: Date
  onComplete: () => void
}

export function RegisterOpenPanel({ session, employees, today, businessDate, onComplete }: Props) {
  const [openedBy, setOpenedBy] = useState<string>(session?.register_opened_by ?? '')
  const [manualCash, setManualCash] = useState<string>(
    session?.starting_cash != null ? String(session.starting_cash) : ''
  )
  const [coinOverride, setCoinOverride] = useState<string>('')
  const [billOverride, setBillOverride] = useState<string>('')
  const [denoms, setDenoms] = useState<Record<string, { count: string; amount: string }>>(EMPTY_DENOMS)
  const [saving, setSaving] = useState(false)

  const computedCoin = COIN_KEYS.reduce((s, k) => s + (parseInt(denoms[k]?.count) || 0) * DENOM_VALUES[k], 0)
  const computedBill = BILL_KEYS.reduce((s, k) => s + (parseInt(denoms[k]?.count) || 0) * DENOM_VALUES[k], 0)
  const effCoin = coinOverride !== '' ? (parseFloat(coinOverride) || 0) : computedCoin
  const effBill = billOverride !== '' ? (parseFloat(billOverride) || 0) : computedBill
  const drawerTotal = effCoin + effBill

  const hasDrawerEntry = Object.values(denoms).some(d => d.count !== '') || coinOverride !== '' || billOverride !== ''
  const startingCash = manualCash !== '' ? (parseFloat(manualCash) || 0) : (hasDrawerEntry ? drawerTotal : 0)

  // When drawer total changes, sync to manual cash if manual hasn't been touched
  const updateDenoms = (newDenoms: typeof denoms, newCoinOverride: string, newBillOverride: string) => {
    const cCoins = COIN_KEYS.reduce((s, k) => s + (parseInt(newDenoms[k]?.count) || 0) * DENOM_VALUES[k], 0)
    const cBills = BILL_KEYS.reduce((s, k) => s + (parseInt(newDenoms[k]?.count) || 0) * DENOM_VALUES[k], 0)
    const effC = newCoinOverride !== '' ? (parseFloat(newCoinOverride) || 0) : cCoins
    const effB = newBillOverride !== '' ? (parseFloat(newBillOverride) || 0) : cBills
    const total = effC + effB
    if (manualCash === '') {
      // auto-fill manual cash from drawer total
      setManualCash(total > 0 ? total.toFixed(2) : '')
    }
  }

  const renderRow = (key: string, label: string, value: number, isCoin: boolean) => {
    const { count, amount } = denoms[key]
    return (
      <div key={key} className="flex items-center gap-1.5">
        <span className="w-10 text-right text-sm font-semibold text-slate-600 shrink-0">{label}</span>
        <Input
          type="number" min="0" step="1" value={count}
          onChange={e => {
            const c = e.target.value
            const a = c ? ((parseInt(c) || 0) * value).toFixed(2) : ''
            const nd = { ...denoms, [key]: { count: c, amount: a } }
            setDenoms(nd)
            const nco = isCoin ? '' : coinOverride
            const nbo = !isCoin ? '' : billOverride
            if (isCoin) setCoinOverride('')
            else setBillOverride('')
            updateDenoms(nd, nco, nbo)
          }}
          placeholder="개수" className="h-8 w-16 text-center text-xs px-1"
        />
        <span className="text-xs text-muted-foreground shrink-0">×</span>
        <Input
          type="number" min="0" step="0.01" value={amount}
          onChange={e => {
            const a = e.target.value
            const c = a ? String(Math.round((parseFloat(a) || 0) / value)) : ''
            const nd = { ...denoms, [key]: { count: c, amount: a } }
            setDenoms(nd)
            const nco = isCoin ? '' : coinOverride
            const nbo = !isCoin ? '' : billOverride
            if (isCoin) setCoinOverride('')
            else setBillOverride('')
            updateDenoms(nd, nco, nbo)
          }}
          placeholder="금액" className="h-8 w-20 text-center text-xs px-1"
        />
      </div>
    )
  }

  const SubtotalRow = ({ label, computed, override, setOverride, isCoin }: {
    label: string; computed: number; override: string
    setOverride: (v: string) => void; isCoin: boolean
  }) => (
    <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-dashed">
      <span className="w-10 shrink-0" />
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground w-16 text-center">{label}</span>
      <span className="text-xs text-muted-foreground shrink-0 invisible">×</span>
      <Input
        type="number" min="0" step="0.01"
        value={override !== '' ? override : (computed > 0 ? computed.toFixed(2) : '')}
        onChange={e => {
          setOverride(e.target.value)
          const nco = isCoin ? e.target.value : coinOverride
          const nbo = isCoin ? billOverride : e.target.value
          updateDenoms(denoms, nco, nbo)
        }}
        placeholder="0.00" className="h-8 w-20 text-center text-xs px-1 font-semibold"
      />
    </div>
  )

  const handleOpen = async () => {
    setSaving(true)
    const payload = {
      session_date: today,
      starting_cash: startingCash,
      register_opened_by: openedBy || null,
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
            <Select value={openedBy} onValueChange={(v: string | null) => setOpenedBy(v ?? '')}>
              <SelectTrigger className="w-44">
                <span className={openedBy ? '' : 'text-muted-foreground'}>
                  {openedBy ? (employees.find(e => e.id === openedBy)?.name ?? 'Unknown') : 'Select staff'}
                </span>
              </SelectTrigger>
              <SelectContent>
                {employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl p-6 space-y-5">
        {/* Calculator */}
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold mb-4">Count Drawer</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-4">
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
              <SubtotalRow label="Coin Total" computed={computedCoin} override={coinOverride} setOverride={setCoinOverride} isCoin={true} />
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
              <SubtotalRow label="Bill Total" computed={computedBill} override={billOverride} setOverride={setBillOverride} isCoin={false} />
            </div>
          </div>

          {/* Drawer total summary */}
          <div className="flex items-center gap-3 rounded-lg bg-slate-100 px-4 py-3 text-sm flex-wrap">
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

        {/* Starting Cash */}
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-semibold">Starting Cash</h2>
            <span className="text-xs text-muted-foreground">Auto-filled from drawer count · override if needed</span>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <DollarSign className="w-5 h-5 text-amber-500 shrink-0" />
            <Input
              type="number"
              step="0.01"
              min="0"
              value={manualCash}
              onChange={e => setManualCash(e.target.value)}
              placeholder={hasDrawerEntry ? drawerTotal.toFixed(2) : '0.00'}
              className="w-40 text-xl font-bold h-12 text-center"
            />
            <span className="text-2xl font-bold text-amber-700">
              ${startingCash.toFixed(2)}
            </span>
          </div>
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
