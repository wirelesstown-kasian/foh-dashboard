'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Employee, TaskCompletion, EodReport, TipDistribution } from '@/lib/types'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { Trophy, Download, Star } from 'lucide-react'
import {
  format, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  subWeeks, addWeeks, eachDayOfInterval, subMonths, addMonths
} from 'date-fns'
import * as XLSX from 'xlsx'

type Period = 'daily' | 'weekly' | 'monthly'
type ReportDepartment = 'foh' | 'boh'
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
  const [period, setPeriod] = useState<Period>('weekly')
  const [department, setDepartment] = useState<ReportDepartment>('foh')
  const [refDate, setRefDate] = useState(new Date())
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const employeeReportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let mounted = true

    void (async () => {
      const [empRes, compRes, eodRes] = await Promise.all([
        supabase.from('employees').select('*').eq('is_active', true).order('name'),
        supabase.from('task_completions').select('*'),
        supabase.from('eod_reports').select('*, tip_distributions(*, employee:employees(*))').order('session_date', { ascending: false }),
      ])

      if (!mounted) return

      setEmployees(empRes.data ?? [])
      setCompletions(compRes.data ?? [])
      setEodReports(eodRes.data ?? [])
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
      filteredEmployeeIds.has(completion.employee_id)
  )

  const perfStats = filteredEmployees.map(emp => {
    const done = filteredCompletions.filter(c => c.employee_id === emp.id).length
    const allTime = completions.filter(c => c.employee_id === emp.id).length
    return { emp, done, allTime }
  }).sort((a, b) => b.done - a.done)

  const monthStart = format(startOfMonth(refDate), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(refDate), 'yyyy-MM-dd')
  const monthCompletions = completions.filter(c => c.session_date >= monthStart && c.session_date <= monthEnd)
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
  const totalHoursByDay = new Map<string, number>()
  const totalTipsByDay = new Map<string, number>()
  const totalHouseByDay = new Map<string, number>()

  for (const report of weeklyEodReports) {
    totalHoursByDay.set(
      report.session_date,
      (report.tip_distributions ?? []).reduce((sum, dist) => (
        filteredEmployeeIds.has(dist.employee_id) ? sum + Number(dist.hours_worked) : sum
      ), 0)
    )
    totalTipsByDay.set(
      report.session_date,
      (report.tip_distributions ?? []).reduce((sum, dist) => (
        filteredEmployeeIds.has(dist.employee_id) ? sum + Number(dist.net_tip) : sum
      ), 0)
    )
    totalHouseByDay.set(
      report.session_date,
      (report.tip_distributions ?? []).reduce((sum, dist) => (
        filteredEmployeeIds.has(dist.employee_id) ? sum + Number(dist.house_deduction) : sum
      ), 0)
    )
  }

  const tipByEmployee = filteredEmployees.map(emp => {
    const daily: TipDetail[] = weekDays.map(day => {
      const dateStr = format(day, 'yyyy-MM-dd')
      const report = weeklyEodReports.find(r => r.session_date === dateStr)
      const dist = report?.tip_distributions.find(d => d.employee_id === emp.id)
      const amount = dist?.net_tip !== undefined ? Number(dist.net_tip) : null
      const hours = dist ? Number(dist.hours_worked) : 0
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

  const tipDailyTotals = weekDays.map(day => {
    const dateKey = format(day, 'yyyy-MM-dd')
    const totalHours = totalHoursByDay.get(dateKey) ?? 0
    const totalTips = totalTipsByDay.get(dateKey) ?? 0
    const totalHouse = totalHouseByDay.get(dateKey) ?? 0
    return {
      date: dateKey,
      totalHours,
      totalTips,
      totalHouse,
      totalRate: totalHours > 0 ? totalTips / totalHours : null,
    }
  })
  const weekTotalHours = tipDailyTotals.reduce((sum, item) => sum + item.totalHours, 0)
  const weekTotalTips = tipDailyTotals.reduce((sum, item) => sum + item.totalTips, 0)
  const weekTotalHouse = tipDailyTotals.reduce((sum, item) => sum + item.totalHouse, 0)
  const weekTotalRate = weekTotalHours > 0 ? weekTotalTips / weekTotalHours : null

  const selectedEmployeeStats = employeeMonthStats.find(item => item.emp.id === selectedEmployeeId) ?? null
  const selectedWeekTips = tipByEmployee.find(item => item.emp.id === selectedEmployeeId) ?? null
  const selectedPeriodTasks = perfStats.find(item => item.emp.id === selectedEmployeeId) ?? null
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
    const rows = tipByEmployee.flatMap(({ emp, daily, total, totalHours, totalHouse, totalRate }) => [
      ...daily.map(d => ({
        Name: emp.name,
        Role: emp.role,
        Date: d.date,
        Hours: d.hours.toFixed(2),
        'Tip Amount': d.amount !== null ? `$${d.amount.toFixed(2)}` : '—',
        'Tip / Hr': d.rate !== null ? `$${d.rate.toFixed(2)}` : '—',
        'House 15%': d.houseDeduction ? `$${d.houseDeduction.toFixed(2)}` : '—',
      })),
      {
        Name: emp.name,
        Role: '',
        Date: 'TOTAL',
        Hours: totalHours.toFixed(2),
        'Tip Amount': `$${total.toFixed(2)}`,
        'Tip / Hr': totalRate !== null ? `$${totalRate.toFixed(2)}` : '—',
        'House 15%': `$${totalHouse.toFixed(2)}`,
      },
    ])
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Tip Report')
    XLSX.writeFile(wb, `tip-report-${tipWeekStart}.xlsx`)
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
    if (!employeeReportRef.current || !selectedEmployeeStats) return

    const printWindow = window.open('', '_blank', 'width=1400,height=900')
    if (!printWindow) return

    const reportTitle = `${selectedEmployeeStats.emp.name} Performance Report`
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
        }}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="foh">FOH Reports</TabsTrigger>
          <TabsTrigger value="boh">BOH Reports</TabsTrigger>
        </TabsList>

      <Tabs defaultValue="performance">
        <TabsList className="mb-4">
          <TabsTrigger value="performance">Task Performance</TabsTrigger>
          <TabsTrigger value="tips">Tip Report</TabsTrigger>
          <TabsTrigger value="eod">EOD History</TabsTrigger>
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
                  Click any name below to open score, rank, tip pace, and task pace details.
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {perfStats.map(({ emp, done, allTime }, idx) => (
                  <TableRow key={emp.id}>
                    <TableCell>
                      {idx === 0 ? <Trophy className="w-4 h-4 text-amber-500" /> : <span className="text-muted-foreground">{idx + 1}</span>}
                    </TableCell>
                    <TableCell>
                      <button className="font-medium text-left hover:underline" onClick={() => setSelectedEmployeeId(emp.id)}>
                        {emp.name}
                      </button>
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">{emp.role}</TableCell>
                    <TableCell className="text-right font-semibold">{done}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{allTime}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {performanceTotalTasks > 0 ? getPercent((done / performanceTotalTasks) * 100) : '0.0%'}
                    </TableCell>
                  </TableRow>
                ))}
                {perfStats.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-6">No task data for this period</TableCell>
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

        <TabsContent value="tips">
          <div className="bg-white rounded-xl border p-5">
            <div className="flex items-center gap-3 mb-4">
              <Button variant="outline" size="sm" onClick={() => setRefDate(d => subWeeks(d, 1))}>←</Button>
              <span className="font-medium text-sm min-w-48 text-center">
                Week of {format(startOfWeek(refDate, { weekStartsOn: 1 }), 'MMM d, yyyy')}
              </span>
              <Button variant="outline" size="sm" onClick={() => setRefDate(d => addWeeks(d, 1))}>→</Button>
              <Button variant="outline" size="sm" className="ml-auto" onClick={exportTips}>
                <Download className="w-4 h-4 mr-2" /> Export Excel
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  {weekDays.map(d => (
                    <TableHead key={d.toISOString()} className="text-center">
                      <div>{format(d, 'EEE')}</div>
                      <div className="text-xs font-normal text-muted-foreground">{format(d, 'M/d')}</div>
                      <div className="text-[11px] font-normal text-muted-foreground mt-1">
                        {totalHoursByDay.get(format(d, 'yyyy-MM-dd'))?.toFixed(1) ?? '0.0'}h total
                      </div>
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Weekly Hours</TableHead>
                  <TableHead className="text-right">Tip / Hr</TableHead>
                  <TableHead className="text-right">House 15%</TableHead>
                    <TableHead className="text-right">Weekly Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tipByEmployee.map(({ emp, daily, total, totalHours, totalRate, totalHouse }) => (
                  <TableRow key={emp.id}>
                    <TableCell>
                      <button className="font-medium text-left hover:underline" onClick={() => setSelectedEmployeeId(emp.id)}>
                        {emp.name}
                      </button>
                    </TableCell>
                    {daily.map((d, i) => (
                      <TableCell key={i} className="text-center text-xs leading-5">
                        {d.amount !== null ? (
                          <div>
                            <div className="font-semibold text-green-700">${d.amount.toFixed(2)}</div>
                            <div className="text-muted-foreground">{d.hours.toFixed(1)}h worked</div>
                            <div className="text-muted-foreground">{d.rate !== null ? `$${d.rate.toFixed(2)}/hr` : '—/hr'}</div>
                            <div className="text-amber-700">House: ${d.houseDeduction.toFixed(2)}</div>
                          </div>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </TableCell>
                    ))}
                    <TableCell className="text-right text-sm text-muted-foreground">{totalHours.toFixed(1)}h</TableCell>
                    <TableCell className="text-right text-sm">{totalRate !== null ? `$${totalRate.toFixed(2)}` : '—'}</TableCell>
                    <TableCell className="text-right text-sm text-amber-700">${totalHouse.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-bold text-green-700">${total.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                {tipByEmployee.length > 0 && (
                  <TableRow className="bg-amber-50/70">
                    <TableCell className="font-semibold">Daily Total</TableCell>
                    {tipDailyTotals.map(day => (
                      <TableCell key={day.date} className="text-center text-xs leading-5">
                        <div className="font-semibold text-amber-900">${day.totalTips.toFixed(2)}</div>
                        <div className="text-muted-foreground">{day.totalHours.toFixed(1)}h worked</div>
                        <div className="text-muted-foreground">{day.totalRate !== null ? `$${day.totalRate.toFixed(2)}/hr` : '—/hr'}</div>
                        <div className="text-amber-700">House: ${day.totalHouse.toFixed(2)}</div>
                      </TableCell>
                    ))}
                    <TableCell className="text-right text-sm font-medium text-amber-900">{weekTotalHours.toFixed(1)}h</TableCell>
                    <TableCell className="text-right text-sm font-medium">{weekTotalRate !== null ? `$${weekTotalRate.toFixed(2)}` : '—'}</TableCell>
                    <TableCell className="text-right text-sm font-medium text-amber-700">${weekTotalHouse.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-bold text-green-700">${weekTotalTips.toFixed(2)}</TableCell>
                  </TableRow>
                )}
                {tipByEmployee.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center text-muted-foreground py-6">No tip data for this week</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="eod">
          <div className="bg-white rounded-xl border p-5">
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
                {eodReports.map(r => (
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
                {eodReports.length === 0 && (
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
      </Tabs>
      </Tabs>

      <Dialog open={!!selectedEmployeeId} onOpenChange={open => { if (!open) setSelectedEmployeeId(null) }}>
        <DialogContent className="!top-4 !right-4 !bottom-4 !left-4 !grid !w-auto !max-w-none !translate-x-0 !translate-y-0 !grid-rows-[auto_1fr] overflow-hidden p-0">
          <DialogHeader className="border-b px-8 py-5">
            <div className="flex items-center justify-between gap-4">
              <DialogTitle>
                {selectedEmployeeStats?.emp.name ?? selectedWeekTips?.emp.name ?? selectedPeriodTasks?.emp.name ?? 'Employee'} Performance
              </DialogTitle>
              {selectedEmployeeStats && (
                <Button variant="outline" size="sm" onClick={exportEmployeePdf}>
                  <Download className="w-4 h-4 mr-2" /> Export PDF
                </Button>
              )}
            </div>
          </DialogHeader>
          <div className="overflow-y-auto px-8 py-6">
            {selectedEmployeeStats ? (
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
                    <div className="flex justify-between"><span className="text-muted-foreground">House 15%</span><span className="font-semibold">{formatCurrency(selectedWeekTips?.totalHouse ?? 0)}</span></div>
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
