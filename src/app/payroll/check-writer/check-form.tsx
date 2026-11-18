'use client'

import { cloneElement, useId, useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Button } from '@/components/ui/button'
import { BUSINESS_TIMEZONE } from '@/lib/clockUtils'
import { checkMoney, type CheckAction, type CheckData, type CheckEntry, type PayrollCheckRow } from '@/lib/checkWriter'

export type SubmitCheck = (action: CheckAction, data: Record<string, unknown>, pin?: string) => Promise<CheckEntry[]>

export const checkInput = 'h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm'
export const checkLabel = 'grid gap-1.5 text-sm font-medium'
export const quickBooksCategories = [
  'Advertising & marketing', 'ASK', 'Cash Expense', 'Credit card processing fee', 'Insurance',
  'Kitchen cleaning maintenance', 'Legal & accounting services', 'Meals', 'Office expenses',
  'Merchant account fees', 'Office supplies', 'Software & apps', 'Payroll expenses',
  "Officers' salaries", 'Rent', 'Equipment rental', 'Repairs & maintenance', 'Supplies',
  'Taxes and Licenses', 'Travel', 'Parking & tolls', 'Utilities', 'Internet & TV services', 'COGs',
] as const
const newCategory = '__new_category__'

export function Field({ label, children }: {
  label: string; children: ReactElement<{ 'aria-labelledby'?: string }>
}) {
  const labelId = useId()
  return <label className={checkLabel}>
    <span id={labelId}>{label}</span>
    {cloneElement(children, { 'aria-labelledby': labelId })}
  </label>
}

export function CategoryField({ value, change, required = false }: {
  value: string; change: (value: string) => void; required?: boolean
}) {
  const selected = quickBooksCategories.includes(value as typeof quickBooksCategories[number]) ? value : value ? newCategory : ''
  return <div className="grid gap-2">
    <Field label="QuickBooks category">
      <select className={checkInput} required={required} value={selected} onChange={event => {
        if (event.target.value === newCategory) change('')
        else change(event.target.value)
      }}>
        <option value="">Select category</option>
        {quickBooksCategories.map(category => <option key={category} value={category}>{category}</option>)}
        <option value={newCategory}>Add new category…</option>
      </select>
    </Field>
    {selected === newCategory && <Field label="New QuickBooks category">
      <input className={checkInput} required={required} maxLength={120} value={value}
        onChange={event => change(event.target.value)} placeholder="Enter a new category" />
    </Field>}
  </div>
}

export function PinForm({ label, submit, children }: {
  label: string; submit: (pin: string) => Promise<unknown>; children?: ReactNode
}) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await submit(pin)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The action could not be completed.')
    } finally {
      setPin('')
      setBusy(false)
    }
  }

  return <form onSubmit={handleSubmit}>
    <fieldset disabled={busy} className="grid gap-4">
      {children}
      <div className="flex flex-wrap items-end gap-3 border-t pt-4">
        <Field label="Manager PIN">
          <input className={`${checkInput} max-w-36`} type="password" inputMode="numeric" autoComplete="off"
            pattern="[0-9]{4}" maxLength={4} required value={pin} onChange={event => setPin(event.target.value)} />
        </Field>
        <Button type="submit" disabled={busy}>{busy ? 'Working…' : label}</Button>
      </div>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
    </fieldset>
  </form>
}

