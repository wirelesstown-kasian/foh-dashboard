'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowLeft, Download, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  STAFF_CHECK_CATEGORY, checkCsv, checkMemo, checkMoney, isPartialCheck,
  type CheckCategory, type CheckAudit, type CheckData, type CheckEntry, type CheckRun, type CheckStatus, type CheckVendor, type PayrollCheckRow,
} from '@/lib/checkWriter'
import { printAlignmentSample, printChecks, type PrintAlignment } from '@/lib/checkVoucher'
import { CategoryContext, CheckForm, Field, PinForm, checkInput, quickBooksCategories, type SubmitCheck } from './check-form'
import { AccountingForm, AuditHistory, PrintForm, RemoveForm, VendorForm } from './check-dialogs'
import { PayrollChecks, PrepareChecks, type PayrollCheckItems } from './payroll-checks'

const statusLabels: Record<CheckStatus, string> = {
  draft: 'Draft', printing: 'Legacy print pending', issued: 'Issued', void: 'Voided', removed: 'Removed',
}

type CheckTab = 'drafts' | 'register' | 'payroll' | 'vendors' | 'categories'
type Panel =
  | { type: 'entry'; source: 'app' | 'handwritten' | 'payroll' | 'payroll_balance'; entry?: CheckEntry; payroll?: PayrollCheckRow }
  | { type: 'category'; category?: CheckCategory }
  | { type: 'vendor'; vendor?: CheckVendor }
  | { type: 'archive'; vendor: CheckVendor }
  | { type: 'prepare'; run: CheckRun; rows: PayrollCheckRow[] }
  | { type: 'print' | 'reprint' | 'resolve'; entries: CheckEntry[] }
  | { type: 'accounting' | 'remove'; entry: CheckEntry }
  | { type: 'history'; id: string; vendor?: boolean; name: string }

const tabs: { id: CheckTab; label: string }[] = [
  { id: 'drafts', label: 'Drafts & printing' },
  { id: 'register', label: 'Check register' },
  { id: 'payroll', label: 'Saved payroll' },
  { id: 'vendors', label: 'Vendors & Staff' },
  { id: 'categories', label: 'Categories' },
]

