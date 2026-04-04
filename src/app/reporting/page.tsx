'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Employee, TaskCompletion, EodReport, ShiftClock, TipDistribution } from '@/lib/types'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Trophy, Download, Star, Mail } from 'lucide-react'
import {
  format, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  subWeeks, addWeeks, eachDayOfInterval, subMonths, addMonths
} from 'date-fns'
import * as XLSX from 'xlsx'
import { getEffectiveClockHours, isClockPending } from '@/lib/clockUtils'

type Period = 'daily' | 'weekly' | 'monthly'
type ReportDepartment = 'foh' | 'boh'
type TipReportPeriod = 'daily' | 'weekly' | 'monthly'
type TipReportView = 'earnings' | 'tips'
type ReportTab = 'performance' | 'wages' | 'eod' | 'attendance'
type TipDetail = {
  date: string
  amount: number | null
  hours: number
  rate: number | null
  houseDeduction: number
}

type EmployeeMonthStat = {
  emp: Employee
  tasks: number
  hours: number
  totalTips: number
  taskRate: number
  tipRate: number
  taskRank: number
  taskRateRank: number
  tipRateRank: number
  hoursRank: number
  taskSharePct: number
  hourSharePct: number
  tipSharePct: number
  score: number
}

type RankingCard = {
  label: string
  rank: number
  value: string
  accentClass: string
}