export function CheckForm({ data, entry, payroll, source, submit }: {
  data: CheckData
  entry?: CheckEntry
  payroll?: PayrollCheckRow
  source: 'app' | 'handwritten' | 'payroll' | 'payroll_balance'
  submit: SubmitCheck
}) {
  const linked = Boolean(payroll || entry?.payroll_item_id)
  const payeeInputId = useId()
  const [payeeId, setPayeeId] = useState(() => entry?.employee_id ? `staff:${entry.employee_id}` : entry?.vendor_id ? `vendor:${entry.vendor_id}` : '')
  const [category, setCategory] = useState(entry?.category ?? '')
  const [method, setMethod] = useState('cash')
  const [amount, setAmount] = useState(entry ? entry.amount.toFixed(2) : payroll ? payroll.remaining.toFixed(2) : '')
  const [date, setDate] = useState(entry?.payment_date ?? new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: BUSINESS_TIMEZONE,
  }).format(new Date()))
  const [omitPayee, setOmitPayee] = useState(entry?.omit_payee_on_print ?? false)
  const [memo, setMemo] = useState(entry?.memo ?? '')
  const [bank, setBank] = useState(entry?.bank_account ?? 'Checking')
  const [number, setNumber] = useState(entry?.check_number ?? '')
  const [reference, setReference] = useState(entry?.reference ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const liveVoucher = source === 'app' || source === 'payroll'
  const payees = [
    ...data.employees.map(employee => ({
      key: `staff:${employee.id}`, id: employee.id, type: 'staff' as const,
      label: employee.is_active ? employee.name : `${employee.name} (inactive)`, name: employee.name,
    })),
    ...data.vendors.filter(vendor => !vendor.archived_at || vendor.id === entry?.vendor_id).map(vendor => ({
      key: `vendor:${vendor.id}`, id: vendor.id, type: 'vendor' as const,
      label: vendor.archived_at ? `${vendor.name} (archived vendor)` : vendor.name, name: vendor.name, category: vendor.category,
    })),
  ]
  const selectedPayee = payees.find(payee => payee.key === payeeId) ?? null

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (!linked && !selectedPayee) {
      setError('Choose a payee from the search results.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await submit('save', {
        id: entry?.id, revision: entry?.revision, source, method, payment_date: date, amount,
        payroll_item_id: payroll?.id,
        employee_id: !linked && selectedPayee?.type === 'staff' ? selectedPayee.id : undefined,
        vendor_id: !linked && selectedPayee?.type === 'vendor' ? selectedPayee.id : undefined,
        category, memo, omit_payee_on_print: liveVoucher ? omitPayee : undefined, bank_account: bank, check_number: number, reference,
      })
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The check could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return <form onSubmit={handleSubmit}>
    <fieldset disabled={busy} className="grid gap-4">
      {linked ? <p className="rounded-md bg-slate-50 px-3 py-2 text-sm">
        {payroll?.employee_name ?? entry?.payee_name}
        {payroll && <> · {checkMoney.format(payroll.remaining)} available to record</>}
      </p> : <div className={checkLabel}>
        <label htmlFor={payeeInputId}>Payee</label>
        <Combobox.Root<(typeof payees)[number]> items={payees} value={selectedPayee} autoHighlight required
          itemToStringLabel={item => item.label} isItemEqualToValue={(item, selected) => item.key === selected.key}
          onValueChange={selected => {
            setPayeeId(selected?.key ?? '')
            if (selected?.type === 'vendor') setCategory(selected.category ?? '')
          }}>
          <Combobox.Input id={payeeInputId} className={checkInput} placeholder="Search staff or vendors" />
          <Combobox.Portal>
            <Combobox.Positioner align="start" sideOffset={4} className="z-[60] w-[var(--anchor-width)]">
              <Combobox.Popup className="overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
                <Combobox.Empty className="px-3 py-2 text-sm text-muted-foreground empty:hidden">No matching payees</Combobox.Empty>
                <Combobox.List className="max-h-52 overflow-y-auto p-1 empty:hidden">
                  {(item: (typeof payees)[number]) => <Combobox.Item key={item.key} value={item}
                    className="flex cursor-default justify-between gap-2 rounded px-2 py-1.5 text-sm data-highlighted:bg-accent data-highlighted:text-accent-foreground">
                    <span className="min-w-0 break-words">{item.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{item.type === 'staff' ? 'Staff' : 'Vendor'}</span>
                  </Combobox.Item>}
                </Combobox.List>
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
        </Combobox.Root>
      </div>}
      {liveVoucher && <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={omitPayee} onChange={event => setOmitPayee(event.target.checked)} />
        Leave payee blank when printing
      </label>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date"><input className={checkInput} type="date" required value={date} onChange={event => setDate(event.target.value)} /></Field>
        <Field label="Amount"><input className={checkInput} inputMode="decimal" type="number" min="0.01" step="0.01"
          max={payroll?.remaining ?? 999999999.99} required value={amount} onChange={event => setAmount(event.target.value)} /></Field>
        {source !== 'payroll_balance' ? <Field label="Bank account">
          <input className={checkInput} list="check-bank-accounts" maxLength={80} required value={bank} onChange={event => setBank(event.target.value)} />
        </Field> : <Field label="Payment method"><select className={checkInput} value={method} onChange={event => setMethod(event.target.value)}>
          <option value="cash">Cash</option><option value="ach">ACH</option>
        </select></Field>}
        {source === 'handwritten' && <Field label="Check number (optional)">
          <input className={checkInput} inputMode="numeric" pattern="[0-9]{1,12}" maxLength={12} value={number} onChange={event => setNumber(event.target.value)} />
        </Field>}
        {source === 'payroll_balance' && <Field label="Payment reference (optional)">
          <input className={checkInput} maxLength={120} value={reference} onChange={event => setReference(event.target.value)} />
        </Field>}
      </div>
      <CategoryField value={category} change={setCategory} required={!liveVoucher} />
      <Field label="Memo"><input className={checkInput} maxLength={160} value={memo} onChange={event => setMemo(event.target.value)} /></Field>
      <div className="flex justify-end border-t pt-4">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : liveVoucher ? 'Save draft' : source === 'handwritten' ? 'Record handwritten check' : 'Record payment'}</Button>
      </div>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
    </fieldset>
  </form>
}
