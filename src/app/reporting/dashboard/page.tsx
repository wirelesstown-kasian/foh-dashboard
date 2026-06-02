'use client'

import { useEffect, useMemo, useState } from 'react'
import { addDays, endOfMonth, endOfWeek, endOfYear, format, startOfMonth, startOfWeek, startOfYear, subMonths, subWeeks, subYears, addMonths, addWeeks, addYears } from 'date-fns'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { useClockRecords, useEmployees, useEodReports } from '@/components/reporting/useReportingData'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { CashBalanceEntry, EodReport } from '@/lib/types'
import { getEffectiveClockHours } from '@/lib/clockUtils'
import { ArrowDownRight, ArrowUpRight, Banknote, CalendarDays, CreditCard, DollarSign, ReceiptText, Truck, Wallet } from 'lucide-react'

type DashboardPeriod = 'weekly' | 'monthly' | 'yearly' | 'custom'

type MetricKey = 'net' | 'tips' | 'wages' | 'tax' | 'cashFlow' | 'cash' | 'card' | 'delivery'

type MetricTotals = Record<MetricKey, number>

type SeriesPoint = {
  label: string
  date: string
  value: number
  closed?: boolean
}

const CLOSED_DAYS_STORAGE_KEY = 'foh-dashboard-reporting-closed-days'
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatPercent(value: number | null) {
  if (value === null) return 'No prior data'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(1)}%`
}

function toDate(date: string) {
  return new Date(`${date}T12:00:00`)
}

function toDateKey(date: Date) {
  return format(date, 'yyyy-MM-dd')
}

function getDashboardRange(period: DashboardPeriod, refDate: Date, customStart: string, customEnd: string): [string, string] {
  if (period === 'custom' && customStart && customEnd) {
    return customStart <= customEnd ? [customStart, customEnd] : [customEnd, customStart]
  }

  if (period === 'weekly') {
    return [
      toDateKey(startOfWeek(refDate, { weekStartsOn: 1 })),
      toDateKey(endOfWeek(refDate, { weekStartsOn: 1 })),
    ]
  }

  if (period === 'yearly') {
    return [toDateKey(startOfYear(refDate)), toDateKey(endOfYear(refDate))]
  }

  return [toDateKey(startOfMonth(refDate)), toDateKey(endOfMonth(refDate))]
}

function getDashboardLabel(period: DashboardPeriod, refDate: Date, startDate: string, endDate: string) {
  if (period === 'custom') {
    return startDate === endDate
      ? format(toDate(startDate), 'MMM d, yyyy')
      : `${format(toDate(startDate), 'MMM d, yyyy')} - ${format(toDate(endDate), 'MMM d, yyyy')}`
  }
  if (period === 'weekly') return `Week of ${format(toDate(startDate), 'MMM d, yyyy')}`
  if (period === 'yearly') return format(refDate, 'yyyy')
  return format(refDate, 'MMMM yyyy')
}

function shiftDashboardDate(period: DashboardPeriod, refDate: Date, direction: 'prev' | 'next') {
  if (period === 'custom') return refDate
  if (period === 'weekly') return direction === 'prev' ? subWeeks(refDate, 1) : addWeeks(refDate, 1)
  if (period === 'yearly') return direction === 'prev' ? subYears(refDate, 1) : addYears(refDate, 1)
  return direction === 'prev' ? subMonths(refDate, 1) : addMonths(refDate, 1)
}

function getDatesBetween(startDate: string, endDate: string) {
  const dates: string[] = []
  for (let cursor = toDate(startDate); toDateKey(cursor) <= endDate; cursor = addDays(cursor, 1)) {
    dates.push(toDateKey(cursor))
  }
  return dates
}

function getPreviousRange(startDate: string, endDate: string): [string, string] {
  const days = getDatesBetween(startDate, endDate).length
  const previousEnd = addDays(toDate(startDate), -1)
  const previousStart = addDays(previousEnd, -(days - 1))
  return [toDateKey(previousStart), toDateKey(previousEnd)]
}

function getNetRevenue(report: EodReport) {
  return Number(report.revenue_total ?? 0) - Number(report.sales_tax ?? 0) - Number(report.tip_total ?? 0)
}

function getCardRevenue(report: EodReport) {
  return Math.max(0, Number(report.batch_total ?? 0) - Number(report.delivery_order_amount ?? 0))
}

function sumReports(reports: EodReport[], cashEntries: CashBalanceEntry[], wageSpend: number): MetricTotals {
  const base = reports.reduce<MetricTotals>((sum, report) => ({
    net: sum.net + getNetRevenue(report),
    tips: sum.tips + Number(report.tip_total ?? 0),
    wages: sum.wages,
    tax: sum.tax + Number(report.sales_tax ?? 0),
    cashFlow: sum.cashFlow,
    cash: sum.cash + Number(report.cash_total ?? 0),
    card: sum.card + getCardRevenue(report),
    delivery: sum.delivery + Number(report.delivery_order_amount ?? 0),
  }), {
    net: 0,
    tips: 0,
    wages: 0,
    tax: 0,
    cashFlow: 0,
    cash: 0,
    card: 0,
    delivery: 0,
  })

  const cashFlow = cashEntries.reduce((sum, entry) => (
    sum + (entry.entry_type === 'cash_in' ? Number(entry.amount ?? 0) : Number(entry.amount ?? 0) * -1)
  ), 0)

  return { ...base, wages: wageSpend, cashFlow }
}

function getMetricChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / Math.abs(previous)) * 100
}

function loadClosedDays() {
  if (typeof window === 'undefined') return [1]
  try {
    const stored = window.localStorage.getItem(CLOSED_DAYS_STORAGE_KEY)
    if (!stored) return [1]
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed)
      ? parsed.filter((value): value is number => Number.isInteger(value) && value >= 0 && value <= 6)
      : [1]
  } catch {
    return [1]
  }
}

function getBucketKey(date: string, period: DashboardPeriod, rangeLength: number) {
  const parsedDate = toDate(date)
  if (period === 'yearly' || rangeLength > 90) return format(parsedDate, 'yyyy-MM')
  if (rangeLength > 21) return toDateKey(startOfWeek(parsedDate, { weekStartsOn: 1 }))
  return date
}

function getBucketLabel(bucketKey: string, period: DashboardPeriod, rangeLength: number) {
  if (period === 'yearly' || rangeLength > 90) return format(toDate(`${bucketKey}-01`), 'MMM')
  if (rangeLength > 21) return format(toDate(bucketKey), 'MMM d')
  return format(toDate(bucketKey), 'EEE d')
}

function buildSeries(
  dates: string[],
  reportsByDate: Map<string, EodReport>,
  closedDays: number[],
  period: DashboardPeriod,
  valueGetter: (report: EodReport) => number
) {
  const rangeLength = dates.length
  const bucketMap = new Map<string, SeriesPoint>()

  for (const date of dates) {
    const bucketKey = getBucketKey(date, period, rangeLength)
    const current = bucketMap.get(bucketKey) ?? {
      label: getBucketLabel(bucketKey, period, rangeLength),
      date: bucketKey,
      value: 0,
      closed: true,
    }
    const report = reportsByDate.get(date)
    current.value += report ? valueGetter(report) : 0
    current.closed = current.closed && closedDays.includes(toDate(date).getDay())
    bucketMap.set(bucketKey, current)
  }

  return [...bucketMap.values()]
}

function Sparkline({ points, color = '#2563eb' }: { points: SeriesPoint[]; color?: string }) {
  const values = points.map(point => point.value)
  const max = Math.max(...values, 1)
  const svgWidth = 220
  const svgHeight = 76
  const padLeft = 36
  const padRight = 4
  const padTop = 4
  const padBottom = 14
  const innerWidth = svgWidth - padLeft - padRight
  const innerHeight = svgHeight - padTop - padBottom

  const toX = (index: number) => padLeft + (values.length <= 1 ? innerWidth / 2 : (index / (values.length - 1)) * innerWidth)
  const toY = (value: number) => padTop + innerHeight - (value / max) * innerHeight
  const coords = values.map((value, index) => `${toX(index).toFixed(1)},${toY(value).toFixed(1)}`)
  const fmtY = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `$${Math.round(v)}`

  return (
    <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="h-20 w-full overflow-visible" aria-hidden="true">
      {([0, 0.5, 1] as const).map((tick, i) => {
        const y = padTop + innerHeight * tick
        return (
          <g key={i}>
            <line x1={padLeft} x2={svgWidth - padRight} y1={y} y2={y} stroke="#f1f5f9" strokeWidth="1" />
            <text x={padLeft - 3} y={y + 3.5} textAnchor="end" fontSize="9" fill="#94a3b8">{fmtY(max * (1 - tick))}</text>
          </g>
        )
      })}
      <polyline points={coords.join(' ')} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {points.length > 0 && (
        <>
          <text x={toX(0)} y={svgHeight} textAnchor="start" fontSize="9" fill="#94a3b8">{points[0].label}</text>
          {points.length > 1 && (
            <text x={toX(points.length - 1)} y={svgHeight} textAnchor="end" fontSize="9" fill="#94a3b8">{points[points.length - 1].label}</text>
          )}
        </>
      )}
    </svg>
  )
}

function MainTrendChart({ points, dailyAverage }: { points: SeriesPoint[]; dailyAverage: number }) {
  const values = points.map(point => point.value)
  const max = Math.max(...values, dailyAverage, 1)
  const width = 720
  const height = 260
  const padLeft = 54
  const padRight = 12
  const padY = 24
  const innerWidth = width - padLeft - padRight
  const innerHeight = height - padY * 2
  const coords = values.map((value, index) => {
    const x = padLeft + (values.length <= 1 ? 0 : (index / (values.length - 1)) * innerWidth)
    const y = padY + innerHeight - (value / max) * innerHeight
    return { x, y }
  })
  const path = coords.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
  const areaPath = coords.length > 0
    ? `${path} L ${coords[coords.length - 1].x.toFixed(1)} ${height - padY} L ${coords[0].x.toFixed(1)} ${height - padY} Z`
    : ''
  const avgY = padY + innerHeight - (dailyAverage / max) * innerHeight
  const fmtK = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`

  return (
    <div className="rounded-xl border bg-white p-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-72 w-full" role="img" aria-label="Daily net revenue chart">
        <defs>
          <linearGradient id="netTrendFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map(tick => {
          const y = padY + innerHeight * tick
          return (
            <g key={tick}>
              <line x1={padLeft} x2={width - padRight} y1={y} y2={y} stroke="#e5e7eb" strokeWidth="1" />
              <text x={padLeft - 6} y={y + 4} textAnchor="end" fontSize="11" fill="#94a3b8">{fmtK(max * (1 - tick))}</text>
            </g>
          )
        })}
        {areaPath && <path d={areaPath} fill="url(#netTrendFill)" />}
        {path && <path d={path} fill="none" stroke="#2563eb" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />}
        <line x1={padLeft} x2={width - padRight} y1={avgY} y2={avgY} stroke="#f59e0b" strokeDasharray="8 8" strokeWidth="3" />
        {coords.map((point, index) => (
          <circle key={`${points[index]?.date}-${index}`} cx={point.x} cy={point.y} r="4" fill="#2563eb" />
        ))}
        {points.map((point, index) => {
          if (points.length > 14 && index % Math.ceil(points.length / 8) !== 0) return null
          const x = padLeft + (points.length <= 1 ? 0 : (index / (points.length - 1)) * innerWidth)
          return (
            <text key={point.date} x={x} y={height - 4} textAnchor="middle" fontSize="11" fill="#64748b">
              {point.label}
            </text>
          )
        })}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2"><span className="h-2 w-8 rounded-full bg-blue-600" />Daily net revenue</span>
        <span className="inline-flex items-center gap-2"><span className="h-0.5 w-8 border-t-2 border-dashed border-amber-500" />Daily average</span>
      </div>
    </div>
  )
}

