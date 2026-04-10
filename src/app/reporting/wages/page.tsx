'use client'

import { useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { DepartmentTabs } from '@/components/reporting/DepartmentTabs'
import { ReportingToolbar } from '@/components/reporting/ReportingToolbar'
import { notifyReportingDataChanged, useClockRecords, useEmployees, useEodReports } from '@/components/reporting/useReportingData'
import { useAppSettings } from '@/components/useAppSettings'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { ReportDepartment, ReportPeriod, formatCurrency, getReportRange, isEmployeeInDepartment } from '@/lib/reporting'
import { getEffectiveClockHours, isClockPending } from '@/lib/clockUtils'
import { getRoleLabel } from '@/lib/organization'
import { exportReportToPdf } from '@/lib/reportExport'
import type { Employee } from '@/lib/types'

type TipReportView = 'earnings' | 'tips'

type WageDetailRow = {
  date: string
  hours: number
  tips: number
  baseWages: number
  guaranteeTopUp: number
  totalEarnings: number
}

type WageSummaryRow = {
  emp: Employee
  hours: number
  tips: number
  baseWages: number
  guaranteeTopUp: number
  totalEarnings: number
  tipRate: number | null
  effectiveRate: number | null
  hasAutoClockOut: boolean
  hasOpenClock: boolean
}

export default function WageReportPage() {
  const employees = useEmployees()
  const { eodReports } = useEodReports()
  const { clockRecords } = useClockRecords()
  const { roleDefinitions } = useAppSettings()

  const [department, setDepartment] = useState<ReportDepartment>('foh')
  const [period, setPeriod] = useState<ReportPeriod>('weekly')
  const [refDate, setRefDate] = useState(new Date())
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [view, setView] = useState<TipReportView>('earnings')
  const [employeeFilter, setEmployeeFilter] = useState('all')
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  const [detailEmployeeId, setDetailEmployeeId] = useState<string | null>(null)
  const [emailingEmployeeId, setEmailingEmployeeId] = useState<string | null>(null)

  const [startDate, endDate] = useMemo(
    () => getReportRange(period, refDate, customStart, customEnd),
    [period, refDate, customStart, customEnd]
  )
  const filteredEmployees = useMemo(
    () => employees.filter(employee => isEmployeeInDepartment(employee, department)),
    [employees, department]
  )

  const rows = useMemo(() => {
    const rangeReports = eodReports.filter(report => report.session_date >= startDate && report.session_date <= endDate)
    return filteredEmployees
      .map(emp => {
        let hours = 0
        let tips = 0
        let baseWages = 0
        let guaranteeTopUp = 0

        for (const report of rangeReports) {
          const distributions = (report.tip_distributions ?? []).filter(dist => dist.employee_id === emp.id)
          const dailyTips = distributions.reduce((sum, dist) => sum + Number(dist.net_tip), 0)
          const clockHours = clockRecords
            .filter(record => record.employee_id === emp.id && record.session_date === report.session_date)
            .reduce((sum, record) => sum + getEffectiveClockHours(record), 0)
          const distributionHours = distributions.reduce((sum, dist) => sum + Number(dist.hours_worked ?? 0), 0)
          const dailyHours = clockHours > 0 ? clockHours : distributionHours
          const dailyBaseWages = dailyHours * (emp.hourly_wage ?? 0)
          const dailyGuaranteedTarget = dailyHours * (emp.guaranteed_hourly ?? 0)

          hours += dailyHours
          tips += dailyTips
          baseWages += dailyBaseWages
          guaranteeTopUp += Math.max(0, dailyGuaranteedTarget - (dailyBaseWages + dailyTips))
        }

        const matchingClocks = clockRecords.filter(
          record => record.employee_id === emp.id && record.session_date >= startDate && record.session_date <= endDate
        )

        return {
          emp,
          hours,
          tips,
          baseWages,
          guaranteeTopUp,
          totalEarnings: baseWages + tips + guaranteeTopUp,
          tipRate: hours > 0 ? tips / hours : null,
          effectiveRate: hours > 0 ? (baseWages + tips + guaranteeTopUp) / hours : null,
          hasAutoClockOut: matchingClocks.some(record => record.auto_clock_out),
          hasOpenClock: matchingClocks.some(record => !record.clock_out_at || isClockPending(record)),
        }
      })
      .filter(row => row.hours > 0 || row.tips > 0 || row.baseWages > 0)
  }, [clockRecords, eodReports, filteredEmployees, endDate, startDate])

  const detailRowsByEmployeeId = useMemo(() => {
    const rangeReports = eodReports.filter(report => report.session_date >= startDate && report.session_date <= endDate)
    return new Map(
      filteredEmployees.map(emp => {
        const detailRows: WageDetailRow[] = rangeReports.flatMap(report => {
          const distributions = (report.tip_distributions ?? []).filter(dist => dist.employee_id === emp.id)
          const tips = distributions.reduce((sum, dist) => sum + Number(dist.net_tip), 0)
          const clockHours = clockRecords
            .filter(record => record.employee_id === emp.id && record.session_date === report.session_date)
            .reduce((sum, record) => sum + getEffectiveClockHours(record), 0)
          const distributionHours = distributions.reduce((sum, dist) => sum + Number(dist.hours_worked ?? 0), 0)
          const hours = clockHours > 0 ? clockHours : distributionHours
          if (hours <= 0 && tips <= 0) return []
          const baseWages = hours * Number(emp.hourly_wage ?? 0)
          const guaranteedTarget = hours * Number(emp.guaranteed_hourly ?? 0)
          const guaranteeTopUp = Math.max(0, guaranteedTarget - (baseWages + tips))
          return [{
            date: report.session_date,
            hours,
            tips,
            baseWages,
            guaranteeTopUp,
            totalEarnings: baseWages + tips + guaranteeTopUp,
          }]
        })

        const extraClockDates = Array.from(new Set(
          clockRecords
            .filter(record => record.employee_id === emp.id && record.session_date >= startDate && record.session_date <= endDate)
            .map(record => record.session_date)
        )).filter(date => !detailRows.some(row => row.date === date))

        for (const date of extraClockDates) {
          const hours = clockRecords
            .filter(record => record.employee_id === emp.id && record.session_date === date)
            .reduce((sum, record) => sum + getEffectiveClockHours(record), 0)
          if (hours <= 0) continue
          const baseWages = hours * Number(emp.hourly_wage ?? 0)
          const guaranteedTarget = hours * Number(emp.guaranteed_hourly ?? 0)
          const guaranteeTopUp = Math.max(0, guaranteedTarget - baseWages)
          detailRows.push({
            date,
            hours,
            tips: 0,
            baseWages,
            guaranteeTopUp,
            totalEarnings: baseWages + guaranteeTopUp,
          })
        }

        detailRows.sort((a, b) => b.date.localeCompare(a.date))
        return [emp.id, detailRows] as const
      })
    )
  }, [clockRecords, eodReports, filteredEmployees, endDate, startDate])

  const buildWageReportHtml = (row: WageSummaryRow) => {
    const details = detailRowsByEmployeeId.get(row.emp.id) ?? []
    return `
      <h1>${row.emp.name} Wage Report</h1>
      <p class="muted">${startDate === endDate ? startDate : `${startDate} - ${endDate}`}</p>
      <div class="summary">
        <div class="card"><strong>Hours</strong><div class="metric">${row.hours.toFixed(2)} hrs</div></div>
        <div class="card"><strong>Tips</strong><div class="metric">${formatCurrency(row.tips)}</div></div>
        ${view === 'earnings' ? `<div class="card"><strong>Base Wages</strong><div class="metric">${formatCurrency(row.baseWages)}</div></div>` : ''}
        ${view === 'earnings' ? `<div class="card"><strong>Total Earnings</strong><div class="metric">${formatCurrency(row.totalEarnings)}</div></div>` : ''}
      </div>
      <h3>Comp Summary</h3>
      <p>
        ${row.emp.name} worked ${row.hours.toFixed(2)} hours for this period and earned ${formatCurrency(row.tips)} in tips.
        ${view === 'earnings' ? ` Combined wages and guaranteed top-up brought total earnings to ${formatCurrency(row.totalEarnings)}.` : ''}
      </p>
      <table class="compact-table">
        <thead>
          <tr>
            <th>Date</th>
            <th class="right">Hours</th>
            <th class="right">Tips</th>
            ${view === 'earnings' ? '<th class="right">Base Wages</th><th class="right">Top-Up</th><th class="right">Total</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${details.map(detail => `
            <tr>
              <td>${detail.date}</td>
              <td class="right">${detail.hours.toFixed(2)}</td>
              <td class="right">${formatCurrency(detail.tips)}</td>
              ${view === 'earnings' ? `<td class="right">${formatCurrency(detail.baseWages)}</td><td class="right">${formatCurrency(detail.guaranteeTopUp)}</td><td class="right">${formatCurrency(detail.totalEarnings)}</td>` : ''}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  }

  const handleEmailReport = async (employeeId: string) => {
    setEmailingEmployeeId(employeeId)
    try {
      const res = await fetch('/api/send-wage-report-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId,
          ref_date: startDate,
          period: startDate === endDate ? 'daily' : period === 'custom' ? 'weekly' : period,
          start_date: startDate,
          end_date: endDate,
          view,
          report_html: detailTarget ? buildWageReportHtml(detailTarget) : undefined,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Failed to send report email')
      setRefreshMessage('Wage report emailed successfully.')
    } catch (error) {
      setRefreshMessage(error instanceof Error ? error.message : 'Failed to send report email')
    } finally {
      setEmailingEmployeeId(null)
    }
  }

  const displayedRows = useMemo(
    () => (employeeFilter === 'all' ? rows : rows.filter(row => row.emp.id === employeeFilter)),
    [employeeFilter, rows]
  )
  const detailTarget = displayedRows.find(row => row.emp.id === detailEmployeeId) ?? null
  const detailRows = detailTarget ? (detailRowsByEmployeeId.get(detailTarget.emp.id) ?? []) : []

  const handleRefresh = async () => {
    setRefreshing(true)
    setRefreshMessage(null)
    notifyReportingDataChanged()
    await new Promise(resolve => window.setTimeout(resolve, 350))
    setLastRefreshedAt(new Date())
    setRefreshMessage('Reloaded clock records and tip distributions.')
    setRefreshing(false)
  }

  return (
    <div className="p-6">
      <AdminSubpageHeader
        title="Wage Report"
        subtitle="Compare verified hours, tips, wages, and guaranteed top-up."
        backHref="/reporting"
        backLabel="Back to Reporting"
      />
      <DepartmentTabs department={department} onChange={value => { setDepartment(value); setEmployeeFilter('all') }} />
      <div className="rounded-xl border bg-white p-5">
        {refreshMessage && (
          <div className="mb-4 rounded-lg border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
            {refreshMessage}
          </div>
        )}
        <ReportingToolbar
          period={period}
          refDate={refDate}
          customStart={customStart}
          customEnd={customEnd}
          onPeriodChange={setPeriod}
          onRefDateChange={setRefDate}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
          leftSlot={
            <>
              <Select value={view} onValueChange={(value: string | null) => value && setView(value as TipReportView)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="earnings">Earnings</SelectItem>
                  <SelectItem value="tips">Tip Only</SelectItem>
                </SelectContent>
              </Select>
              <Select value={employeeFilter} onValueChange={(value: string | null) => value && setEmployeeFilter(value)}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Staff</SelectItem>
                  {filteredEmployees.map(employee => (
                    <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          }
          rightSlot={
            <>
              {lastRefreshedAt && (
                <span className="text-xs text-muted-foreground">
                  Updated {formatDistanceToNow(lastRefreshedAt, { addSuffix: true })}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </Button>
            </>
          }
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              <TableHead className="text-right">Tips</TableHead>
              <TableHead className="text-right">Tips / Hr</TableHead>
              {view === 'earnings' && (
                <>
                  <TableHead className="text-right">Base Wages</TableHead>
                  <TableHead className="text-right">Guaranteed Top-Up</TableHead>
                  <TableHead className="text-right">Total Earnings</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayedRows.map(row => (
              <TableRow key={row.emp.id}>
                <TableCell>
                  <button className="font-medium hover:underline" onClick={() => setDetailEmployeeId(row.emp.id)}>
                    {row.emp.name}
                  </button>
                </TableCell>
                <TableCell className="text-muted-foreground">{getRoleLabel(row.emp.role, roleDefinitions)}</TableCell>
                <TableCell>
                  {row.hasOpenClock ? (
                    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Clock Out Needed</Badge>
                  ) : row.hasAutoClockOut ? (
                    <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-800">Auto Clock-Out</Badge>
                  ) : (
                    <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">Verified</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">{row.hours.toFixed(2)}h</TableCell>
                <TableCell className="text-right font-semibold text-green-700">{formatCurrency(row.tips)}</TableCell>
                <TableCell className="text-right">{row.tipRate !== null ? formatCurrency(row.tipRate) : '—'}</TableCell>
                {view === 'earnings' && (
                  <>
                    <TableCell className="text-right">{formatCurrency(row.baseWages)}</TableCell>
                    <TableCell className="text-right text-violet-700">{formatCurrency(row.guaranteeTopUp)}</TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(row.totalEarnings)}</TableCell>
                  </>
                )}
              </TableRow>
            ))}
            {displayedRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={view === 'earnings' ? 9 : 6} className="py-6 text-center text-muted-foreground">No wage data for this range</TableCell>
              </TableRow>
            )}
          </TableBody>
          {displayedRows.length > 0 && (
            <tfoot>
              <TableRow>
                <TableCell className="font-semibold">Period Total</TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-right font-semibold">{displayedRows.reduce((sum, row) => sum + row.hours, 0).toFixed(2)}h</TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(displayedRows.reduce((sum, row) => sum + row.tips, 0))}</TableCell>
                <TableCell className="text-right">
                  {(() => {
                    const totalHours = displayedRows.reduce((sum, row) => sum + row.hours, 0)
                    const totalTips = displayedRows.reduce((sum, row) => sum + row.tips, 0)
                    return totalHours > 0 ? formatCurrency(totalTips / totalHours) : '—'
                  })()}
                </TableCell>
                {view === 'earnings' && (
                  <>
                    <TableCell className="text-right font-semibold">{formatCurrency(displayedRows.reduce((sum, row) => sum + row.baseWages, 0))}</TableCell>
                    <TableCell className="text-right font-semibold text-violet-700">{formatCurrency(displayedRows.reduce((sum, row) => sum + row.guaranteeTopUp, 0))}</TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(displayedRows.reduce((sum, row) => sum + row.totalEarnings, 0))}</TableCell>
                  </>
                )}
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>

      <Dialog open={!!detailTarget} onOpenChange={(open) => { if (!open) setDetailEmployeeId(null) }}>
        <DialogContent className="w-[calc(100vw-3rem)] max-w-none sm:max-w-none max-h-[90vh] overflow-y-auto p-7">
          <DialogHeader>
            <DialogTitle>{detailTarget?.emp.name} Wage Detail</DialogTitle>
          </DialogHeader>
          {detailTarget && (
            <div className="space-y-5">
              <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border bg-slate-50 p-4">
                    <div className="text-xs text-muted-foreground">Hours</div>
                    <div className="mt-1 text-2xl font-semibold">{detailTarget.hours.toFixed(2)} hrs</div>
                  </div>
                  <div className="rounded-xl border bg-emerald-50 p-4">
                    <div className="text-xs text-muted-foreground">Tips</div>
                    <div className="mt-1 text-2xl font-semibold text-emerald-700">{formatCurrency(detailTarget.tips)}</div>
                  </div>
                  {view === 'earnings' && (
                    <div className="rounded-xl border bg-sky-50 p-4">
                      <div className="text-xs text-muted-foreground">Base Wages</div>
                      <div className="mt-1 text-2xl font-semibold">{formatCurrency(detailTarget.baseWages)}</div>
                    </div>
                  )}
                  {view === 'earnings' && (
                    <div className="rounded-xl border bg-violet-50 p-4">
                      <div className="text-xs text-muted-foreground">Total Earnings</div>
                      <div className="mt-1 text-2xl font-semibold">{formatCurrency(detailTarget.totalEarnings)}</div>
                    </div>
                  )}
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Comp Summary</div>
                  <p className="mt-3 text-sm leading-6 text-slate-700">
                    {detailTarget.emp.name} worked {detailTarget.hours.toFixed(2)} total hours during this report window and received {formatCurrency(detailTarget.tips)} in tips.
                    {view === 'earnings' ? ` Base wages were ${formatCurrency(detailTarget.baseWages)} with ${formatCurrency(detailTarget.guaranteeTopUp)} in guaranteed top-up.` : ''}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => exportReportToPdf(`${detailTarget.emp.name} Wage Report`, buildWageReportHtml(detailTarget))}>
                  PDF Export
                </Button>
                <Button onClick={() => void handleEmailReport(detailTarget.emp.id)} disabled={emailingEmployeeId === detailTarget.emp.id}>
                  {emailingEmployeeId === detailTarget.emp.id ? 'Sending…' : 'Email Report'}
                </Button>
              </div>
              <div className="rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Tips</TableHead>
                      {view === 'earnings' && (
                        <>
                          <TableHead className="text-right">Base Wages</TableHead>
                          <TableHead className="text-right">Top-Up</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailRows.map(detail => (
                      <TableRow key={detail.date}>
                        <TableCell>{detail.date}</TableCell>
                        <TableCell className="text-right">{detail.hours.toFixed(2)}h</TableCell>
                        <TableCell className="text-right">{formatCurrency(detail.tips)}</TableCell>
                        {view === 'earnings' && (
                          <>
                            <TableCell className="text-right">{formatCurrency(detail.baseWages)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(detail.guaranteeTopUp)}</TableCell>
                            <TableCell className="text-right font-semibold">{formatCurrency(detail.totalEarnings)}</TableCell>
                          </>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