type TipSummaryRow = {
  emp: Employee
  hours: number
  tips: number
  baseWages: number
  guaranteeTopUp: number
  totalEarnings: number
  tipRate: number | null
  effectiveRate: number | null
}

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`
}

function getPercent(value: number) {
  return `${value.toFixed(1)}%`
}

function getRankMap<T>(items: T[], getValue: (item: T) => number, getId: (item: T) => string) {
  const sorted = [...items].sort((a, b) => getValue(b) - getValue(a))
  return new Map(sorted.map((item, index) => [getId(item), index + 1]))
}

function scoreFromRank(rank: number, count: number) {
  if (count <= 1) return 100
  return ((count - rank) / (count - 1)) * 100
}

function formatDateRangeLabel(startDate: string, endDate: string) {
  const start = new Date(startDate + 'T12:00:00')
  const end = new Date(endDate + 'T12:00:00')
  if (startDate === endDate) return format(start, 'MMM d, yyyy')
  return `${format(start, 'MMM d, yyyy')} - ${format(end, 'MMM d, yyyy')}`
}

function isEmployeeInDepartment(employee: Employee, department: ReportDepartment) {
  return department === 'boh'
    ? employee.role === 'kitchen_staff' || employee.role === 'manager'
    : employee.role !== 'kitchen_staff'
}

export default function ReportingPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [completions, setCompletions] = useState<TaskCompletion[]>([])
  const [eodReports, setEodReports] = useState<(EodReport & { tip_distributions: (TipDistribution & { employee: Employee })[] })[]>([])
  const [clockRecords, setClockRecords] = useState<ShiftClock[]>([])
  const [period, setPeriod] = useState<Period>('weekly')
  const [department, setDepartment] = useState<ReportDepartment>('foh')
  const [refDate, setRefDate] = useState(new Date())
  const [tipReportPeriod, setTipReportPeriod] = useState<TipReportPeriod>('weekly')
  const [tipReportView, setTipReportView] = useState<TipReportView>('earnings')
  const [reportTab, setReportTab] = useState<ReportTab>('performance')
  const [tipEmployeeFilter, setTipEmployeeFilter] = useState<string>('all')
  const [eodHistoryPeriod, setEodHistoryPeriod] = useState<Period>('weekly')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [sendingReportEmail, setSendingReportEmail] = useState(false)
  const [reportEmailStatus, setReportEmailStatus] = useState<string | null>(null)
  const [attendancePeriod, setAttendancePeriod] = useState<Period>('daily')
  const [attendanceEdits, setAttendanceEdits] = useState<Record<string, { hours: string; note: string }>>({})
  const [savingAttendanceId, setSavingAttendanceId] = useState<string | null>(null)
  const [attendanceStatus, setAttendanceStatus] = useState<string | null>(null)
  const employeeReportRef = useRef<HTMLDivElement | null>(null)
  const isCompletedTask = (completion: TaskCompletion) => completion.status !== 'incomplete'

  useEffect(() => {
    let mounted = true

    void (async () => {
      const [empRes, compRes, eodRes] = await Promise.all([
        supabase.from('employees').select('*').eq('is_active', true).order('name'),
        supabase.from('task_completions').select('*'),
        supabase.from('eod_reports').select('*, tip_distributions(*, employee:employees(*))').order('session_date', { ascending: false }),
      ])
      const clockRes = await fetch('/api/clock-events', { cache: 'no-store' })
      const clockJson = (await clockRes.json().catch(() => ({}))) as { records?: ShiftClock[] }

      if (!mounted) return

      setEmployees(empRes.data ?? [])
      setCompletions(compRes.data ?? [])
      setEodReports(eodRes.data ?? [])
      setClockRecords(clockJson.records ?? [])
    })()

    return () => {
      mounted = false
    }
  }, [])

  const getRange = (): [string, string] => {
    if (period === 'daily') {
      const d = format(refDate, 'yyyy-MM-dd')
      return [d, d]
    }
    if (period === 'weekly') {
      return [
        format(startOfWeek(refDate, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
        format(endOfWeek(refDate, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      ]
    }
    return [
      format(startOfMonth(refDate), 'yyyy-MM-dd'),
      format(endOfMonth(refDate), 'yyyy-MM-dd'),
    ]
  }

  const [startDate, endDate] = getRange()
  const filteredEmployees = employees.filter(employee => isEmployeeInDepartment(employee, department))
  const filteredEmployeeIds = new Set(filteredEmployees.map(employee => employee.id))
  const filteredCompletions = completions.filter(
    completion =>
      completion.session_date >= startDate &&
      completion.session_date <= endDate &&
      filteredEmployeeIds.has(completion.employee_id) &&
      isCompletedTask(completion)
  )

  const perfStats = filteredEmployees.map(emp => {
    const done = filteredCompletions.filter(c => c.employee_id === emp.id).length
    const allTime = completions.filter(c => c.employee_id === emp.id).length
    return { emp, done, allTime }
  }).sort((a, b) => b.done - a.done)

  const monthStart = format(startOfMonth(refDate), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(refDate), 'yyyy-MM-dd')
  const monthCompletions = completions.filter(c => c.session_date >= monthStart && c.session_date <= monthEnd && isCompletedTask(c))
  const monthEods = eodReports.filter(r => r.session_date >= monthStart && r.session_date <= monthEnd)

  const monthHoursByEmp = new Map<string, number>()
  const monthTipsByEmp = new Map<string, number>()
  for (const eod of monthEods) {
    for (const dist of (eod.tip_distributions ?? [])) {
      if (!filteredEmployeeIds.has(dist.employee_id)) continue
      monthHoursByEmp.set(dist.employee_id, (monthHoursByEmp.get(dist.employee_id) ?? 0) + Number(dist.hours_worked))
      monthTipsByEmp.set(dist.employee_id, (monthTipsByEmp.get(dist.employee_id) ?? 0) + Number(dist.net_tip))
    }
  }

  const baseMonthlyStats = filteredEmployees.map(emp => {
    const tasks = monthCompletions.filter(c => c.employee_id === emp.id).length
    const hours = monthHoursByEmp.get(emp.id) ?? 0
    const totalTips = monthTipsByEmp.get(emp.id) ?? 0
    return {
      emp,
      tasks,
      hours,
      totalTips,
      taskRate: hours > 0 ? tasks / hours : 0,
      tipRate: hours > 0 ? totalTips / hours : 0,
    }
  }).filter(stat => stat.tasks > 0 || stat.hours > 0 || stat.totalTips > 0)

  const taskRankMap = getRankMap(baseMonthlyStats, item => item.tasks, item => item.emp.id)
  const taskRateRankMap = getRankMap(baseMonthlyStats.filter(item => item.hours > 0), item => item.taskRate, item => item.emp.id)
  const tipRateRankMap = getRankMap(baseMonthlyStats.filter(item => item.hours > 0), item => item.tipRate, item => item.emp.id)
  const hoursRankMap = getRankMap(baseMonthlyStats, item => item.hours, item => item.emp.id)
  const monthlyTaskTotal = baseMonthlyStats.reduce((sum, item) => sum + item.tasks, 0)
  const monthlyHourTotal = baseMonthlyStats.reduce((sum, item) => sum + item.hours, 0)
  const monthlyTipTotal = baseMonthlyStats.reduce((sum, item) => sum + item.totalTips, 0)

  const employeeMonthStats: EmployeeMonthStat[] = baseMonthlyStats.map(item => {
    const taskRank = taskRankMap.get(item.emp.id) ?? 1
    const taskRateRank = taskRateRankMap.get(item.emp.id) ?? taskRateRankMap.size + 1
    const tipRateRank = tipRateRankMap.get(item.emp.id) ?? tipRateRankMap.size + 1
    const hoursRank = hoursRankMap.get(item.emp.id) ?? 1
    const score = Math.round(
      scoreFromRank(taskRank, Math.max(taskRankMap.size, 1)) * 0.3 +
      scoreFromRank(taskRateRank, Math.max(taskRateRankMap.size, 1)) * 0.3 +
      scoreFromRank(tipRateRank, Math.max(tipRateRankMap.size, 1)) * 0.25 +
      scoreFromRank(hoursRank, Math.max(hoursRankMap.size, 1)) * 0.15
    )
    return {
      ...item,
      taskRank,
      taskRateRank,
      tipRateRank,
      hoursRank,
      taskSharePct: monthlyTaskTotal > 0 ? (item.tasks / monthlyTaskTotal) * 100 : 0,
      hourSharePct: monthlyHourTotal > 0 ? (item.hours / monthlyHourTotal) * 100 : 0,
      tipSharePct: monthlyTipTotal > 0 ? (item.totalTips / monthlyTipTotal) * 100 : 0,
      score,
    }
  })

  const monthlyRankings = period === 'monthly' ? employeeMonthStats : null
  const performanceLeader = perfStats[0] ?? null
  const performanceTotalTasks = perfStats.reduce((sum, item) => sum + item.done, 0)
  const activePerformanceCount = perfStats.filter(item => item.done > 0).length

  const tipWeekStart = format(startOfWeek(refDate, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const tipWeekEnd = format(endOfWeek(refDate, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const weekDays = eachDayOfInterval({
    start: startOfWeek(refDate, { weekStartsOn: 1 }),
    end: endOfWeek(refDate, { weekStartsOn: 1 }),
  })
  const weeklyEodReports = eodReports.filter(r => r.session_date >= tipWeekStart && r.session_date <= tipWeekEnd)
  const getClockHoursForEmployeeDate = (employeeId: string, date: string, fallbackHours: number) => {
    const records = clockRecords.filter(record => record.employee_id === employeeId && record.session_date === date)
    if (records.length === 0) return fallbackHours
    return records.reduce((sum, record) => sum + getEffectiveClockHours(record), 0)
  }

  const tipByEmployee = filteredEmployees.map(emp => {
    const daily: TipDetail[] = weekDays.map(day => {
      const dateStr = format(day, 'yyyy-MM-dd')
      const report = weeklyEodReports.find(r => r.session_date === dateStr)
      const dist = report?.tip_distributions.find(d => d.employee_id === emp.id)
      const amount = dist?.net_tip !== undefined ? Number(dist.net_tip) : null
      const fallbackHours = dist ? Number(dist.hours_worked) : 0
      const hours = getClockHoursForEmployeeDate(emp.id, dateStr, fallbackHours)
      return {
        date: dateStr,
        amount,
        hours,
        rate: amount !== null && hours > 0 ? amount / hours : null,
        houseDeduction: dist ? Number(dist.house_deduction) : 0,
      }
    })
    const total = daily.reduce((s, d) => s + (d.amount ?? 0), 0)
    const totalHours = daily.reduce((s, d) => s + d.hours, 0)
    const totalHouse = daily.reduce((s, d) => s + d.houseDeduction, 0)
    const totalRate = totalHours > 0 ? total / totalHours : null
    return { emp, daily, total, totalHours, totalHouse, totalRate }
  }).filter(x => x.total > 0)

  const [tipRangeStart, tipRangeEnd] = tipReportPeriod === 'weekly'
    ? [tipWeekStart, tipWeekEnd]
    : tipReportPeriod === 'monthly'
      ? [monthStart, monthEnd]
      : [format(refDate, 'yyyy-MM-dd'), format(refDate, 'yyyy-MM-dd')]
  const tipRangeReports = eodReports.filter(r => r.session_date >= tipRangeStart && r.session_date <= tipRangeEnd)
  const tipSummaryRows: TipSummaryRow[] = filteredEmployees.map(emp => {
    let hours = 0
    let tips = 0
    let baseWages = 0
    let guaranteeTopUp = 0

    for (const report of tipRangeReports) {
      const distributions = (report.tip_distributions ?? []).filter(dist => dist.employee_id === emp.id)
      const dailyTips = distributions.reduce((sum, dist) => sum + Number(dist.net_tip), 0)
      const fallbackHours = distributions.reduce((sum, dist) => sum + Number(dist.hours_worked), 0)
      const dailyHours = getClockHoursForEmployeeDate(emp.id, report.session_date, fallbackHours)
      const dailyBaseWages = dailyHours * (emp.hourly_wage ?? 0)
      const dailyGuaranteedTarget = dailyHours * (emp.guaranteed_hourly ?? 0)

      hours += dailyHours
      tips += dailyTips
      baseWages += dailyBaseWages
      guaranteeTopUp += Math.max(0, dailyGuaranteedTarget - (dailyBaseWages + dailyTips))
    }

    const totalEarnings = baseWages + tips + guaranteeTopUp

    return {
      emp,
      hours,
      tips,
      baseWages,
      guaranteeTopUp,
      totalEarnings,
      tipRate: hours > 0 ? tips / hours : null,
      effectiveRate: hours > 0 ? totalEarnings / hours : null,
    }
  }).filter(row => row.hours > 0 || row.tips > 0 || row.baseWages > 0)
    .sort((a, b) => b.totalEarnings - a.totalEarnings)
  const displayedTipSummaryRows = tipEmployeeFilter === 'all'
    ? tipSummaryRows
    : tipSummaryRows.filter(row => row.emp.id === tipEmployeeFilter)

  const selectedEmployeeStats = employeeMonthStats.find(item => item.emp.id === selectedEmployeeId) ?? null
  const selectedWeekTips = tipByEmployee.find(item => item.emp.id === selectedEmployeeId) ?? null
  const selectedPeriodTasks = perfStats.find(item => item.emp.id === selectedEmployeeId) ?? null
  const selectedTipSummary = tipSummaryRows.find(item => item.emp.id === selectedEmployeeId) ?? null
  const showEarningsReport = reportTab === 'wages' && !!selectedTipSummary
  const getHistoryRange = (): [string, string] => {
    if (eodHistoryPeriod === 'daily') {
      const d = format(refDate, 'yyyy-MM-dd')
      return [d, d]
    }
    if (eodHistoryPeriod === 'weekly') {
      return [tipWeekStart, tipWeekEnd]
    }
    return [monthStart, monthEnd]
  }
  const [historyStart, historyEnd] = getHistoryRange()
  const filteredEodReports = eodReports.filter(report => report.session_date >= historyStart && report.session_date <= historyEnd)
  const getAttendanceRange = (): [string, string] => {
    if (attendancePeriod === 'daily') {
      const d = format(refDate, 'yyyy-MM-dd')
      return [d, d]
    }
    if (attendancePeriod === 'weekly') {
      return [tipWeekStart, tipWeekEnd]
    }
    return [monthStart, monthEnd]
  }
  const [attendanceStart, attendanceEnd] = getAttendanceRange()
  const filteredAttendanceRecords = clockRecords
    .filter(record => record.session_date >= attendanceStart && record.session_date <= attendanceEnd)
    .filter(record => {
      const employee = record.employee ?? employees.find(item => item.id === record.employee_id)
      return employee ? isEmployeeInDepartment(employee, department) : false
    })
    .sort((a, b) => b.clock_in_at.localeCompare(a.clock_in_at))
  const rankingCards: RankingCard[] = selectedEmployeeStats ? [
    {
      label: 'Task Rank',
      rank: selectedEmployeeStats.taskRank,
      value: `${selectedEmployeeStats.tasks} tasks`,
      accentClass: 'border-amber-300 bg-amber-50 text-amber-900',
    },
    {
      label: 'Task Pace',
      rank: selectedEmployeeStats.taskRateRank,
      value: `${selectedEmployeeStats.taskRate.toFixed(2)} tasks/hr`,
      accentClass: 'border-violet-300 bg-violet-50 text-violet-900',
    },
    {
      label: 'Tip Pace',
      rank: selectedEmployeeStats.tipRateRank,
      value: `${formatCurrency(selectedEmployeeStats.tipRate)}/hr`,
      accentClass: 'border-green-300 bg-green-50 text-green-900',
    },
    {
      label: 'Hours Rank',
      rank: selectedEmployeeStats.hoursRank,
      value: `${selectedEmployeeStats.hours.toFixed(1)}h`,
      accentClass: 'border-sky-300 bg-sky-50 text-sky-900',
    },
  ] : []

  const exportTips = () => {
    const rows = displayedTipSummaryRows.map(row => ({
      Name: row.emp.name,
      Role: row.emp.role,
      Hours: row.hours.toFixed(2),
      Tips: formatCurrency(row.tips),
      'Tip / Hr': row.tipRate !== null ? formatCurrency(row.tipRate) : '—',
      'Hourly Wage': row.emp.hourly_wage !== null ? formatCurrency(row.emp.hourly_wage) : '—',
      'Base Wages': formatCurrency(row.baseWages),
      'Guaranteed / Hr': row.emp.guaranteed_hourly !== null ? formatCurrency(row.emp.guaranteed_hourly) : '—',
      'Guaranteed Top-Up': formatCurrency(row.guaranteeTopUp),
      'Total Earnings': formatCurrency(row.totalEarnings),
      'Effective / Hr': row.effectiveRate !== null ? formatCurrency(row.effectiveRate) : '—',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Wage Report')
    XLSX.writeFile(wb, `wage-report-${tipRangeStart}.xlsx`)
  }

  const exportPerformance = () => {
    const rows = perfStats.map(({ emp, done, allTime }, idx) => ({
      Rank: idx + 1,
      Name: emp.name,
      Role: emp.role,
      [`Tasks (${period})`]: done,
      'Tasks (All Time)': allTime,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Performance')
    XLSX.writeFile(wb, `performance-${startDate}.xlsx`)
  }

  const periodLabel = () => {
    if (period === 'daily') return format(refDate, 'MMM d, yyyy')
    if (period === 'weekly') return `${format(startOfWeek(refDate, { weekStartsOn: 1 }), 'MMM d')} – ${format(endOfWeek(refDate, { weekStartsOn: 1 }), 'MMM d, yyyy')}`
    return format(refDate, 'MMMM yyyy')
  }

  const prev = () => {
    if (period === 'daily') setRefDate(d => new Date(d.getTime() - 86400000))
    else if (period === 'weekly') setRefDate(d => subWeeks(d, 1))
    else setRefDate(d => subMonths(d, 1))
  }
  const next = () => {
    if (period === 'daily') setRefDate(d => new Date(d.getTime() + 86400000))
    else if (period === 'weekly') setRefDate(d => addWeeks(d, 1))
    else setRefDate(d => addMonths(d, 1))
  }

  const exportEmployeePdf = () => {
    if (!employeeReportRef.current || (!selectedEmployeeStats && !selectedTipSummary)) return

    const printWindow = window.open('', '_blank', 'width=1400,height=900')
    if (!printWindow) return

    const reportTitle = showEarningsReport
      ? `${selectedTipSummary?.emp.name ?? 'Employee'} Earnings Report`
      : `${selectedEmployeeStats?.emp.name ?? 'Employee'} Performance Report`
    printWindow.document.write(`
      <html>
        <head>
          <title>${reportTitle}</title>
          <style>
            @page {
              size: A4 landscape;
              margin: 10mm;
            }
            * {
              box-sizing: border-box;
            }
            body {
              margin: 0;
              font-family: Arial, sans-serif;
              color: #111827;
              background: #ffffff;
            }
            .print-page {
              width: 100%;
              min-height: 180mm;
            }
            .print-header {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              margin-bottom: 10px;
              padding-bottom: 8px;
              border-bottom: 2px solid #e5e7eb;
            }
            .print-title {
              font-size: 24px;
              font-weight: 700;
              margin: 0;
            }
            .print-subtitle {
              margin-top: 4px;
              color: #6b7280;
              font-size: 12px;
            }
            .metric-grid {
              display: grid;
              grid-template-columns: repeat(5, minmax(0, 1fr));
              gap: 10px;
              margin-bottom: 10px;
            }
            .rank-grid {
              display: grid;
              grid-template-columns: repeat(4, minmax(0, 1fr));
              gap: 10px;
              margin-bottom: 10px;
            }
            .detail-grid {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 10px;
            }
            .card {
              border: 1px solid #d1d5db;
              border-radius: 16px;
              padding: 14px;
              background: #fff;
              break-inside: avoid;
            }
            .score-card {
              background: #fef3c7;
              border-color: #f59e0b;
            }
            .rank-card {
              background: #f9fafb;
            }
            .label {
              font-size: 12px;
              color: #6b7280;
              margin-bottom: 8px;
            }
            .value-lg {
              font-size: 30px;
              font-weight: 700;
              line-height: 1;
            }
            .value-md {
              font-size: 22px;
              font-weight: 700;
              line-height: 1.1;
            }
            .muted {
              color: #6b7280;
              font-size: 11px;
              margin-top: 6px;
            }
            .card h3 {
              margin: 0 0 10px 0;
              font-size: 14px;
            }
            .rows {
              display: grid;
              gap: 7px;
              font-size: 12px;
            }
            .row {
              display: flex;
              justify-content: space-between;
              gap: 10px;
            }
            .row span:first-child {
              color: #6b7280;
            }
            @media print {
              body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
            }
          </style>
        </head>
        <body>
          ${employeeReportRef.current.innerHTML}
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  const sendSelectedReportEmail = async () => {
    if (!selectedTipSummary) return
    setSendingReportEmail(true)
    setReportEmailStatus(null)
    try {
      const res = await fetch('/api/send-wage-report-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: selectedTipSummary.emp.id,
          ref_date: format(refDate, 'yyyy-MM-dd'),
          period: tipReportPeriod,
          view: tipReportView,
        }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to send report email')
      setReportEmailStatus('Report email sent')
    } catch (error) {
      setReportEmailStatus(error instanceof Error ? error.message : 'Failed to send report email')
    } finally {
      setSendingReportEmail(false)
    }
  }

  const saveAttendanceAdjustment = async (record: ShiftClock) => {
    const edit = attendanceEdits[record.id]
    setSavingAttendanceId(record.id)
    setAttendanceStatus(null)
    try {
      const res = await fetch('/api/clock-events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: record.id,
          approved_hours: edit?.hours ?? record.approved_hours ?? '',
          manager_note: edit?.note ?? record.manager_note ?? '',
          action: edit?.hours && Number(edit.hours) !== Number(record.approved_hours ?? 0) ? 'adjust' : 'approve',
        }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to save attendance adjustment')

      const clockRes = await fetch('/api/clock-events', { cache: 'no-store' })
      const clockJson = (await clockRes.json().catch(() => ({}))) as { records?: ShiftClock[] }
      setClockRecords(clockJson.records ?? [])
      setAttendanceStatus('Attendance report updated')
    } catch (error) {
      setAttendanceStatus(error instanceof Error ? error.message : 'Failed to save attendance adjustment')
    } finally {
      setSavingAttendanceId(null)
    }
  }

  return (
    <div className="p-6">
      <AdminSubpageHeader
        title="Reporting"
        subtitle="Track staff output, tips, and EOD history."
        rightSlot={<Badge variant="outline" className="text-green-700 border-green-300">Manager Access</Badge>}
      />

      <Tabs
        value={department}
        onValueChange={(value: string | null) => {
          if (!value) return
          setDepartment(value as ReportDepartment)
          setSelectedEmployeeId(null)
          setTipEmployeeFilter('all')
        }}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="foh">FOH Reports</TabsTrigger>
          <TabsTrigger value="boh">BOH Reports</TabsTrigger>
        </TabsList>

      <Tabs value={reportTab} onValueChange={(value: string | null) => value && setReportTab(value as ReportTab)}>
        <TabsList className="mb-4">
          <TabsTrigger value="performance">Task Performance</TabsTrigger>
          <TabsTrigger value="wages">Wage Report</TabsTrigger>
          <TabsTrigger value="eod">EOD History</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
        </TabsList>

        <TabsContent value="performance">
          <div className="bg-white rounded-xl border p-5">
            <div className="flex items-center gap-3 mb-4">
              <Select value={period} onValueChange={(v: string | null) => v && setPeriod(v as Period)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={prev}>←</Button>
              <span className="font-medium text-sm min-w-48 text-center">{periodLabel()}</span>
              <Button variant="outline" size="sm" onClick={next}>→</Button>
              <Button variant="outline" size="sm" className="ml-auto" onClick={exportPerformance}>
                <Download className="w-4 h-4 mr-2" /> Export
              </Button>
            </div>
            <div className="mb-5 grid gap-4 md:grid-cols-4">
              <div className="rounded-xl border bg-amber-50 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-amber-700">Top Performer</div>
                <div className="mt-2 text-lg font-semibold text-amber-950">{performanceLeader?.emp.name ?? '—'}</div>
                <div className="text-sm text-amber-800">{performanceLeader ? `${performanceLeader.done} tasks in ${periodLabel()}` : 'No task data yet'}</div>
              </div>
              <div className="rounded-xl border bg-sky-50 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-sky-700">Tasks In Period</div>
                <div className="mt-2 text-2xl font-bold text-sky-950">{performanceTotalTasks}</div>
                <div className="text-sm text-sky-800">{formatDateRangeLabel(startDate, endDate)}</div>
              </div>
              <div className="rounded-xl border bg-green-50 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-green-700">Active Staff</div>
                <div className="mt-2 text-2xl font-bold text-green-950">{activePerformanceCount}</div>
                <div className="text-sm text-green-800">Staff with completed tasks in this {department.toUpperCase()} view</div>
              </div>
              <div className="rounded-xl border bg-violet-50 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-violet-700">Quick Read</div>
                <div className="mt-2 text-sm font-medium text-violet-950">
                  Use the report button on the right to open score, rank, tip pace, and task pace details.
                </div>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Rank</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Tasks This Period</TableHead>
                  <TableHead className="text-right">Monthly Tasks</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                  <TableHead className="text-right">Report</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perfStats.map(({ emp, done, allTime }, idx) => (
                  <TableRow key={emp.id}>
                    <TableCell>
                      {idx === 0 ? <Trophy className="w-4 h-4 text-amber-500" /> : <span className="text-muted-foreground">{idx + 1}</span>}
                    </TableCell>
                    <TableCell className="font-medium">{emp.name}</TableCell>
                    <TableCell className="capitalize text-muted-foreground">{emp.role}</TableCell>
                    <TableCell className="text-right font-semibold">{done}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{allTime}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {performanceTotalTasks > 0 ? getPercent((done / performanceTotalTasks) * 100) : '0.0%'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setSelectedEmployeeId(emp.id)}>
                        View Report
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {perfStats.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-6">No task data for this period</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {monthlyRankings && (
            <div className="grid grid-cols-1 gap-4 mt-4 xl:grid-cols-3">
              <div className="bg-white rounded-xl border p-5">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-amber-500" /> Monthly Task Count
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">Rank</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">Tasks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...monthlyRankings].sort((a, b) => b.tasks - a.tasks).map(({ emp, tasks }, idx) => (
                      <TableRow key={emp.id}>
                        <TableCell>{idx === 0 ? <Trophy className="w-4 h-4 text-amber-500" /> : <span className="text-muted-foreground">{idx + 1}</span>}</TableCell>
                        <TableCell>
                          <button className="font-medium text-left hover:underline" onClick={() => setSelectedEmployeeId(emp.id)}>
                            {emp.name}
                          </button>
                        </TableCell>
                        <TableCell className="text-right font-semibold">{tasks}</TableCell>
                      </TableRow>
                    ))}
                    {monthlyRankings.length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-4">No data</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="bg-white rounded-xl border p-5">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-violet-500" /> Monthly Task Rate (per hour)
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">Rank</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Tasks/hr</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...monthlyRankings].filter(x => x.hours > 0).sort((a, b) => b.taskRate - a.taskRate).map(({ emp, hours, taskRate }, idx) => (
                      <TableRow key={emp.id}>
                        <TableCell>{idx === 0 ? <Trophy className="w-4 h-4 text-violet-500" /> : <span className="text-muted-foreground">{idx + 1}</span>}</TableCell>
                        <TableCell>
                          <button className="font-medium text-left hover:underline" onClick={() => setSelectedEmployeeId(emp.id)}>
                            {emp.name}
                          </button>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">{hours.toFixed(1)}</TableCell>
                        <TableCell className="text-right font-semibold">{taskRate.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                    {monthlyRankings.filter(x => x.hours > 0).length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">No hours data this month</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="bg-white rounded-xl border p-5">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-green-600" /> Monthly Tip Rate (per hour)
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">Rank</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Tips/hr</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...monthlyRankings].filter(x => x.hours > 0).sort((a, b) => b.tipRate - a.tipRate).map(({ emp, hours, tipRate }, idx) => (
                      <TableRow key={emp.id}>
                        <TableCell>{idx === 0 ? <Trophy className="w-4 h-4 text-green-600" /> : <span className="text-muted-foreground">{idx + 1}</span>}</TableCell>
                        <TableCell>
                          <button className="font-medium text-left hover:underline" onClick={() => setSelectedEmployeeId(emp.id)}>
                            {emp.name}
                          </button>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">{hours.toFixed(1)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(tipRate)}</TableCell>
                      </TableRow>
                    ))}
                    {monthlyRankings.filter(x => x.hours > 0).length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">No tip-rate data this month</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="wages">
          <div className="bg-white rounded-xl border p-5">
            <div className="flex items-center gap-3 mb-4">
              <Select value={tipReportView} onValueChange={(v: string | null) => v && setTipReportView(v as TipReportView)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="earnings">Earnings</SelectItem>
                  <SelectItem value="tips">Tip Only</SelectItem>
                </SelectContent>
              </Select>
              <Select value={tipReportPeriod} onValueChange={(v: string | null) => v && setTipReportPeriod(v as TipReportPeriod)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
              <Select value={tipEmployeeFilter} onValueChange={(v: string | null) => v && setTipEmployeeFilter(v)}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Staff</SelectItem>
                  {tipSummaryRows.map(row => (
                    <SelectItem key={row.emp.id} value={row.emp.id}>{row.emp.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => setRefDate(d => tipReportPeriod === 'daily' ? new Date(d.getTime() - 86400000) : tipReportPeriod === 'weekly' ? subWeeks(d, 1) : subMonths(d, 1))}>←</Button>
              <span className="font-medium text-sm min-w-56 text-center">
                {tipReportPeriod === 'daily'
                  ? format(refDate, 'MMM d, yyyy')
                  : tipReportPeriod === 'weekly'
                  ? `Week of ${format(startOfWeek(refDate, { weekStartsOn: 1 }), 'MMM d, yyyy')}`
                  : format(refDate, 'MMMM yyyy')}
              </span>
              <Button variant="outline" size="sm" onClick={() => setRefDate(d => tipReportPeriod === 'daily' ? new Date(d.getTime() + 86400000) : tipReportPeriod === 'weekly' ? addWeeks(d, 1) : addMonths(d, 1))}>→</Button>
              <Button variant="outline" size="sm" className="ml-auto" onClick={exportTips}>
                <Download className="w-4 h-4 mr-2" /> Export Excel
              </Button>
            </div>
            <div className="mb-4 grid gap-4 md:grid-cols-4">
              <div className="rounded-xl border bg-green-50 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-green-700">Tips</div>
                <div className="mt-2 text-2xl font-bold text-green-950">{formatCurrency(displayedTipSummaryRows.reduce((sum, row) => sum + row.tips, 0))}</div>
              </div>
              <div className="rounded-xl border bg-sky-50 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-sky-700">Hours</div>
                <div className="mt-2 text-2xl font-bold text-sky-950">{displayedTipSummaryRows.reduce((sum, row) => sum + row.hours, 0).toFixed(1)}h</div>
              </div>
              <div className="rounded-xl border bg-amber-50 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-amber-700">Base Wages</div>
                <div className="mt-2 text-2xl font-bold text-amber-950">{formatCurrency(displayedTipSummaryRows.reduce((sum, row) => sum + row.baseWages, 0))}</div>
              </div>
              <div className="rounded-xl border bg-violet-50 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-violet-700">Guaranteed Top-Up</div>
                <div className="mt-2 text-2xl font-bold text-violet-950">{formatCurrency(displayedTipSummaryRows.reduce((sum, row) => sum + row.guaranteeTopUp, 0))}</div>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Tips</TableHead>
                  <TableHead className="text-right">Tip / Hr</TableHead>
                  {tipReportView === 'earnings' && (
                    <>
                      <TableHead className="text-right">Hourly Wage</TableHead>
                      <TableHead className="text-right">Base Wages</TableHead>
                      <TableHead className="text-right">Guaranteed / Hr</TableHead>
                      <TableHead className="text-right">Guaranteed Top-Up</TableHead>
                      <TableHead className="text-right">Total Earnings</TableHead>
                      <TableHead className="text-right">Effective / Hr</TableHead>
                    </>
                  )}
                  <TableHead className="text-right">Report</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedTipSummaryRows.map(row => (
                  <TableRow key={row.emp.id}>
                    <TableCell className="font-medium">{row.emp.name}</TableCell>
                    <TableCell className="capitalize text-muted-foreground">{row.emp.role}</TableCell>
                    <TableCell className="text-right">{row.hours.toFixed(1)}h</TableCell>
                    <TableCell className="text-right font-semibold text-green-700">{formatCurrency(row.tips)}</TableCell>
                    <TableCell className="text-right">{row.tipRate !== null ? formatCurrency(row.tipRate) : '—'}</TableCell>
                    {tipReportView === 'earnings' && (
                      <>
                        <TableCell className="text-right">{row.emp.hourly_wage !== null ? formatCurrency(row.emp.hourly_wage) : '—'}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.baseWages)}</TableCell>
                        <TableCell className="text-right">{row.emp.guaranteed_hourly !== null ? formatCurrency(row.emp.guaranteed_hourly) : '—'}</TableCell>
                        <TableCell className="text-right text-violet-700">{formatCurrency(row.guaranteeTopUp)}</TableCell>
                        <TableCell className="text-right font-bold text-slate-900">{formatCurrency(row.totalEarnings)}</TableCell>
                        <TableCell className="text-right">{row.effectiveRate !== null ? formatCurrency(row.effectiveRate) : '—'}</TableCell>
                      </>
                    )}
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setSelectedEmployeeId(row.emp.id)}>
                        View Report
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {displayedTipSummaryRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={tipReportView === 'earnings' ? 12 : 6} className="text-center text-muted-foreground py-6">
                      No tip or wage data for this {tipReportPeriod}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <p className="mt-4 text-xs text-muted-foreground">
              Guaranteed top-up is calculated from verified tip distribution hours. Each day is checked separately: if hourly wage plus tips falls below the guaranteed hourly minimum, the difference is added for that day.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="eod">
          <div className="bg-white rounded-xl border p-5">
            <div className="mb-4 flex items-center gap-3">
              <Select value={eodHistoryPeriod} onValueChange={(v: string | null) => v && setEodHistoryPeriod(v as Period)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (eodHistoryPeriod === 'daily') setRefDate(d => new Date(d.getTime() - 86400000))
                  else if (eodHistoryPeriod === 'weekly') setRefDate(d => subWeeks(d, 1))
                  else setRefDate(d => subMonths(d, 1))
                }}
              >
                ←
              </Button>
              <span className="font-medium text-sm min-w-56 text-center">
                {eodHistoryPeriod === 'daily'
                  ? format(refDate, 'MMM d, yyyy')
                  : eodHistoryPeriod === 'weekly'
                    ? `Week of ${format(startOfWeek(refDate, { weekStartsOn: 1 }), 'MMM d, yyyy')}`
                    : format(refDate, 'MMMM yyyy')}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (eodHistoryPeriod === 'daily') setRefDate(d => new Date(d.getTime() + 86400000))
                  else if (eodHistoryPeriod === 'weekly') setRefDate(d => addWeeks(d, 1))
                  else setRefDate(d => addMonths(d, 1))
                }}
              >
                →
              </Button>
            </div>
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
                {filteredEodReports.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{format(new Date(r.session_date), 'MMM d, yyyy')}</TableCell>
                    <TableCell className="text-right">${r.cash_total.toFixed(2)}</TableCell>
                    <TableCell className="text-right">${r.batch_total.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-semibold">${r.revenue_total.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-green-700">${r.tip_total.toFixed(2)}</TableCell>
                    <TableCell className="text-right">${r.cash_deposit.toFixed(2)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-xs truncate">{r.memo ?? '—'}</TableCell>
                  </TableRow>
                ))}
                {filteredEodReports.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-6">No EOD reports yet</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <p className="mt-4 text-xs text-muted-foreground">
              EOD History stays store-wide. FOH / BOH filtering applies to task and tip analytics above.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="attendance">
          <div className="bg-white rounded-xl border p-5">
            <div className="mb-4 flex items-center gap-3">
              <Select value={attendancePeriod} onValueChange={(v: string | null) => v && setAttendancePeriod(v as Period)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (attendancePeriod === 'daily') setRefDate(d => new Date(d.getTime() - 86400000))
                  else if (attendancePeriod === 'weekly') setRefDate(d => subWeeks(d, 1))
                  else setRefDate(d => subMonths(d, 1))
                }}
              >
                ←
              </Button>
              <span className="font-medium text-sm min-w-56 text-center">
                {attendancePeriod === 'daily'
                  ? format(refDate, 'MMM d, yyyy')
                  : attendancePeriod === 'weekly'
                    ? `Week of ${format(startOfWeek(refDate, { weekStartsOn: 1 }), 'MMM d, yyyy')}`
                    : format(refDate, 'MMMM yyyy')}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (attendancePeriod === 'daily') setRefDate(d => new Date(d.getTime() + 86400000))
                  else if (attendancePeriod === 'weekly') setRefDate(d => addWeeks(d, 1))
                  else setRefDate(d => addMonths(d, 1))
                }}
              >
                →
              </Button>
              <div className="ml-auto flex items-center gap-2">
                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                  Pending {filteredAttendanceRecords.filter(record => isClockPending(record)).length}
                </Badge>
              </div>
            </div>
            {attendanceStatus && (
              <div className="mb-4 rounded-lg border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
                {attendanceStatus}
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Clock In</TableHead>
                  <TableHead className="text-right">Clock Out</TableHead>
                  <TableHead className="text-right">Approved Hrs</TableHead>
                  <TableHead>Manager Note</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAttendanceRecords.map(record => {
                  const employee = record.employee ?? employees.find(item => item.id === record.employee_id)
                  const currentEdit = attendanceEdits[record.id] ?? {
                    hours: record.approved_hours !== null ? String(record.approved_hours) : '',
                    note: record.manager_note ?? '',
                  }
                  return (
                    <TableRow key={record.id}>
                      <TableCell className="font-medium">{format(new Date(record.session_date + 'T12:00:00'), 'MMM d, yyyy')}</TableCell>
                      <TableCell>{employee?.name ?? 'Unknown Staff'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={
                          record.approval_status === 'pending_review'
                            ? 'border-amber-300 bg-amber-50 text-amber-800'
                            : record.approval_status === 'adjusted'
                              ? 'border-sky-300 bg-sky-50 text-sky-800'
                              : record.approval_status === 'approved'
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                : 'border-slate-300 bg-slate-50 text-slate-700'
                        }>
                          {record.approval_status}
                        </Badge>
                        {record.auto_clock_out && (
                          <div className="mt-1 text-xs text-amber-700">Auto clock-out warning</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{format(new Date(record.clock_in_at), 'p')}</TableCell>
                      <TableCell className="text-right">{record.clock_out_at ? format(new Date(record.clock_out_at), 'p') : 'Open'}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          value={currentEdit.hours}
                          onChange={event => setAttendanceEdits(prev => ({
                            ...prev,
                            [record.id]: { ...currentEdit, hours: event.target.value },
                          }))}
                          className="ml-auto h-8 w-24 text-right"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={currentEdit.note}
                          onChange={event => setAttendanceEdits(prev => ({
                            ...prev,
                            [record.id]: { ...currentEdit, note: event.target.value },
                          }))}
                          className="h-8 min-w-40"
                          placeholder="Approval note"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => saveAttendanceAdjustment(record)} disabled={savingAttendanceId === record.id}>
                          {savingAttendanceId === record.id ? 'Saving…' : 'Approve'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {filteredAttendanceRecords.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                      No attendance records for this range
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
      </Tabs>

      <Dialog open={!!selectedEmployeeId} onOpenChange={open => { if (!open) setSelectedEmployeeId(null) }}>
        <DialogContent className="!top-4 !right-4 !bottom-4 !left-4 !grid !w-auto !max-w-none !translate-x-0 !translate-y-0 !grid-rows-[auto_1fr] overflow-hidden p-0">
          <DialogHeader className="border-b px-8 py-5">
            <div className="flex items-center justify-between gap-4">
              <DialogTitle>
                {showEarningsReport
                  ? `${selectedTipSummary?.emp.name ?? 'Employee'} Earnings Report`
                  : `${selectedEmployeeStats?.emp.name ?? selectedWeekTips?.emp.name ?? selectedPeriodTasks?.emp.name ?? 'Employee'} Performance`}
              </DialogTitle>
              {(selectedEmployeeStats || selectedTipSummary) && (
                <div className="flex items-center gap-2">
                  {showEarningsReport && (
                    <Button variant="outline" size="sm" onClick={sendSelectedReportEmail} disabled={sendingReportEmail}>
                      <Mail className="w-4 h-4 mr-2" /> {sendingReportEmail ? 'Sending…' : 'Send Email'}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={exportEmployeePdf}>
                    <Download className="w-4 h-4 mr-2" /> Export PDF
                  </Button>
                </div>
              )}
            </div>
          </DialogHeader>
          <div className="overflow-y-auto px-8 py-6">
            {reportEmailStatus && (
              <div className="mb-4 rounded-lg border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
                {reportEmailStatus}
              </div>
            )}
            {showEarningsReport && selectedTipSummary ? (
              <div ref={employeeReportRef} className="print-page mx-auto w-full max-w-[1080px] space-y-6">
                <div className="print-header">
                  <div>
                    <h1 className="print-title">{selectedTipSummary.emp.name} Earnings Report</h1>
                    <div className="print-subtitle">
                      {tipReportPeriod === 'weekly'
                        ? `${format(startOfWeek(refDate, { weekStartsOn: 1 }), 'MMM d, yyyy')} - ${format(endOfWeek(refDate, { weekStartsOn: 1 }), 'MMM d, yyyy')}`
                        : format(refDate, 'MMMM yyyy')} · {selectedTipSummary.emp.role}
                    </div>
                  </div>
                  <Badge variant="outline" className="border-sky-300 bg-sky-50 px-3 py-1 text-sky-800">
                    Total {formatCurrency(selectedTipSummary.totalEarnings)}
                  </Badge>
                </div>

                <div className="metric-grid !grid-cols-4">
                  <div className="card">
                    <div className="text-sm text-muted-foreground">Hours Worked</div>
                    <div className="mt-2 text-3xl font-bold">{selectedTipSummary.hours.toFixed(2)}h</div>
                  </div>
                  <div className="card">
                    <div className="text-sm text-muted-foreground">Tips Earned</div>
                    <div className="mt-2 text-3xl font-bold text-green-700">{formatCurrency(selectedTipSummary.tips)}</div>
                    <div className="mt-2 text-xs text-muted-foreground">Tips / Hr {selectedTipSummary.tipRate !== null ? formatCurrency(selectedTipSummary.tipRate) : '—'}</div>
                  </div>
                  <div className="card">
                    <div className="text-sm text-muted-foreground">Base Wages</div>
                    <div className="mt-2 text-3xl font-bold text-amber-700">{formatCurrency(selectedTipSummary.baseWages)}</div>
                  </div>
                  <div className="card">
                    <div className="text-sm text-muted-foreground">Guaranteed Top-Up</div>
                    <div className="mt-2 text-3xl font-bold text-violet-700">{formatCurrency(selectedTipSummary.guaranteeTopUp)}</div>
                  </div>
                </div>

                <div className="detail-grid">
                  <div className="card">
                    <h3 className="font-semibold mb-3">Pay Breakdown</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">Hourly Wage</span><span className="font-semibold">{selectedTipSummary.emp.hourly_wage !== null ? formatCurrency(selectedTipSummary.emp.hourly_wage) : '—'}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Guaranteed / Hr</span><span className="font-semibold">{selectedTipSummary.emp.guaranteed_hourly !== null ? formatCurrency(selectedTipSummary.emp.guaranteed_hourly) : '—'}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Tips / Hr</span><span className="font-semibold">{selectedTipSummary.tipRate !== null ? formatCurrency(selectedTipSummary.tipRate) : '—'}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Tips</span><span className="font-semibold">{formatCurrency(selectedTipSummary.tips)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Base Wages</span><span className="font-semibold">{formatCurrency(selectedTipSummary.baseWages)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Guaranteed Top-Up</span><span className="font-semibold text-violet-700">{formatCurrency(selectedTipSummary.guaranteeTopUp)}</span></div>
                      <div className="flex justify-between border-t pt-2"><span className="font-medium">Total Earnings</span><span className="font-bold">{formatCurrency(selectedTipSummary.totalEarnings)}</span></div>
                    </div>
                  </div>

                  <div className="card">
                    <h3 className="font-semibold mb-3">Notes</h3>
                    <div className="space-y-3 text-sm text-muted-foreground">
                      <p>This report is based on verified tip distribution hours, not the original schedule.</p>
                      <p>If hourly wages plus tips did not reach the guaranteed minimum for a worked day, the difference is paid as a guaranteed top-up.</p>
                      <p>Effective hourly earnings this week: <span className="font-semibold text-slate-900">{selectedTipSummary.effectiveRate !== null ? formatCurrency(selectedTipSummary.effectiveRate) : '—'}</span></p>
                    </div>
                  </div>
                </div>
              </div>
            ) : selectedEmployeeStats ? (
              <div ref={employeeReportRef} className="print-page mx-auto w-full max-w-[1680px] space-y-6">
              <div className="print-header">
                <div>
                  <h1 className="print-title">{selectedEmployeeStats.emp.name} Performance Report</h1>
                  <div className="print-subtitle">
                    Role: {selectedEmployeeStats.emp.role} · Month: {format(refDate, 'MMMM yyyy')} · Generated from FOH Dashboard
                  </div>
                </div>
                <Badge variant="outline" className="border-amber-300 bg-amber-50 px-3 py-1 text-amber-800">
                  Score {selectedEmployeeStats.score}
                </Badge>
              </div>

              <div className="metric-grid xl:grid-cols-5">
                <div className="card score-card">
                  <div className="flex items-center gap-2 text-amber-700"><Star className="h-4 w-4" /> Performance Score</div>
                  <div className="mt-3 text-4xl font-bold">{selectedEmployeeStats.score}</div>
                  <div className="text-xs text-muted-foreground">Weighted score: Task Rank 30% + Task Pace 30% + Tip Pace 25% + Hours Rank 15%.</div>
                </div>
                <div className="card">
                  <div className="text-sm text-muted-foreground">Monthly Tasks</div>
                  <div className="mt-2 text-2xl font-bold">{selectedEmployeeStats.tasks}</div>
                  <div className="text-xs text-muted-foreground">Rank #{selectedEmployeeStats.taskRank}</div>
                </div>
                <div className="card">
                  <div className="text-sm text-muted-foreground">Task Pace</div>
                  <div className="mt-2 text-2xl font-bold">{selectedEmployeeStats.taskRate.toFixed(2)}</div>
                  <div className="text-xs text-muted-foreground">About {selectedEmployeeStats.taskRate.toFixed(2)} tasks each worked hour · Rank #{selectedEmployeeStats.taskRateRank}</div>
                </div>
                <div className="card">
                  <div className="text-sm text-muted-foreground">Tip Pace</div>
                  <div className="mt-2 text-2xl font-bold">{formatCurrency(selectedEmployeeStats.tipRate)}</div>
                  <div className="text-xs text-muted-foreground">Average tips earned per worked hour · Rank #{selectedEmployeeStats.tipRateRank}</div>
                </div>
                <div className="card">
                  <div className="text-sm text-muted-foreground">Total Hours</div>
                  <div className="mt-2 text-2xl font-bold">{selectedEmployeeStats.hours.toFixed(1)}h</div>
                  <div className="text-xs text-muted-foreground">Rank #{selectedEmployeeStats.hoursRank}</div>
                </div>
              </div>

              <div className="rank-grid xl:grid-cols-4">
                {rankingCards.map(card => (
                  <div key={card.label} className={`card rank-card ${card.accentClass}`}>
                    <div className="text-sm font-medium opacity-80">{card.label}</div>
                    <div className="mt-3 flex items-end justify-between">
                      <div className="text-4xl font-bold leading-none">#{card.rank}</div>
                      <Trophy className="h-6 w-6 opacity-70" />
                    </div>
                    <div className="mt-3 text-sm font-medium">{card.value}</div>
                  </div>
                ))}
              </div>

              <div className="detail-grid xl:grid-cols-2">
                <div className="card">
                  <h3 className="font-semibold mb-3">Monthly Comparison</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Task Share</span><span className="font-semibold">{getPercent(selectedEmployeeStats.taskSharePct)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Hour Share</span><span className="font-semibold">{getPercent(selectedEmployeeStats.hourSharePct)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Tip Share</span><span className="font-semibold">{getPercent(selectedEmployeeStats.tipSharePct)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Total Hours</span><span className="font-semibold">{selectedEmployeeStats.hours.toFixed(2)} hrs</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Total Tips</span><span className="font-semibold">{formatCurrency(selectedEmployeeStats.totalTips)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Hours Rank</span><span className="font-semibold">#{selectedEmployeeStats.hoursRank}</span></div>
                  </div>
                </div>

                <div className="card">
                  <h3 className="font-semibold mb-3">Recommended Read</h3>
                  <div className="space-y-2 text-sm">
                    <div className="rounded-lg bg-muted/50 p-3">
                      <div className="font-medium">Output</div>
                      <div className="text-muted-foreground">This employee is contributing {getPercent(selectedEmployeeStats.taskSharePct)} of the month&apos;s completed tasks.</div>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-3">
                      <div className="font-medium">Work Pace</div>
                      <div className="text-muted-foreground">They are averaging about {selectedEmployeeStats.taskRate.toFixed(2)} completed tasks for each hour worked.</div>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-3">
                      <div className="font-medium">Tip Pace</div>
                      <div className="text-muted-foreground">Their average tip pace is {formatCurrency(selectedEmployeeStats.tipRate)} per worked hour this month, ranked #{selectedEmployeeStats.tipRateRank} on the team.</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="detail-grid xl:grid-cols-2">
                <div className="card">
                  <h3 className="font-semibold mb-3">Current Period Task Snapshot</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Filtered Dates</span><span className="font-semibold">{formatDateRangeLabel(startDate, endDate)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Tasks in Filter</span><span className="font-semibold">{selectedPeriodTasks?.done ?? 0}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Monthly Tasks</span><span className="font-semibold">{selectedEmployeeStats?.tasks ?? 0}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Filter Window</span><span className="font-semibold">{periodLabel()}</span></div>
                  </div>
                </div>

                <div className="card">
                  <h3 className="font-semibold mb-3">Current Week Tip Snapshot</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Weekly Hours</span><span className="font-semibold">{selectedWeekTips?.totalHours.toFixed(1) ?? '0.0'}h</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Weekly Tips</span><span className="font-semibold">{formatCurrency(selectedWeekTips?.total ?? 0)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Tip / Hr</span><span className="font-semibold">{selectedWeekTips?.totalRate !== null && selectedWeekTips?.totalRate !== undefined ? formatCurrency(selectedWeekTips.totalRate) : '—'}</span></div>
                  </div>
                </div>
              </div>
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">No analytics yet for this employee.</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