function MetricCard({
  label,
  value,
  change,
  points,
  color,
  icon: Icon,
}: {
  label: string
  value: number
  change: number | null
  points: SeriesPoint[]
  color: string
  icon: React.ComponentType<{ className?: string }>
}) {
  const isPositive = change !== null && change > 0
  const isNegative = change !== null && change < 0

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{formatCurrency(value)}</p>
        </div>
        <div className="rounded-lg bg-slate-100 p-2">
          <Icon className="h-4 w-4 text-slate-700" />
        </div>
      </div>
      <div className="mt-3">
        <Sparkline points={points} color={color} />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">vs previous range</span>
        <span className={`inline-flex items-center gap-1 font-medium ${isPositive ? 'text-emerald-700' : isNegative ? 'text-red-700' : 'text-muted-foreground'}`}>
          {isPositive && <ArrowUpRight className="h-3.5 w-3.5" />}
          {isNegative && <ArrowDownRight className="h-3.5 w-3.5" />}
          {formatPercent(change)}
        </span>
      </div>
    </div>
  )
}

function MixBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const percent = total > 0 ? Math.max(3, (value / total) * 100) : 0

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium text-slate-800">{label}</span>
        <span className="text-muted-foreground">{formatCurrency(value)}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

export default function ReportingDashboardPage() {
  const { eodReports } = useEodReports()
  const { clockRecords } = useClockRecords()
  const employees = useEmployees()
  const [period, setPeriod] = useState<DashboardPeriod>('monthly')
  const [refDate, setRefDate] = useState(new Date())
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [closedDays, setClosedDays] = useState<number[]>(loadClosedDays)
  const [cashEntries, setCashEntries] = useState<CashBalanceEntry[]>([])

  const [startDate, endDate] = useMemo(
    () => getDashboardRange(period, refDate, customStart, customEnd),
    [customEnd, customStart, period, refDate]
  )
  const [previousStartDate, previousEndDate] = useMemo(
    () => getPreviousRange(startDate, endDate),
    [endDate, startDate]
  )
  const dateLabel = useMemo(
    () => getDashboardLabel(period, refDate, startDate, endDate),
    [endDate, period, refDate, startDate]
  )

  useEffect(() => {
    window.localStorage.setItem(CLOSED_DAYS_STORAGE_KEY, JSON.stringify(closedDays))
  }, [closedDays])

  useEffect(() => {
    let mounted = true
    void (async () => {
      const res = await supabase
        .from('cash_balance_entries')
        .select('*')
        .gte('entry_date', previousStartDate)
        .lte('entry_date', endDate)
        .order('entry_date', { ascending: true })
      if (!mounted) return
      setCashEntries((res.data ?? []) as CashBalanceEntry[])
    })()
    return () => {
      mounted = false
    }
  }, [endDate, previousStartDate])

  const employeeById = useMemo(() => new Map(employees.map(employee => [employee.id, employee])), [employees])
  const currentReports = useMemo(
    () => eodReports.filter(report => report.session_date >= startDate && report.session_date <= endDate),
    [eodReports, endDate, startDate]
  )
  const previousReports = useMemo(
    () => eodReports.filter(report => report.session_date >= previousStartDate && report.session_date <= previousEndDate),
    [eodReports, previousEndDate, previousStartDate]
  )
  const currentCashEntries = useMemo(
    () => cashEntries.filter(entry => entry.entry_date >= startDate && entry.entry_date <= endDate),
    [cashEntries, endDate, startDate]
  )
  const previousCashEntries = useMemo(
    () => cashEntries.filter(entry => entry.entry_date >= previousStartDate && entry.entry_date <= previousEndDate),
    [cashEntries, previousEndDate, previousStartDate]
  )

  const currentWageSpend = useMemo(() => (
    clockRecords
      .filter(record => record.session_date >= startDate && record.session_date <= endDate)
      .reduce((sum, record) => {
        const employee = employeeById.get(record.employee_id)
        return sum + getEffectiveClockHours(record) * Number(employee?.hourly_wage ?? 0)
      }, 0)
  ), [clockRecords, employeeById, endDate, startDate])

  const previousWageSpend = useMemo(() => (
    clockRecords
      .filter(record => record.session_date >= previousStartDate && record.session_date <= previousEndDate)
      .reduce((sum, record) => {
        const employee = employeeById.get(record.employee_id)
        return sum + getEffectiveClockHours(record) * Number(employee?.hourly_wage ?? 0)
      }, 0)
  ), [clockRecords, employeeById, previousEndDate, previousStartDate])

  const currentTotals = useMemo(
    () => sumReports(currentReports, currentCashEntries, currentWageSpend),
    [currentCashEntries, currentReports, currentWageSpend]
  )
  const previousTotals = useMemo(
    () => sumReports(previousReports, previousCashEntries, previousWageSpend),
    [previousCashEntries, previousReports, previousWageSpend]
  )
  const reportsByDate = useMemo(
    () => new Map(currentReports.map(report => [report.session_date, report])),
    [currentReports]
  )
  const currentDates = useMemo(() => getDatesBetween(startDate, endDate), [endDate, startDate])
  const todayKey = toDateKey(new Date())
  const openDates = useMemo(
    () => currentDates.filter(date => !closedDays.includes(toDate(date).getDay())),
    [closedDays, currentDates]
  )
  const reportedOpenDates = useMemo(
    () => openDates.filter(date => reportsByDate.has(date) && date <= todayKey),
    [openDates, reportsByDate, todayKey]
  )
  const shouldProject = startDate <= todayKey && todayKey <= endDate && reportedOpenDates.length > 0
  const reportedNetRevenue = reportedOpenDates.reduce((sum, date) => sum + getNetRevenue(reportsByDate.get(date)!), 0)
  const dailyAverage = reportedOpenDates.length > 0 ? reportedNetRevenue / reportedOpenDates.length : 0
  const projectedNetRevenue = shouldProject ? dailyAverage * openDates.length : currentTotals.net
  const projectionLift = projectedNetRevenue - currentTotals.net

  const netSeries = useMemo(
    () => buildSeries(currentDates, reportsByDate, closedDays, period, getNetRevenue),
    [closedDays, currentDates, period, reportsByDate]
  )
  const tipsSeries = useMemo(
    () => buildSeries(currentDates, reportsByDate, closedDays, period, report => Number(report.tip_total ?? 0)),
    [closedDays, currentDates, period, reportsByDate]
  )
  const taxSeries = useMemo(
    () => buildSeries(currentDates, reportsByDate, closedDays, period, report => Number(report.sales_tax ?? 0)),
    [closedDays, currentDates, period, reportsByDate]
  )
  const cashSeries = useMemo(
    () => buildSeries(currentDates, reportsByDate, closedDays, period, report => Number(report.cash_total ?? 0)),
    [closedDays, currentDates, period, reportsByDate]
  )
  const cardSeries = useMemo(
    () => buildSeries(currentDates, reportsByDate, closedDays, period, getCardRevenue),
    [closedDays, currentDates, period, reportsByDate]
  )
  const deliverySeries = useMemo(
    () => buildSeries(currentDates, reportsByDate, closedDays, period, report => Number(report.delivery_order_amount ?? 0)),
    [closedDays, currentDates, period, reportsByDate]
  )
  const wagesSeries = useMemo(() => {
    const rangeLength = currentDates.length
    const bucketMap = new Map<string, SeriesPoint>()
    for (const date of currentDates) {
      const bucketKey = getBucketKey(date, period, rangeLength)
      const current = bucketMap.get(bucketKey) ?? {
        label: getBucketLabel(bucketKey, period, rangeLength),
        date: bucketKey,
        value: 0,
        closed: true,
      }
      const daySpend = clockRecords
        .filter(record => record.session_date === date)
        .reduce((sum, record) => {
          const employee = employeeById.get(record.employee_id)
          return sum + getEffectiveClockHours(record) * Number(employee?.hourly_wage ?? 0)
        }, 0)
      current.value += daySpend
      current.closed = current.closed && closedDays.includes(toDate(date).getDay())
      bucketMap.set(bucketKey, current)
    }
    return [...bucketMap.values()]
  }, [clockRecords, closedDays, currentDates, employeeById, period])
  const cashFlowSeries = useMemo(() => {
    const rangeLength = currentDates.length
    const bucketMap = new Map<string, SeriesPoint>()
    for (const date of currentDates) {
      const bucketKey = getBucketKey(date, period, rangeLength)
      const current = bucketMap.get(bucketKey) ?? {
        label: getBucketLabel(bucketKey, period, rangeLength),
        date: bucketKey,
        value: 0,
        closed: true,
      }
      current.value += currentCashEntries
        .filter(entry => entry.entry_date === date)
        .reduce((sum, entry) => sum + (entry.entry_type === 'cash_in' ? Number(entry.amount ?? 0) : Number(entry.amount ?? 0) * -1), 0)
      current.closed = current.closed && closedDays.includes(toDate(date).getDay())
      bucketMap.set(bucketKey, current)
    }
    return [...bucketMap.values()]
  }, [closedDays, currentCashEntries, currentDates, period])

  const metricCards = [
    { key: 'tips' as const, label: 'Tips', value: currentTotals.tips, previous: previousTotals.tips, points: tipsSeries, color: '#16a34a', icon: DollarSign },
    { key: 'wages' as const, label: 'Wages Spend', value: currentTotals.wages, previous: previousTotals.wages, points: wagesSeries, color: '#7c3aed', icon: Wallet },
    { key: 'tax' as const, label: 'Tax', value: currentTotals.tax, previous: previousTotals.tax, points: taxSeries, color: '#dc2626', icon: ReceiptText },
    { key: 'cashFlow' as const, label: 'Cash In / Out', value: currentTotals.cashFlow, previous: previousTotals.cashFlow, points: cashFlowSeries, color: '#0891b2', icon: Banknote },
    { key: 'cash' as const, label: 'Cash Sales', value: currentTotals.cash, previous: previousTotals.cash, points: cashSeries, color: '#0f766e', icon: Banknote },
    { key: 'card' as const, label: 'Credit Card', value: currentTotals.card, previous: previousTotals.card, points: cardSeries, color: '#2563eb', icon: CreditCard },
    { key: 'delivery' as const, label: 'Delivery Sales', value: currentTotals.delivery, previous: previousTotals.delivery, points: deliverySeries, color: '#f97316', icon: Truck },
  ]
  const mixTotal = currentTotals.cash + currentTotals.card + currentTotals.delivery

  return (
    <div className="p-6">
      <AdminSubpageHeader
        title="Reporting Dashboard"
        subtitle="Revenue trends, forecast pace, and operating signals."
        backHref="/reporting"
        backLabel="Back to Reporting"
      />

      <div className="mb-5 rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex h-9 overflow-hidden rounded-lg border bg-background">
            {([
              ['weekly', 'Weekly'],
              ['monthly', 'Monthly'],
              ['yearly', 'Yearly'],
              ['custom', 'Custom'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPeriod(value)}
                className={`px-3 text-sm font-medium transition-colors ${
                  period === value
                    ? 'bg-slate-950 text-white'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {period === 'custom' ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" value={customStart} onChange={event => setCustomStart(event.target.value)} className="h-9 w-40" />
              <span className="text-sm text-muted-foreground">to</span>
              <Input type="date" value={customEnd} onChange={event => setCustomEnd(event.target.value)} className="h-9 w-40" />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setRefDate(shiftDashboardDate(period, refDate, 'prev'))}>Prev</Button>
              <span className="min-w-48 text-center text-sm font-medium">{dateLabel}</span>
              <Button variant="outline" size="sm" onClick={() => setRefDate(shiftDashboardDate(period, refDate, 'next'))}>Next</Button>
            </div>
          )}

          <Button variant="outline" size="sm" onClick={() => setRefDate(new Date())}>Current</Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Label className="mr-2 text-xs uppercase text-muted-foreground">Closed days</Label>
          {DAY_LABELS.map((label, dayIndex) => {
            const active = closedDays.includes(dayIndex)
            return (
              <button
                key={label}
                type="button"
                onClick={() => setClosedDays(current => (
                  active ? current.filter(day => day !== dayIndex) : [...current, dayIndex].sort()
                ))}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'border-slate-950 bg-slate-950 text-white'
                    : 'bg-white text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <div>
          <div className="mb-4 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium uppercase text-muted-foreground">Actual Net Revenue</p>
              <p className="mt-1 text-3xl font-semibold text-slate-950">{formatCurrency(currentTotals.net)}</p>
              <p className="mt-2 text-xs text-muted-foreground">{currentReports.length} EOD reports in range</p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium uppercase text-muted-foreground">Projected Close</p>
              <p className="mt-1 text-3xl font-semibold text-blue-700">{formatCurrency(projectedNetRevenue)}</p>
              <p className="mt-2 text-xs text-muted-foreground">{formatCurrency(projectionLift)} remaining projection</p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium uppercase text-muted-foreground">Average Reported Day</p>
              <p className="mt-1 text-3xl font-semibold text-slate-950">{formatCurrency(dailyAverage)}</p>
              <p className="mt-2 text-xs text-muted-foreground">{reportedOpenDates.length} reported / {openDates.length} open days</p>
            </div>
          </div>
          <MainTrendChart points={netSeries} dailyAverage={dailyAverage} />
        </div>

        <div className="rounded-xl border bg-white p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Revenue Mix</p>
              <h2 className="text-lg font-semibold text-slate-950">{dateLabel}</h2>
            </div>
            <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
              Trend View
            </Badge>
          </div>
          <div className="space-y-5">
            <MixBar label="Cash" value={currentTotals.cash} total={mixTotal} color="#0f766e" />
            <MixBar label="Credit Card" value={currentTotals.card} total={mixTotal} color="#2563eb" />
            <MixBar label="Delivery" value={currentTotals.delivery} total={mixTotal} color="#f97316" />
          </div>
          <div className="mt-6 rounded-lg border bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
              <CalendarDays className="h-4 w-4 text-slate-600" />
              {period === 'yearly' ? 'Year pace' : period === 'monthly' ? 'Month pace' : period === 'weekly' ? 'Week pace' : 'Range pace'}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {formatCurrency(currentTotals.net)} actual net, paced toward {formatCurrency(projectedNetRevenue)} using closed-day settings.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metricCards.map(card => (
          <MetricCard
            key={card.key}
            label={card.label}
            value={card.value}
            change={getMetricChange(card.value, card.previous)}
            points={card.points}
            color={card.color}
            icon={card.icon}
          />
        ))}
      </div>
    </div>
  )
}
