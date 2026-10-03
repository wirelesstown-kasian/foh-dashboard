'use client'

import { useEffect, useMemo, useState } from 'react'

type Period = { start_date: string; end_date: string; period_kind: 'month' | 'partial' }
type Sale = Period & { net_revenue: number }
type Payroll = Period & {
  category: 'server' | 'kitchen' | 'owner'
  cash_tip?: number | null
  check_tip?: number | null
  base?: number | null
  cash?: number | null
  check?: number | null
}
type HistoricalData = { version: number; sales: Sale[]; payroll: Payroll[] }

const money = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2,
}).format(value)

function payrollTotal(row: Payroll) {
  return row.category === 'server'
    ? Number(row.cash_tip ?? 0) + Number(row.check_tip ?? 0) + Number(row.base ?? 0)
    : Number(row.cash ?? 0) + Number(row.check ?? 0)
}

export function HistoricalAdjustmentsPanel() {
  const [data, setData] = useState<HistoricalData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    void fetch('/api/historical-adjustments', { cache: 'no-store' })
      .then(async response => {
        if (response.status === 401) throw new Error('Sign in with a manager email account to view the historical totals.')
        if (!response.ok) throw new Error('Historical data unavailable')
        return response.json() as Promise<{ data: HistoricalData | null }>
      })
      .then(result => { if (mounted) setData(result.data) })
      .catch((reason: unknown) => { if (mounted) setError(reason instanceof Error ? reason.message : 'Historical data unavailable') })
    return () => { mounted = false }
  }, [])

  const months = useMemo(() => {
    if (!data) return []
    const byMonth = new Map<string, {
      month: string; sales: number | null; server: number | null;
      kitchen: number | null; owner: number | null; partial: string[]
    }>()
    const getMonth = (date: string) => {
      const month = date.slice(0, 7)
      if (!byMonth.has(month)) byMonth.set(month, {
        month, sales: null, server: null, kitchen: null, owner: null, partial: [],
      })
      return byMonth.get(month)!
    }
    for (const row of data.sales) {
      const month = getMonth(row.start_date)
      month.sales = (month.sales ?? 0) + Number(row.net_revenue)
      if (row.period_kind === 'partial') month.partial.push(`Sales ${row.start_date.slice(5)}–${row.end_date.slice(5)}`)
    }
    for (const row of data.payroll) {
      const month = getMonth(row.start_date)
      month[row.category] = (month[row.category] ?? 0) + payrollTotal(row)
      if (row.period_kind === 'partial') month.partial.push(`${row.category} ${row.start_date.slice(5)}–${row.end_date.slice(5)}`)
    }
    return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
  }, [data])

  if (error) return <p className="mb-5 text-sm text-red-700">{error}</p>
  if (!data || months.length === 0) return null

  return (
    <section className="mb-5 rounded-xl border bg-white p-4" aria-label="Imported historical totals">
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-slate-950">2026 historical totals</h2>
        <p className="text-xs text-muted-foreground">
          From FOH Adjust Sheet.xlsx. These are period summaries, separate from live EOD and payroll records.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[650px] text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-2 pr-3">Month</th>
              <th className="px-3 text-right">Net revenue</th>
              <th className="px-3 text-right">Server payroll</th>
              <th className="px-3 text-right">Kitchen payroll</th>
              <th className="pl-3 text-right">Owner payroll</th>
            </tr>
          </thead>
          <tbody>
            {months.map(row => (
              <tr key={row.month} className="border-b last:border-b-0">
                <td className="py-2 pr-3 font-medium">
                  {new Date(`${row.month}-01T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                  {row.partial.length > 0 && <div className="text-[10px] font-normal text-amber-700">Partial: {row.partial.join(', ')}</div>}
                </td>
                {[row.sales, row.server, row.kitchen, row.owner].map((value, index) => (
                  <td key={index} className={`${index === 3 ? 'pl-3' : 'px-3'} py-2 text-right tabular-nums`}>
                    {value === null ? '—' : money(value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Server totals include cash tips, check tips, and base pay. Kitchen and owner totals include the cash and check columns from the sheet.
        Partial periods and overlapping saved payroll are shown here only; they are not added to the live dashboard totals.
      </p>
    </section>
  )
}
