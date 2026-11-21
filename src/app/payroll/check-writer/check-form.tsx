'use client'

import { cloneElement, createContext, useContext, useId, useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PinModal } from '@/components/layout/PinModal'
import { Combobox } from '@base-ui/react/combobox'
import { Button } from '@/components/ui/button'
import { BUSINESS_TIMEZONE } from '@/lib/clockUtils'
import { STAFF_CHECK_CATEGORY, checkMoney, nextCheckNumber, type CheckCategory, type CheckAction, type CheckData, type CheckEntry, type PayrollCheckRow } from '@/lib/checkWriter'

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

export const CategoryContext = createContext<{ categories: CheckCategory[]; submit?: SubmitCheck }>({ categories: [] })

export function CategoryField({ value, change, required = false }: {
  value: string; change: (value: string) => void; required?: boolean
}) {
  const { categories, submit } = useContext(CategoryContext)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [categoryError, setCategoryError] = useState('')
  const [busy, setBusy] = useState(false)
  const active = categories.filter(item => !item.archived_at)
  return <div className="grid gap-2">
    <Field label="QuickBooks category"><select className={checkInput} required={required} value={value} onChange={event => {
      if (event.target.value === newCategory) setCreating(true)
      else change(event.target.value)
    }}>
      <option value="">Select category</option>
      {value && !active.some(item => item.name === value) && <option value={value}>{value} (historical)</option>}
      {active.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}
      <option value={newCategory}>Add new category…</option>
    </select></Field>
    {creating && <section className="grid gap-2 rounded border p-3" aria-label="New category">
      <Field label="New category name"><input className={checkInput} maxLength={120} value={name} onChange={event => setName(event.target.value)} /></Field>
      <Button type="button" disabled={busy || !name.trim()} onClick={async () => {
        if (!submit || !name.trim()) return
        setBusy(true)
        setCategoryError('')
        try {
          const saved = await submit('save_category', { name: name.trim(), quick_add: true })
          change((saved[0] as unknown as CheckCategory).name)
          setCreating(false)
          setName('')
        } catch (error) {
          setCategoryError(error instanceof Error ? error.message : 'Could not add the category.')
        } finally {
          setBusy(false)
        }
      }}>Add category</Button>
      {categoryError && <p className="text-sm text-red-700" role="alert">{categoryError}</p>}
      <Button type="button" variant="ghost" onClick={() => { setCreating(false); setCategoryError('') }}>Cancel</Button>
    </section>}
  </div>
}

