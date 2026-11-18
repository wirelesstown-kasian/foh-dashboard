'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { checkMoney, type CheckEntry, type CheckRun, type PayrollCheckRow } from '@/lib/checkWriter'
import { CategoryField, Field, PinForm, checkInput, type SubmitCheck } from './check-form'

export type PayrollCheckItems = { run: CheckRun; items: Pick<PayrollCheckRow, 'id' | 'employee_name' | 'allocated'>[] }

export function runLabel(run: CheckRun) {
  return `${run.pay_date} · ${run.department} · ${run.start_date} to ${run.end_date}`
}

export function PayrollChecks({ runs, initialRunId, entries, getRun, prepare, record, editDraft }: {
  runs: CheckRun[]
  initialRunId: string
  entries: CheckEntry[]
  getRun: (run: string, signal: AbortSignal) => Promise<PayrollCheckItems>
  prepare: (run: CheckRun, rows: PayrollCheckRow[]) => void
  record: (row: PayrollCheckRow, source: 'payroll_balance' | 'handwritten') => void
  editDraft: (entry: CheckEntry) => void
}) {
  const [runId, setRunId] = useState(initialRunId)
  const [requested, setRequested] = useState<{ id: string; error?: string; result?: PayrollCheckItems } | null>(null)
  useEffect(() => {
    if (!runId) return
    const controller = new AbortController()
    getRun(runId, controller.signal)
      .then(result => setRequested({ id: runId, result }))
      .catch(error => {
        if (!controller.signal.aborted) setRequested({ id: runId, error: error.message })
      })
    return () => controller.abort()
  }, [runId, getRun])

  const current = requested?.id === runId ? requested : null
  const rows = (current?.result?.items ?? []).flatMap(item => {
    const linked = entries.filter(entry => entry.payroll_item_id === item.id)
    if (!item.allocated && !linked.length) return []
    const paidCents = linked.reduce((sum, entry) => entry.status === 'issued' ? sum + Math.round(entry.amount * 100) : sum, 0)
    return [{
      ...item, paid: paidCents / 100, remaining: (Math.round(item.allocated * 100) - paidCents) / 100,
      open: linked.find(entry => entry.status === 'draft' || entry.status === 'printing') ?? null,
    }]
  }).sort((left, right) => left.employee_name.localeCompare(right.employee_name))
  const eligible = rows.filter(row => row.remaining > 0 && !row.open)

  return <section className="grid gap-4 rounded-xl border bg-white p-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="w-full max-w-xl">
        <Field label="Saved payroll run"><select className={checkInput} value={runId} onChange={event => setRunId(event.target.value)}>
          <option value="">Choose saved payroll</option>
          {runId && !runs.some(run => run.id === runId) && <option value={runId}>Linked payroll run</option>}
          {runs.map(run => <option key={run.id} value={run.id}>{runLabel(run)}</option>)}
        </select></Field>
      </div>
      <Button disabled={!eligible.length || !current?.result} onClick={() => {
        if (current?.result) prepare(current.result.run, eligible)
      }}>Prepare checks</Button>
    </div>
    {runId && !current && <p role="status" className="text-sm text-muted-foreground">Loading payroll…</p>}
    {current?.error && <p role="alert" className="text-sm text-red-700">{current.error}</p>}
    {current?.result && rows.length === 0 && <p className="text-sm text-muted-foreground">There are no check allocations in this payroll run.</p>}
    {rows.length > 0 && <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b text-muted-foreground"><tr>
          {['Employee', 'Check allocation', 'Recorded', 'Balance', 'Status', 'Actions'].map(label => <th key={label} scope="col" className="p-2">{label}</th>)}
        </tr></thead>
        <tbody>{rows.map(row => {
          const unreserved = Math.round((row.remaining - (row.open?.amount ?? 0)) * 100) / 100
          const partial = row.paid > 0 || (row.open && unreserved > 0)
          return <tr key={row.id} className="border-b last:border-0">
              <th scope="row" className="p-2 font-medium">{row.employee_name}</th>
              <td className="whitespace-nowrap p-2">{checkMoney.format(row.allocated)}</td>
              <td className="whitespace-nowrap p-2">{checkMoney.format(row.paid)}</td>
              <td className="whitespace-nowrap p-2">{checkMoney.format(row.remaining)}</td>
              <td className="p-2">
                {row.remaining < 0 ? 'Review payroll change' : row.remaining === 0 ? 'Complete' :
                  partial ? 'Partial payroll payout' : 'Open'}
                {row.open && <div className="text-xs text-muted-foreground">
                  {row.open.status === 'printing' ? 'Print pending' : 'Draft'} · {checkMoney.format(row.open.amount)}
                </div>}
              </td>
              <td className="p-2">
                <div className="flex flex-wrap gap-1.5">
                  {row.open?.status === 'draft' && <Button variant="outline" size="sm" onClick={() => editDraft(row.open!)}>Edit draft</Button>}
                  {unreserved > 0 && <>
                    <Button variant="outline" size="sm" onClick={() => record({ ...row, remaining: unreserved }, 'handwritten')}>Record check</Button>
                    <Button variant="outline" size="sm" onClick={() => record({ ...row, remaining: unreserved }, 'payroll_balance')}>Record cash / ACH</Button>
                  </>}
                </div>
              </td>
            </tr>
        })}</tbody>
      </table>
    </div>}
  </section>
}

export function PrepareChecks({ run, rows, submit }: { run: CheckRun; rows: PayrollCheckRow[]; submit: SubmitCheck }) {
  const [chosen, setChosen] = useState(() => new Set(rows.map(row => row.id)))
  const [category, setCategory] = useState('')
  return <PinForm label="Create selected drafts" submit={pin => {
    if (chosen.size === 0) throw new Error('Select at least one employee.')
    return submit('prepare', { run_id: run.id, category, items: [...chosen].map(payroll_item_id => ({ payroll_item_id })) }, pin)
  }}>
    <p className="text-sm text-muted-foreground">{runLabel(run)}</p>
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm font-medium">{chosen.size} selected</span>
      <Button type="button" size="sm" variant="outline" onClick={() => setChosen(new Set(rows.map(row => row.id)))}>Select all</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => setChosen(new Set())}>Clear selection</Button>
    </div>
    <div className="grid gap-2">
      {rows.map(row => <label key={row.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
        <input type="checkbox" checked={chosen.has(row.id)} onChange={event => {
          const checked = event.target.checked
          setChosen(current => {
            const next = new Set(current)
            if (checked) next.add(row.id)
            else next.delete(row.id)
            return next
          })
        }} />
        <span className="flex-1">{row.employee_name}</span><span>{checkMoney.format(row.remaining)}</span>
      </label>)}
    </div>
    <CategoryField value={category} change={setCategory} />
  </PinForm>
}
