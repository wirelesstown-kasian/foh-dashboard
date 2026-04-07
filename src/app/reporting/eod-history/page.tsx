'use client'

import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { ReportingToolbar } from '@/components/reporting/ReportingToolbar'
import { useEodReports } from '@/components/reporting/useReportingData'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ReportPeriod, formatCurrency, getReportRange } from '@/lib/reporting'

export default function EodHistoryPage() {
  const eodReports = useEodReports()
  const [period, setPeriod] = useState<ReportPeriod>('weekly')
  const [refDate, setRefDate] = useState(new Date())
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const [startDate, endDate] = useMemo(
    () => getReportRange(period, refDate, customStart, customEnd),
    [period, refDate, customStart, customEnd]
  )
  const filteredEodReports = useMemo(
    () => eodReports.filter(report => report.session_date >= startDate && report.session_date <= endDate),
    [eodReports, endDate, startDate]
  )
  const totals = useMemo(
    () =>
      filteredEodReports.reduce(
        (sum, report) => ({
          cash: sum.cash + report.cash_total,
          batch: sum.batch + report.batch_total,
          revenue: sum.revenue + report.revenue_total,
          tip: sum.tip + report.tip_total,
          deposit: sum.deposit + report.cash_deposit,
        }),
        { cash: 0, batch: 0, revenue: 0, tip: 0, deposit: 0 }
      ),
    [filteredEodReports]
  )

  return (
    <div className="p-6">
      <AdminSubpageHeader
        title="EOD History"
        subtitle="Store-wide financial history with consistent date controls."
        backHref="/reporting"
        backLabel="Back to Reporting"
      />
      <div className="rounded-xl border bg-white p-5">
        <ReportingToolbar
          period={period}
          refDate={refDate}
          customStart={customStart}
          customEnd={customEnd}
          onPeriodChange={setPeriod}
          onRefDateChange={setRefDate}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Cash Total</TableHead>
              <TableHead className="text-right">Batch Total</TableHead>
              <TableHead className="text-right">Revenue Total</TableHead>
              <TableHead className="text-right">Tip Total</TableHead>
              <TableHead className="text-right">Cash Deposit</TableHead>
              <TableHead>Memo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEodReports.map(report => (
              <TableRow key={report.id}>
                <TableCell className="font-medium">{format(new Date(report.session_date), 'MMM d, yyyy')}</TableCell>
                <TableCell className="text-right">{formatCurrency(report.cash_total)}</TableCell>
                <TableCell className="text-right">{formatCurrency(report.batch_total)}</TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(report.revenue_total)}</TableCell>
                <TableCell className="text-right text-green-700">{formatCurrency(report.tip_total)}</TableCell>
                <TableCell className="text-right">{formatCurrency(report.cash_deposit)}</TableCell>
                <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{report.memo ?? '—'}</TableCell>
              </TableRow>
            ))}
            {filteredEodReports.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">No EOD reports for this range</TableCell>
              </TableRow>
            )}
          </TableBody>
          {filteredEodReports.length > 0 && (
            <tfoot>
              <TableRow>
                <TableCell className="font-semibold">Period Total</TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(totals.cash)}</TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(totals.batch)}</TableCell>
                <TableCell className="text-right font-bold">{formatCurrency(totals.revenue)}</TableCell>
                <TableCell className="text-right font-semibold text-green-700">{formatCurrency(totals.tip)}</TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(totals.deposit)}</TableCell>
                <TableCell />
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>
    </div>
  )
}
