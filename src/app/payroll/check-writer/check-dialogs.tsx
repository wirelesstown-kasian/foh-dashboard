'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { checkMoney, type CheckAudit, type CheckEntry, type CheckVendor } from '@/lib/checkWriter'
import { CategoryField, Field, PinForm, checkInput, type SubmitCheck } from './check-form'

export function PrintForm({ entries, submit }: { entries: CheckEntry[]; submit: SubmitCheck }) {
  const [numbers, setNumbers] = useState<Record<string, string>>({})
  const [category, setCategory] = useState('')
  const uncategorized = entries.some(entry => !entry.category)

  return <PinForm label="Open print dialog" submit={pin => submit('print', {
    items: entries.map(entry => ({
      id: entry.id, revision: entry.revision, check_number: numbers[entry.id],
      category: entry.category || category,
    })),
  }, pin)}>
    <p className="text-sm text-muted-foreground">Load the vouchers in the order shown. Print at 100% on letter paper with headers and footers turned off.</p>
    <div className="grid gap-2">
      {entries.map(entry => <div key={entry.id} className="grid grid-cols-[1fr_9rem] items-end gap-3 rounded-md border p-2.5">
        <div className="text-sm"><div className="font-medium">{entry.payee_name}</div>
          {checkMoney.format(entry.amount)} · {entry.bank_account}</div>
        <Field label="Stock number"><input className={checkInput} inputMode="numeric" pattern="[0-9]{1,12}"
          required maxLength={12} value={numbers[entry.id] ?? ''}
          onChange={event => setNumbers(current => ({ ...current, [entry.id]: event.target.value }))} /></Field>
      </div>)}
    </div>
    {uncategorized && <div className="grid gap-1">
      <CategoryField value={category} change={setCategory} required />
      <p className="text-xs text-muted-foreground">Used for the selected drafts that have no category.</p>
    </div>}
  </PinForm>
}

type PrintOutcome = 'printed' | 'unused' | 'spoiled'

export function PrintResults({ entries, submit }: { entries: CheckEntry[]; submit: SubmitCheck }) {
  const [outcomes, setOutcomes] = useState<Record<string, PrintOutcome>>({})
  return <PinForm label="Save print results" submit={pin => {
    const items = entries.filter(entry => outcomes[entry.id]).map(entry => ({
      id: entry.id, revision: entry.revision, outcome: outcomes[entry.id],
    }))
    if (!items.length) throw new Error('Choose a result for at least one check.')
    return submit('resolve_print', { items }, pin)
  }}>
    <p className="text-sm text-muted-foreground">Check the printed pages first. Unused stock returns to draft. Spoiled stock is voided and retains its number.</p>
    <Button type="button" variant="outline" className="justify-self-start" onClick={() =>
      setOutcomes(Object.fromEntries(entries.map(entry => [entry.id, 'printed'])))}>
      Mark all printed successfully
    </Button>
    <div className="grid gap-2">
      {entries.map(entry => <div key={entry.id} className="grid grid-cols-[1fr_10rem] items-end gap-3 rounded-md border p-2.5">
        <div className="text-sm"><div className="font-medium">{entry.payee_name}</div>
          #{entry.check_number} · {checkMoney.format(entry.amount)}</div>
        <Field label="Result"><select className={checkInput} value={outcomes[entry.id] ?? ''} onChange={event => {
          const outcome = event.target.value as PrintOutcome
          setOutcomes(current => ({ ...current, [entry.id]: outcome }))
        }}>
          <option value="">Keep pending</option><option value="printed">Printed successfully</option>
          <option value="unused">Unused stock</option><option value="spoiled">Spoiled stock</option>
        </select></Field>
      </div>)}
    </div>
  </PinForm>
}

export function VendorForm({ vendor, submit }: { vendor?: CheckVendor; submit: SubmitCheck }) {
  const [name, setName] = useState(vendor?.name ?? '')
  const [category, setCategory] = useState(vendor?.category ?? '')
  return <PinForm label="Save vendor" submit={pin => submit('save_vendor', { id: vendor?.id, name, category }, pin)}>
    <Field label="Vendor name"><input className={checkInput} maxLength={100} required value={name} onChange={event => setName(event.target.value)} /></Field>
    <CategoryField value={category} change={setCategory} />
  </PinForm>
}

export function AccountingForm({ entry, submit }: { entry: CheckEntry; submit: SubmitCheck }) {
  const [category, setCategory] = useState(entry.category ?? '')
  const [note, setNote] = useState(entry.accounting_note ?? '')
  return <PinForm label="Save accounting details" submit={pin => submit('categorize', {
    id: entry.id, revision: entry.revision, category, accounting_note: note,
  }, pin)}>
    <CategoryField value={category} change={setCategory} required />
    <Field label="Accounting note"><input className={checkInput} maxLength={240} value={note} onChange={event => setNote(event.target.value)} /></Field>
  </PinForm>
}

export function RemoveForm({ entry, submit }: { entry: CheckEntry; submit: SubmitCheck }) {
  const [reason, setReason] = useState('')
  const removing = entry.status === 'draft'
  const action = removing ? 'remove' : 'void'
  return <PinForm label={removing ? 'Remove draft' : 'Void payment'} submit={pin =>
    submit(action, { id: entry.id, revision: entry.revision, reason }, pin)}>
    <p className="text-sm">{entry.payee_name} · {checkMoney.format(entry.amount)}</p>
    {!removing && <p className="text-sm text-muted-foreground">
      Voiding updates this register. Handle any bank stop payment or QuickBooks correction separately.
    </p>}
    <Field label="Reason"><input className={checkInput} required maxLength={240} value={reason} onChange={event => setReason(event.target.value)} /></Field>
  </PinForm>
}

const auditLabels: Record<string, string> = {
  save: 'Saved', prepare: 'Prepared from payroll', print: 'Print authorized',
  resolve_print: 'Print result saved', remove: 'Draft removed', void: 'Payment voided',
  categorize: 'Accounting details updated', save_vendor: 'Vendor saved', archive_vendor: 'Vendor archived',
}
const auditFields: Record<string, string> = {
  status: 'Status', payment_date: 'Payment date', payee_name: 'Payee', name: 'Vendor',
  amount: 'Amount', bank_account: 'Bank account', check_number: 'Stock number', category: 'Category',
  memo: 'Memo', accounting_note: 'Accounting note', reference: 'Reference', archived_at: 'Archived',
}

export function AuditHistory({ records }: { records: CheckAudit[] }) {
  if (!records.length) return <p className="text-sm text-muted-foreground">No activity yet.</p>
  return <ol className="grid gap-2">
    {records.map(record => <li key={record.id} className="rounded-md border p-3 text-sm">
      <div className="font-medium">{auditLabels[record.action] ?? record.action} · {record.actor_name}</div>
      <div className="text-xs text-muted-foreground">{new Date(record.occurred_at).toLocaleString()}</div>
      {record.reason && <p className="mt-1">{record.reason}</p>}
      <ul className="mt-1 text-xs text-muted-foreground">
        {Object.entries(auditFields).flatMap(([key, label]) => {
          const before = record.before_record?.[key]
          const after = record.after_record[key]
          if (before === after || (before == null && after == null)) return []
          const value = (value: unknown) => key === 'amount' && value != null ? checkMoney.format(Number(value)) : String(value ?? '—')
          return [<li key={key}>{label}: {record.before_record ? `${value(before)} → ` : ''}{value(after)}</li>]
        })}
      </ul>
    </li>)}
  </ol>
}