export function PinForm({ label, submit, children, print, requirePin = true }: {
  label: string
  submit: (pin?: string) => Promise<unknown>
  children?: ReactNode
  print?: (pin: string) => Promise<unknown>
  requirePin?: boolean
}) {
  const [authorization, setAuthorization] = useState<'save' | 'print' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (busy) return
    const button = (event.nativeEvent as SubmitEvent).submitter
    if (requirePin) {
      setAuthorization(print && button?.getAttribute('value') === 'print' ? 'print' : 'save')
      return
    }

    setBusy(true)
    setError('')
    try {
      await submit()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <form onSubmit={handleSubmit}>
      <fieldset disabled={busy} className="grid gap-4">
        {children}
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button type="submit" variant={print ? 'outline' : 'default'} disabled={busy}>{label}</Button>
          {print && <Button type="submit" value="print" disabled={busy}>Print now</Button>}
        </div>
      </fieldset>
    </form>
    {requirePin && <PinModal open={authorization !== null} title="Manager PIN"
      description={authorization === 'print' ? 'Authorize printing this check' : label}
      onClose={() => { if (!busy) setAuthorization(null) }}
      onConfirm={async pin => {
        if (busy) return
        setBusy(true)
        try {
          if (authorization === 'print' && print) await print(pin)
          else await submit(pin)
          setAuthorization(null)
        } finally {
          setBusy(false)
        }
      }} />}
  </>
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
  const [category, setCategory] = useState(entry?.category ?? (linked ? STAFF_CHECK_CATEGORY : ''))
  const [method, setMethod] = useState('cash')
  const [amount, setAmount] = useState(entry ? entry.amount.toFixed(2) : payroll ? payroll.remaining.toFixed(2) : '')
  const [date, setDate] = useState(entry?.payment_date ?? new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: BUSINESS_TIMEZONE,
  }).format(new Date()))
  const [omitPayee, setOmitPayee] = useState(entry?.omit_payee_on_print ?? false)
  const [memo, setMemo] = useState(entry?.memo ?? '')
  const [quickAdd, setQuickAdd] = useState(false)
  const [quickName, setQuickName] = useState('')
  const [bank, setBank] = useState(entry?.bank_account ?? 'Checking')
  const [number, setNumber] = useState(entry?.check_number ?? '')
  const [reference, setReference] = useState(entry?.reference ?? '')
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

  const suggestedNumber = nextCheckNumber(data.entries, bank)

  async function saveCheck(action: 'save' | 'save_and_print', pin?: string) {
    if (!linked && !selectedPayee && !(source === 'app' && omitPayee)) throw new Error('Choose a payee from the search results.')
    if (liveVoucher && omitPayee && !memo.trim()) throw new Error('A memo is required when the payee is blank.')
    return submit(action, {
      id: entry?.id, revision: entry?.revision, source, method, payment_date: date, amount,
      payroll_item_id: payroll?.id,
      employee_id: !linked && selectedPayee?.type === 'staff' ? selectedPayee.id : undefined,
      vendor_id: !linked && selectedPayee?.type === 'vendor' ? selectedPayee.id : undefined,
      category, memo, omit_payee_on_print: liveVoucher ? omitPayee : undefined, bank_account: bank,
      check_number: action === 'save_and_print' ? number || suggestedNumber : number, reference,
    }, pin)
  }

  return <><PinForm
    label={liveVoucher ? 'Save for future print' : 'Record payment'}
    submit={pin => saveCheck('save', pin)}
    print={liveVoucher ? pin => saveCheck('save_and_print', pin) : undefined}
  >
      {linked ? <p className="rounded-md bg-slate-50 px-3 py-2 text-sm">
        {payroll?.employee_name ?? entry?.payee_name}
        {payroll && <> · {checkMoney.format(payroll.remaining)} available to record</>}
      </p> : <div className={checkLabel}>
        <label htmlFor={payeeInputId}>Payee</label>
        <Combobox.Root<(typeof payees)[number]> items={payees} value={selectedPayee} autoHighlight required={!(source === 'app' && omitPayee)}
          itemToStringLabel={item => item.label} isItemEqualToValue={(item, selected) => item.key === selected.key}
          onValueChange={selected => {
            setPayeeId(selected?.key ?? '')
            setCategory(selected?.type === 'vendor' ? selected.category ?? '' : selected?.type === 'staff' ? STAFF_CHECK_CATEGORY : '')
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
                    <span className="shrink-0 text-xs text-muted-foreground">{item.type === 'staff' ? `Staff · ${STAFF_CHECK_CATEGORY}` : `Vendor · ${item.category || 'Unassigned'}`}</span>
                  </Combobox.Item>}
                </Combobox.List>
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
        </Combobox.Root>
        <Button type="button" variant="outline" onClick={() => setQuickAdd(true)}>Quick Add Payee</Button>
      </div>}
      {liveVoucher && <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={omitPayee} onChange={event => setOmitPayee(event.target.checked)} />
        Leave payee blank and print (memo required)
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
        {(liveVoucher || source === 'handwritten') && <Field label={liveVoucher ? 'Check stock number for printing' : 'Check number (optional)'}>
          <input className={checkInput} inputMode="numeric" pattern="[0-9]{1,12}" maxLength={12} value={number}
            placeholder={liveVoucher ? suggestedNumber : undefined} onChange={event => setNumber(event.target.value)} />
        </Field>}
        {source === 'payroll_balance' && <Field label="Payment reference (optional)">
          <input className={checkInput} maxLength={120} value={reference} onChange={event => setReference(event.target.value)} />
        </Field>}
      </div>
      <CategoryField value={category} change={setCategory} required={!liveVoucher} />
      <Field label={liveVoucher && omitPayee ? "Memo (required for blank payee)" : "Memo"}><input className={checkInput} required={liveVoucher && omitPayee} maxLength={160} value={memo} onChange={event => setMemo(event.target.value)} /></Field>
  </PinForm>
    <Dialog open={quickAdd} onOpenChange={setQuickAdd}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Quick Add Payee</DialogTitle><DialogDescription>Only a name is required. A manager can complete the vendor details later in Vendors &amp; Staff.</DialogDescription></DialogHeader>
        <PinForm label="Create vendor and select payee" requirePin={false} submit={async () => {
          if (!quickName.trim()) throw new Error('Enter a payee name.')
          const saved = await submit('save_vendor', { name: quickName.trim(), quick_add: true })
          const vendor = saved[0] as unknown as import('@/lib/checkWriter').CheckVendor
          setPayeeId(`vendor:${vendor.id}`)
          setCategory(vendor.category ?? '')
          setQuickName(''); setQuickAdd(false)
        }}>
          <Field label="Payee name"><input className={checkInput} required maxLength={100} value={quickName} onChange={event => setQuickName(event.target.value)} /></Field>
        </PinForm>
      </DialogContent>
    </Dialog>
  </>
}