async function request<T>(query = '', options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/check-writer${query}`, { cache: 'no-store', ...options })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error ?? 'Check Writer could not complete the request.')
  return payload
}

function getRun(id: string, signal: AbortSignal) {
  return request<PayrollCheckItems>(`?run=${encodeURIComponent(id)}`, { signal })
}

function HistoryPanel({ id, vendor }: { id: string; vendor?: boolean }) {
  const [history, setHistory] = useState<CheckAudit[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    request<{ history: CheckAudit[] }>(`?history=${id}${vendor ? '&type=vendor' : ''}`, { signal: controller.signal })
      .then(result => setHistory(result.history))
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [id, vendor])

  if (error) return <p className="text-sm text-red-700" role="alert">{error}</p>
  if (!history) return <p className="text-sm text-muted-foreground" role="status">Loading history…</p>
  return <AuditHistory records={history} />
}

function downloadCsv(entries: CheckEntry[]) {
  const url = URL.createObjectURL(new Blob(['\ufeff', checkCsv(entries)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'check-register-quickbooks.csv'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function panelTitle(panel: Panel) {
  switch (panel.type) {
    case 'entry':
      if (panel.entry) return 'Edit check draft'
      if (panel.source === 'handwritten') return 'Record handwritten check'
      return panel.source === 'payroll_balance' ? 'Record payroll balance payment' : 'Write a check'
    case 'category': return panel.category ? 'Edit category' : 'New category'
    case 'vendor': return panel.vendor ? 'Edit vendor' : 'Add vendor'
    case 'archive': return 'Archive vendor'
    case 'prepare': return 'Choose employees for check drafts'
    case 'print': return 'Print checks'
    case 'reprint': return 'Reprint checks'
    case 'resolve': return 'Resolve legacy print records'
    case 'accounting': return 'Edit accounting details'
    case 'remove': return panel.entry.status === 'draft' ? 'Remove draft' : 'Void payment'
    case 'history': return `History · ${panel.name}`
  }
}

function readAlignment(): PrintAlignment {
  try {
    const value = JSON.parse(localStorage.getItem('foh-check-print-alignment') ?? '{}')
    return { x: Number(value.x) || 0, y: Number(value.y) || 0 }
  } catch {
    return { x: 0, y: 0 }
  }
}

function AlignmentControls() {
  const [sampleUrl, setSampleUrl] = useState('')
  useEffect(() => () => { if (sampleUrl) URL.revokeObjectURL(sampleUrl) }, [sampleUrl])
  const [alignment, setAlignment] = useState<PrintAlignment>(readAlignment)
  function update(axis: keyof PrintAlignment, input: number) {
    const next = { ...alignment, [axis]: Math.max(-0.5, Math.min(0.5, input)) }
    setAlignment(next)
    try { localStorage.setItem('foh-check-print-alignment', JSON.stringify(next)) } catch {}
  }
  return <details className="rounded-xl border bg-white p-4">
    <summary className="cursor-pointer text-sm font-medium">Voucher alignment</summary>
    <div className="mt-3 grid gap-3">
      <p className="text-sm text-muted-foreground">Print a sample on plain letter paper at 100% and compare it with your stock. Positive offsets move fields right or down. Offsets are stored on this browser.</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Horizontal offset (in)"><input className={checkInput} type="number" min="-0.5" max="0.5" step="0.01"
          value={alignment.x} onChange={event => update('x', Number(event.target.value))} /></Field>
        <Field label="Vertical offset (in)"><input className={checkInput} type="number" min="-0.5" max="0.5" step="0.01"
          value={alignment.y} onChange={event => update('y', Number(event.target.value))} /></Field>
        <Button variant="outline" onClick={async () => setSampleUrl(await printAlignmentSample(alignment))}>Print alignment sample</Button>
      </div>
      {sampleUrl && <><iframe title="Alignment sample PDF" src={sampleUrl} className="h-96 w-full" /><a href={sampleUrl} target="_blank" rel="noopener">Open alignment PDF</a></>}
    </div>
  </details>
}

function EntryTable({ entries, chosen, toggle, edit, resolve, reprint, remove, accounting, history }: {
  entries: CheckEntry[]
  chosen?: Set<string>
  toggle?: (id: string) => void
  edit: (entry: CheckEntry) => void
  resolve: (entry: CheckEntry) => void
  reprint: (entry: CheckEntry) => void
  remove: (entry: CheckEntry) => void
  accounting: (entry: CheckEntry) => void
  history: (entry: CheckEntry) => void
}) {
  if (entries.length === 0) return <p className="p-4 text-sm text-muted-foreground">No matching checks or payments.</p>
  return <div className="overflow-x-auto">
    <table className="w-full text-left text-sm">
      <thead><tr className="border-b bg-slate-50 text-muted-foreground">
        {toggle && <th scope="col" className="p-3"><span className="sr-only">Select</span></th>}
        {['Date', 'Payee', 'Amount', 'Check / method', 'QuickBooks category', 'Status', 'Written by', 'Actions'].map(label =>
          <th key={label} scope="col" className="p-3">{label}</th>)}
      </tr></thead>
      <tbody>{entries.map(entry => <tr key={entry.id} className="border-b align-top last:border-0">
        {toggle && <td className="p-3">{entry.status === 'draft' && <input type="checkbox"
          aria-label={`Select check for ${entry.payee_name}`} checked={chosen?.has(entry.id)} onChange={() => toggle(entry.id)} />}</td>}
        <td className="whitespace-nowrap p-3">{entry.payment_date}</td>
        <th scope="row" className="p-3 font-medium">{entry.payee_name}
          <div className="text-xs font-normal text-muted-foreground">{entry.vendor_id ? 'Vendor' : 'Staff'}{entry.payroll_item_id && ' · Payroll'}</div>
          {checkMemo(entry) && <div className="max-w-56 break-words text-xs font-normal text-muted-foreground">{checkMemo(entry)}</div>}
          {entry.reference && <div className="max-w-56 break-words text-xs font-normal text-muted-foreground">Ref. {entry.reference}</div>}
        </th>
        <td className="whitespace-nowrap p-3">{checkMoney.format(entry.amount)}</td>
        <td className="whitespace-nowrap p-3">
          {entry.method === 'check' ? entry.check_number ? `#${entry.check_number}` : 'Check' : entry.method === 'ach' ? 'ACH' : 'Cash'}
          {entry.source === 'handwritten' && <div className="text-xs text-muted-foreground">Handwritten</div>}
          {entry.bank_account && <div className="text-xs text-muted-foreground">{entry.bank_account}</div>}
        </td>
        <td className="p-3">{entry.category || '—'}
          {entry.accounting_note && <div className="max-w-56 break-words text-xs text-muted-foreground">{entry.accounting_note}</div>}
        </td>
        <td className="p-3"><span className={`whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium ${entry.status === 'printing'
          ? 'bg-amber-100 text-amber-900' : entry.status === 'issued' ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-100 text-slate-700'}`}>
          {statusLabels[entry.status]}</span>
          {isPartialCheck(entry) && <div className="mt-1 text-xs text-muted-foreground">Partial payout</div>}
        </td>
        <td className="p-3">{entry.issued_by_name || entry.created_by_name}

        </td>
        <td className="p-3"><div className="flex flex-wrap gap-1.5">
          {entry.status === 'draft' && <Button variant="outline" size="sm" onClick={() => edit(entry)}>Edit</Button>}
          {entry.status === 'printing' && <Button variant="outline" size="sm" onClick={() => resolve(entry)}>Confirm result</Button>}
          {entry.status === 'issued' && <><Button variant="outline" size="sm" onClick={() => reprint(entry)}>Reprint</Button><Button variant="outline" size="sm" onClick={() => accounting(entry)}>Edit details</Button></>}
          {(entry.status === 'draft' || entry.status === 'issued') && <Button variant="ghost" size="sm" onClick={() => remove(entry)}>
            {entry.status === 'draft' ? 'Remove' : 'Void'}
          </Button>}
          <Button variant="ghost" size="sm" onClick={() => history(entry)}>History<span className="sr-only"> for {entry.payee_name}</span></Button>
        </div></td>
      </tr>)}</tbody>
    </table>
  </div>
}

