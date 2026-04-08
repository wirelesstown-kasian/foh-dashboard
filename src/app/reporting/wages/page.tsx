'use client'

import { useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { DepartmentTabs } from '@/components/reporting/DepartmentTabs'
import { ReportingToolbar } from '@/components/reporting/ReportingToolbar'
import { notifyReportingDataChanged, useClockRecords, useEmployees, useEodReports } from '@/components/reporting/useReportingData'
import { useAppSettings } from '@/components/useAppSettings'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { ReportDepartment, ReportPeriod, formatCurrency, getReportRange, isEmployeeInDepartment } from '@/lib/reporting'
import { getEffectiveClockHours, isClockPending } from '@/lib/clockUtils'
import { getRoleLabel } from '@/lib/organization'

type TipReportView = 'earnings' | 'tips'

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

  const displayedRows = useMemo(
    () => (employeeFilter === 'all' ? rows : rows.filter(row => row.emp.id === employeeFilter)),
    [employeeFilter, rows]
  )

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
                <TableCell className="font-medium">{row.emp.name}</TableCell>
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
    </div>
  )
}
