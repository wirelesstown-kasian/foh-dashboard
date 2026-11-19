'use client'

import { useEffect, useState } from 'react'
import { checkMoney, type CheckAudit, type CheckEntry, type CheckVendor } from '@/lib/checkWriter'
import { Button } from '@/components/ui/button'
import { CategoryField, Field, PinForm, checkInput, type SubmitCheck } from './check-form'

export function PrintForm({ entries, submit, data, reprint = false }: {
  entries: CheckEntry[]; submit: SubmitCheck; data: import('@/lib/checkWriter').CheckData; reprint?: boolean
}) {
  const [numbers, setNumbers] = useState<Record<string, string>>(() => Object.fromEntries(entries.map(entry => [entry.id, entry.check_number ?? ''])))
  const [category, setCategory] = useState('')
  const [preview, setPreview] = useState('')
  const [previewError, setPreviewError] = useState('')
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const uncategorized = !reprint && entries.some(entry => !entry.category)
  const action = reprint ? 'reprint' : 'print'
  return <PinForm label={reprint ? 'Authorize reprint' : 'Authorize print'} submit={pin => submit(action, {
    items: entries.map(entry => ({
      id: entry.id, revision: entry.revision, check_number: numbers[entry.id] || undefined,
      category: entry.category || category,
    })),
  }, pin)}>
    <p className="text-sm text-muted-foreground">
      {reprint
        ? 'This records an audited reprint and opens the printer.'
        : 'Print at 100% on letter paper with headers and footers turned off. Authorized checks are recorded as issued.'}
    </p>
    <Button type="button" variant="outline" onClick={async () => {
      setPreviewError('')
      try {
        let alignment = { x: 0, y: 0 }
        try { alignment = JSON.parse(localStorage.getItem('foh-check-print-alignment') ?? '{}') } catch {}
        const { checkPdf } = await import('@/lib/checkPdf')
        const bytes = await checkPdf(entries.map(entry => ({ ...entry, check_number: numbers[entry.id] || null })), alignment, data)
        setPreview(URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })))
      } catch { setPreviewError('Could not generate preview. Try again.') }
    }}>Preview PDF alignment</Button>
    {previewError && <p role="alert">{previewError}</p>}
    {preview && <><iframe title="Check PDF print preview" src={preview} className="h-96 w-full border" /><a href={preview} target="_blank" rel="noopener">Open preview full size</a></>}
    <div className="grid gap-2">
      {entries.map(entry => <div key={entry.id} className="grid grid-cols-[1fr_9rem] items-end gap-3 rounded-md border p-2.5">
        <div className="text-sm"><div className="font-medium">{entry.payee_name}</div>
          {checkMoney.format(entry.amount)} · {entry.bank_account}
          {entry.omit_payee_on_print && <div className="text-xs text-muted-foreground">Payee will print blank</div>}
        </div>
        <Field label="Check number (optional)"><input className={checkInput} inputMode="numeric" pattern="[0-9]{1,12}"
          maxLength={12} value={numbers[entry.id] ?? ''}
          onChange={event => setNumbers(current => ({ ...current, [entry.id]: event.target.value }))} /></Field>
      </div>)}
    </div>
    {uncategorized && <div className="grid gap-1">
      <CategoryField value={category} change={setCategory} required />
      <p className="text-xs text-muted-foreground">Used for selected drafts without a category.</p>
    </div>}
  </PinForm>
}

export function VendorForm({ vendor, submit }: { vendor?: CheckVendor; submit: SubmitCheck }) {
  const [name, setName] = useState(vendor?.name ?? '')
  const [category, setCategory] = useState(vendor?.category ?? '')
  const [address, setAddress] = useState(vendor?.address ?? '')
  const [phone, setPhone] = useState(vendor?.phone ?? '')
  return <PinForm label="Save vendor" submit={pin => submit('save_vendor', { id: vendor?.id, name, category, address, phone }, pin)}>
    <Field label="Vendor name"><input className={checkInput} maxLength={100} required value={name} onChange={event => setName(event.target.value)} /></Field>
    <Field label="Address"><input className={checkInput} maxLength={240} value={address} onChange={event => setAddress(event.target.value)} /></Field>
    <Field label="Phone"><input className={checkInput} maxLength={60} value={phone} onChange={event => setPhone(event.target.value)} /></Field>
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
  save: 'Saved', prepare: 'Prepared from payroll', print: 'Printed', reprint: 'Reprinted',
  resolve_print: 'Print result saved', remove: 'Draft removed', void: 'Payment voided',
  categorize: 'Accounting details updated', save_vendor: 'Vendor saved', archive_vendor: 'Vendor archived',
}
const auditFields: Record<string, string> = {
  status: 'Status', payment_date: 'Payment date', payee_name: 'Payee', name: 'Vendor',
  omit_payee_on_print: 'Leave payee blank when printing',
  amount: 'Amount', bank_account: 'Bank account', check_number: 'Check number', category: 'Category',
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
          const value = (value: unknown) => {
            if (key === 'omit_payee_on_print') return value ? 'Yes' : 'No'
            return key === 'amount' && value != null ? checkMoney.format(Number(value)) : String(value ?? '—')
          }
          return [<li key={key}>{label}: {record.before_record ? `${value(before)} → ` : ''}{value(after)}</li>]
        })}
      </ul>
    </li>)}
  </ol>
}