export function CheckWriter({ initialRunId }: { initialRunId: string }) {
  const [data, setData] = useState<CheckData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [tab, setTab] = useState<CheckTab>(initialRunId ? 'payroll' : 'drafts')
  const [panel, setPanel] = useState<Panel | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(() => new Set())
  const [notice, setNotice] = useState('')
  const [printUrl, setPrintUrl] = useState('')
  useEffect(() => () => { if (printUrl) URL.revokeObjectURL(printUrl) }, [printUrl])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [registerStatus, setRegisterStatus] = useState('issued')

  useEffect(() => {
    const controller = new AbortController()
    request<CheckData>('', { signal: controller.signal }).then(data => {
      setData(data)
      setLoadError('')
    }).catch(error => { if (!controller.signal.aborted) setLoadError(error.message) })
    return () => controller.abort()
  }, [refresh])

  function open(next: Panel) {
    setNotice('')
    setPanel(next)
  }

  const submit: SubmitCheck = async (action, values, pin) => {
    const { saved } = await request<{ saved: CheckEntry[] }>('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, data: values, pin }),
    })
    if (action.endsWith('_category')) {
      const category = saved[0] as unknown as CheckCategory
      setData(current => current && { ...current, categories: [...current.categories.filter(item => item.id !== category.id), category].sort((a, b) => a.name.localeCompare(b.name)) })
      return saved
    }
    if (action === 'save_vendor' || action === 'archive_vendor') {
      const vendor = saved[0] as unknown as CheckVendor
      setData(current => current && { ...current, vendors: [...current.vendors.filter(item => item.id !== vendor.id), vendor]
        .sort((left, right) => left.name.localeCompare(right.name)) })
    } else {
      const savedIds = new Set(saved.map(row => row.id))
      setData(current => current && { ...current, entries: [...saved, ...current.entries.filter(entry => !savedIds.has(entry.id))]
        .sort((left, right) => right.payment_date.localeCompare(left.payment_date)) })
      setChosen(current => new Set([...current].filter(id => !savedIds.has(id))))
    }
    if (action === 'print' || action === 'reprint') {
      const printOrder = new Map(saved.map(entry => [entry.id, entry]))
      const ordered = (values.items as { id: string }[]).flatMap(item => {
        const entry = printOrder.get(item.id)
        return entry ? [entry] : []
      })
      setPanel(null)
      try {
        setPrintUrl(await printChecks(ordered, readAlignment(), data!))
        setNotice(action === 'reprint' ? 'Reprint PDF ready. Print at actual size (100%).' : 'Check PDF ready. Checks recorded as issued; print at actual size (100%).')
      } catch {
        setNotice('The action was recorded, but the PDF could not be generated. Use Reprint from the register to try again.')
      }
    } else {
      setPanel(null)
      if (action === 'prepare') {
        setNotice(saved.length ? `${saved.length} check draft${saved.length === 1 ? '' : 's'} created.` : 'No new drafts were needed.')
        if (saved.length) setTab('drafts')
      } else {
        const messages = {
          save: 'Saved.', resolve_print: 'Print results recorded.', reprint: 'Reprint PDF ready. Print at actual size (100%).', remove: 'Draft removed.',
          void: 'Payment voided.', categorize: 'Accounting details saved.',
          save_category: 'Category saved.', archive_category: 'Category archived.', restore_category: 'Category restored.',
          save_vendor: 'Vendor saved.', archive_vendor: 'Vendor archived.',
        }
        setNotice(messages[action])
        if (action === 'save' && values.source === 'handwritten') {
          setRegisterStatus('issued')
          setTab('register')
        }
      }
    }
    return saved
  }

  const drafts = data?.entries.filter(entry => entry.status === 'draft') ?? []
  const pending = data?.entries.filter(entry => entry.status === 'printing') ?? []
  const work = [...pending, ...drafts]
  const selectedDrafts = drafts.filter(entry => chosen.has(entry.id))
  const register = data?.entries.filter(entry => {
    if (entry.status === 'draft' || entry.status === 'printing') return false
    if (registerStatus !== 'all' && entry.status !== registerStatus) return false
    return (!from || entry.payment_date >= from) && (!to || entry.payment_date <= to)
      && (!category || entry.category === category)
      && (!query.trim() || [entry.payee_name, entry.check_number].some(value => value?.toLowerCase().includes(query.trim().toLowerCase())))
  }) ?? []
  const savedCategories = [...(data?.entries ?? []), ...(data?.vendors ?? [])]
    .flatMap(item => item.category ? [item.category] : [])
  const categories = [...new Set([...quickBooksCategories, ...savedCategories])].sort()
  const bankAccounts = [...new Set(['Checking', ...(data?.entries ?? []).flatMap(item => item.bank_account ? [item.bank_account] : [])])].sort()

  const tableActions = {
    edit: (entry: CheckEntry) => open({ type: 'entry', entry, source: entry.payroll_item_id ? 'payroll' : 'app' }),
    resolve: (entry: CheckEntry) => open({ type: 'resolve', entries: [entry] }),
    reprint: (entry: CheckEntry) => open({ type: 'reprint', entries: [entry] }),
    remove: (entry: CheckEntry) => open({ type: 'remove', entry }),
    accounting: (entry: CheckEntry) => open({ type: 'accounting', entry }),
    history: (entry: CheckEntry) => open({ type: 'history', id: entry.id, name: entry.payee_name }),
  }

  return <div className="mx-auto grid max-w-7xl gap-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Admin Board
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Checks</h1>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => open({ type: 'entry', source: 'handwritten' })} disabled={!data}>Record handwritten check</Button>
        <Button onClick={() => open({ type: 'entry', source: 'app' })} disabled={!data}>Write a check</Button>
      </div>
    </header>
    <datalist id="check-categories">{categories.map(name => <option key={name} value={name} />)}</datalist>
    <datalist id="check-bank-accounts">{bankAccounts.map(name => <option key={name} value={name} />)}</datalist>
    {notice && <p className="rounded-lg border bg-emerald-50 p-3 text-sm text-emerald-900" role="status">{notice}</p>}
    {loadError && <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <p className="text-sm text-red-700" role="alert">{loadError}</p>
      <Button size="sm" variant="outline" onClick={() => setRefresh(value => value + 1)}>Retry</Button>
    </div>}
    {!data && !loadError && <p className="text-sm text-muted-foreground" role="status">Loading Check Writer…</p>}
    {data && <>
      <nav aria-label="Checks sections" className="flex flex-wrap items-center gap-3 border-b pb-4">
        {tabs.map(item => <Button key={item.id} variant={tab === item.id ? 'default' : 'outline'} size="lg"
          className="min-h-12 px-5 text-base shadow-sm" aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</Button>)}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setRefresh(value => value + 1)}>Refresh</Button>
      </nav>
      {tab === 'drafts' && <>
        <section className="rounded-xl border bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div className="text-sm text-muted-foreground">{drafts.length} drafts · {pending.length} pending</div>
            <div className="flex flex-wrap gap-2">
              {pending.length > 0 && <Button variant="outline" onClick={() => open({ type: 'resolve', entries: pending })}>Confirm pending prints</Button>}
              <Button variant="outline" disabled={!selectedDrafts.length} onClick={() => open({ type: 'print', entries: selectedDrafts })}>
                <Printer className="size-4" /> Print selected{selectedDrafts.length ? ` (${selectedDrafts.length})` : ''}
              </Button>
              <Button disabled={!drafts.length} onClick={() => open({ type: 'print', entries: drafts })}>Print all drafts</Button>
            </div>
          </div>
          <EntryTable entries={work} chosen={chosen} toggle={id => setChosen(current => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
          })} {...tableActions} />
        </section>
        <AlignmentControls />
      </>}
      {tab === 'register' && <section className="rounded-xl border bg-white">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Payee or check number"><input className={checkInput} type="search" placeholder="Search staff or vendors"
            value={query} onChange={event => setQuery(event.target.value)} /></Field>
          <Field label="From"><input className={checkInput} type="date" value={from} onChange={event => setFrom(event.target.value)} /></Field>
          <Field label="Through"><input className={checkInput} type="date" value={to} onChange={event => setTo(event.target.value)} /></Field>
          <Field label="Category"><select className={checkInput} value={category} onChange={event => setCategory(event.target.value)}>
            <option value="">All categories</option>{categories.map(value => <option key={value}>{value}</option>)}
          </select></Field>
          <Field label="Status"><select className={checkInput} value={registerStatus} onChange={event => setRegisterStatus(event.target.value)}>
            <option value="issued">Issued</option><option value="void">Voided</option><option value="removed">Removed</option>
            <option value="all">All register records</option>
          </select></Field>
          <Button variant="outline" className="w-fit sm:col-span-2" disabled={!register.some(entry => entry.status === 'issued' && entry.method === 'check')}
            onClick={() => downloadCsv(register)}><Download className="size-4" /> Export issued checks for QuickBooks</Button>
          <p className="self-center text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">Use the CSV to find bank-feed checks and copy their categories into QuickBooks Online.</p>
        </div>
        <EntryTable entries={register} {...tableActions} />
      </section>}
      <div hidden={tab !== 'payroll'}>
        <PayrollChecks runs={data.runs} initialRunId={initialRunId} entries={data.entries} getRun={getRun}
          prepare={(run, rows) => open({ type: 'prepare', run, rows })}
          record={(payroll, source) => open({ type: 'entry', payroll, source })} editDraft={tableActions.edit} />
      </div>
      {tab === 'vendors' && <section className="grid gap-3 rounded-xl border bg-white p-4">
        <div className="flex justify-between gap-3"><h2 className="text-lg font-semibold">Vendors & Staff</h2>
          <Button onClick={() => open({ type: 'vendor' })}>Add vendor</Button></div>
        {data.vendors.length === 0 && <p className="text-sm text-muted-foreground">No vendors yet.</p>}
        {data.employees.map(employee => <div key={`staff:${employee.id}`} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm">
          <div><div className="font-medium">{employee.name}{!employee.is_active && ' (inactive)'}</div>
          <div className="text-muted-foreground">Staff · Category: {STAFF_CHECK_CATEGORY}</div></div>
        </div>)}
        {data.vendors.map(vendor => <div key={vendor.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
          <div className="text-sm"><div className="font-medium">{vendor.name}{vendor.archived_at && ' (archived)'}</div>
            <div className="text-muted-foreground">Category: {vendor.category || 'Unassigned'}</div>{(vendor.address || vendor.phone) && <div className="text-xs text-muted-foreground">{[vendor.address, vendor.phone].filter(Boolean).join(' · ')}</div>}</div>
          <div className="flex flex-wrap gap-1">
            {!vendor.archived_at && <>
              <Button variant="outline" size="sm" onClick={() => open({ type: 'vendor', vendor })}>Edit</Button>
              <Button variant="ghost" size="sm" onClick={() => open({ type: 'archive', vendor })}>Archive</Button>
            </>}
            <Button variant="ghost" size="sm" onClick={() => open({ type: 'history', id: vendor.id, name: vendor.name, vendor: true })}>History</Button>
          </div>
        </div>)}
      </section>}
    </>}
    {data && tab === 'categories' && <section className="grid gap-3 rounded-xl border p-4">
      <Button onClick={() => open({ type: 'category' })}>New category</Button>
      {data.categories.map(category => <div key={category.id} className="flex items-center justify-between border-t py-2">
        <span>{category.name}{category.archived_at ? ' (archived)' : ''}</span>
        <Button variant="outline" onClick={() => open({ type: 'category', category })}>Manage</Button>
      </div>)}
    </section>}
    <Dialog open={!!printUrl} onOpenChange={open => { if (!open) setPrintUrl('') }}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader><DialogTitle>Check PDF ready</DialogTitle><DialogDescription>Print on US Letter at actual size (100%). Disable fit to page.</DialogDescription></DialogHeader>
        <iframe title="Issued checks PDF" src={printUrl} className="h-[65vh] w-full" />
        <a href={printUrl} target="_blank" rel="noopener">Open PDF for printing</a>
        <a href={printUrl} download="checks.pdf">Download checks PDF</a>
      </DialogContent>
    </Dialog>
    <CategoryContext.Provider value={{ categories: data?.categories ?? [], submit }}>
    <Dialog open={panel !== null} onOpenChange={open => { if (!open) setPanel(null) }}>
      {panel && data && <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" key={panel.type}>
        <DialogHeader>
          <DialogTitle>{panelTitle(panel)}</DialogTitle>
          <DialogDescription className="sr-only">Check Writer {panel.type} details</DialogDescription>
        </DialogHeader>
        {panel.type === 'category' && <CategoryManager category={panel.category} submit={submit} close={() => setPanel(null)} />}
        {panel.type === 'entry' && <CheckForm data={data} source={panel.source} entry={panel.entry} payroll={panel.payroll} submit={submit} />}
        {panel.type === 'vendor' && <VendorForm vendor={panel.vendor} submit={submit} />}
        {panel.type === 'archive' && <PinForm label="Archive vendor" submit={pin => submit('archive_vendor', { id: panel.vendor.id }, pin)}>
          <p className="text-sm">Archive {panel.vendor.name}? Existing check history will still be available.</p>
        </PinForm>}
        {panel.type === 'prepare' && <PrepareChecks run={panel.run} rows={panel.rows} submit={submit} />}
        {panel.type === 'print' && <PrintForm entries={panel.entries} submit={submit} data={data} />}
        {panel.type === 'reprint' && <PrintForm entries={panel.entries} submit={submit} data={data} reprint />}
        {panel.type === 'resolve' && <p className="text-sm text-muted-foreground">This legacy print record needs a manager to resolve it before it can be changed.</p>}
        {panel.type === 'accounting' && <AccountingForm entry={panel.entry} submit={submit} />}
        {panel.type === 'remove' && <RemoveForm entry={panel.entry} submit={submit} />}
        {panel.type === 'history' && <HistoryPanel id={panel.id} vendor={panel.vendor} />}
      </DialogContent>}
    </Dialog>
    </CategoryContext.Provider>
  </div>
}

function CategoryManager({ category, submit, close }: { category?: CheckCategory; submit: SubmitCheck; close: () => void }) {
  const [name, setName] = useState(category?.name ?? '')
  const [action, setAction] = useState<'save_category' | 'archive_category' | 'restore_category'>('save_category')
  return <PinForm label="Save category changes" submit={async pin => {
    await submit(action, { id: category?.id, name }, pin); close()
  }}>
    <Field label="Category name"><input className={checkInput} required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></Field>
    {category && <Field label="Action"><select className={checkInput} value={action} onChange={event => setAction(event.target.value as typeof action)}>
      <option value="save_category">Edit name</option>
      <option value={category.archived_at ? 'restore_category' : 'archive_category'}>{category.archived_at ? 'Restore' : 'Archive'}</option>
    </select></Field>}
    <p className="text-sm">Historical transactions retain the category name recorded at the time.</p>
  </PinForm>
}
