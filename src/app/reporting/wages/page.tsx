'use client'

import { useMemo, useState } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { DepartmentTabs } from '@/components/reporting/DepartmentTabs'
import { ReportingNav } from '@/components/reporting/ReportingNav'
import { MissingTipDistributionNotice } from '@/components/reporting/MissingTipDistributionNotice'
import { ReportingToolbar } from '@/components/reporting/ReportingToolbar'
import { notifyReportingDataChanged, useClockRecords, useEmployees, useEodReports, usePayrollRuns, useScheduledDepartmentIds, useSchedulesByRange, useTaskCompletions } from '@/components/reporting/useReportingData'
import { useAppSettings } from '@/components/useAppSettings'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { ReportDepartment, ReportPeriod, formatCurrency, getReportRange, isEmployeeInDepartment } from '@/lib/reporting'
import { clockMatchesWorkDepartment, getClockWorkDepartment, getMealBreakState, shouldWarnMissingMealBreak, getEffectiveClockHours, isClockPending } from '@/lib/clockUtils'
import { getDepartmentLabel, getRoleLabel } from '@/lib/organization'
import { exportReportToPdf } from '@/lib/reportExport'
import { exportReportToExcel, type ExcelColumn, type ExcelReportSheet } from '@/lib/reportExcel'
import { calculateDailyTipPreview, getSavedDailyTips, shouldRecalculateTips } from '@/lib/dailyTips'
import { getDailyGuaranteeTopUp, getPayrollPaymentBreakdown, normalizeMoney, paymentMethodLabel } from '@/lib/payroll'
import { reconcileWageRows, summarizeRestaurantTips, wageDetailMatchesPayroll } from '@/lib/wageReportReconciliation'
import type { Employee, PaymentMethod, Schedule, ShiftClock } from '@/lib/types'

function getRankMap<T>(items: T[], getValue: (item: T) => number, getId: (item: T) => string) {
  const sorted = [...items].sort((a, b) => getValue(b) - getValue(a))
  return new Map(sorted.map((item, idx) => [getId(item), idx + 1]))
}

function scoreFromRank(rank: number, count: number) {
  if (count <= 1) return 100
  return ((count - rank) / (count - 1)) * 100
}

type TipReportView = 'earnings' | 'tips'
type ReportPaymentMethod = PaymentMethod | 'unknown'

type WageDetailRow = {
  date: string
  workDepartment?: string
  sourceRunId?: string
  hours: number
  mealBreakMinutes: number
  tips: number
  baseWages: number
  guaranteeTopUp: number
  commission: number
  deductions: number
  totalEarnings: number
}

type WageSummaryRow = {
  emp: Employee
  hours: number
  mealBreakMinutes: number
  tips: number
  baseWages: number
  guaranteeTopUp: number
  commission: number
  deductions: number
  totalEarnings: number
  tipRate: number | null
  effectiveRate: number | null
  paymentMethod: ReportPaymentMethod
  paymentBreakdown: Record<ReportPaymentMethod, number>
  hasAutoClockOut: boolean
  hasOpenClock: boolean
  hasMissingMealBreak: boolean
  pendingEarnings?: number
  legacyEarnings?: number
}

type DailyTipPreview = {
  hours: number
  tips: number
}

type SavedDailyTip = {
  hours: number
  tips: number
}

function getReportPaymentMethod(paymentMethod: PaymentMethod | null | undefined): ReportPaymentMethod {
  return paymentMethod ?? 'unknown'
}

function formatPaymentBreakdown(breakdown: Record<ReportPaymentMethod, number>) {
  const parts = (['cash', 'check', 'ach'] as PaymentMethod[])
    .filter(method => breakdown[method] > 0)
    .map(method => `${paymentMethodLabel(method)} ${formatCurrency(breakdown[method])}`)
  if (breakdown.unknown > 0) parts.push(`Unknown ${formatCurrency(breakdown.unknown)}`)
  return parts.length > 0 ? parts.join(' + ') : 'Not recorded'
}

function formatMealBreakMinutes(minutes: number) {
  return minutes > 0 ? `${minutes}m` : '—'
}

function formatReportDate(value: string) {
  return format(new Date(`${value}T00:00:00`), 'M/d/yyyy')
}

function getClockRecordEmployee(record: ShiftClock, employees: Employee[]) {
  const relatedEmployee = record.employee as Employee | Employee[] | undefined
  if (Array.isArray(relatedEmployee)) {
    return relatedEmployee[0] ?? employees.find(employee => employee.id === record.employee_id) ?? null
  }
  return relatedEmployee ?? employees.find(employee => employee.id === record.employee_id) ?? null
}

function recordMatchesDepartment(
  record: ShiftClock,
  employee: Employee | null | undefined,
  department: ReportDepartment,
  schedules: Schedule[] = []
) {
  return clockMatchesWorkDepartment(record, department, employee, schedules)
}

function getDailyWageDetail({
  emp,
  date,
  clockRecordsByEmployeeDate,
  employees,
  department,
  schedules,
  report,
  calculatedTip,
  savedTip,
  useCalculatedTips,
}: {
  emp: Employee
  date: string
  clockRecordsByEmployeeDate: Map<string, ShiftClock[]>
  employees: Employee[]
  department: ReportDepartment
  schedules: Schedule[]
  report?: ReturnType<typeof useEodReports>['eodReports'][number]
  calculatedTip?: DailyTipPreview
  savedTip?: SavedDailyTip
  useCalculatedTips: boolean
}): WageDetailRow | null {
  const matchingClockRecords = (clockRecordsByEmployeeDate.get(`${emp.id}:${date}`) ?? [])
    .filter(record => recordMatchesDepartment(record, getClockRecordEmployee(record, employees) ?? emp, department, schedules))
  const clockHours = matchingClockRecords.reduce((sum, record) => sum + getEffectiveClockHours(record), 0)
  const mealBreakMinutes = matchingClockRecords.reduce((sum, record) => sum + getMealBreakState(record).minutes, 0)
  const hasDepartmentClock = matchingClockRecords.length > 0
  const calculatedHours = calculatedTip?.hours ?? 0
  const savedHours = savedTip?.hours ?? 0
  const hours = useCalculatedTips
    ? (clockHours > 0 ? clockHours : hasDepartmentClock ? calculatedHours : 0)
    : (hasDepartmentClock && savedHours > 0 ? savedHours : clockHours)
  const tips = report
    ? hasDepartmentClock ? (useCalculatedTips ? (calculatedTip?.tips ?? 0) : (savedTip?.tips ?? 0)) : 0
    : 0

  if (hours <= 0 && tips <= 0) return null

  const baseWages = hours * Number(emp.hourly_wage ?? 0)
  const guaranteeTopUp = getDailyGuaranteeTopUp(emp, hours, tips)

  return {
    date,
    workDepartment: department !== 'all' ? department : (() => {
      const departments = new Set(matchingClockRecords.map(record => getClockWorkDepartment(record, emp, schedules)))
      return departments.size === 1 ? [...departments][0] : undefined
    })(),
    hours,
    mealBreakMinutes,
    tips,
    baseWages,
    guaranteeTopUp,
    commission: 0,
    deductions: 0,
    totalEarnings: baseWages + tips + guaranteeTopUp,
  }
}

export default function WageReportPage() {
  const employees = useEmployees({ includeArchived: true })
  const { eodReports } = useEodReports()
  const { clockRecords } = useClockRecords()
  const { payrollRuns } = usePayrollRuns()
  const { completions } = useTaskCompletions()
  const { roleDefinitions, departmentDefinitions } = useAppSettings()

  const [department, setDepartment] = useState<ReportDepartment>('all')
  const [period, setPeriod] = useState<ReportPeriod>('weekly')
  const [refDate, setRefDate] = useState(new Date())
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [view, setView] = useState<TipReportView>('earnings')
  const [employeeFilter, setEmployeeFilter] = useState('all')
  const [refreshing, setRefreshing] = useState(false)
  const [sheetSyncing, setSheetSyncing] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)
  const [detailEmployeeId, setDetailEmployeeId] = useState<string | null>(null)
  const [expandedDetailGroupKey, setExpandedDetailGroupKey] = useState<string | null>(null)
  const [emailingEmployeeId, setEmailingEmployeeId] = useState<string | null>(null)
  const [unmatchedOpen, setUnmatchedOpen] = useState(false)

  const [startDate, endDate] = useMemo(
    () => getReportRange(period, refDate, customStart, customEnd),
    [period, refDate, customStart, customEnd]
  )
  const scheduledDeptIds = useScheduledDepartmentIds(startDate, endDate)
  const schedules = useSchedulesByRange(startDate, endDate)
  const filteredEmployees = useMemo(
    () => employees.filter(employee => {
      if (department === 'all') return true
      const hasWorkedDepartment = clockRecords.some(record =>
        record.employee_id === employee.id &&
        record.session_date >= startDate &&
        record.session_date <= endDate &&
        recordMatchesDepartment(record, getClockRecordEmployee(record, employees) ?? employee, department, schedules)
      )
      if (hasWorkedDepartment) return true
      const dept = employee.primary_department ?? ''
      if (dept === 'hybrid' || dept === 'foh' || dept === 'boh') {
        const scheduled = scheduledDeptIds.get(department)
        return scheduled && scheduled.size > 0 ? scheduled.has(employee.id) : isEmployeeInDepartment(employee, department)
      }
      return isEmployeeInDepartment(employee, department)
    }),
    [clockRecords, department, employees, endDate, scheduledDeptIds, schedules, startDate]
  )
  const clockRecordsByDate = useMemo(() => {
    const grouped = new Map<string, ShiftClock[]>()
    for (const record of clockRecords) {
      const recordsForDate = grouped.get(record.session_date) ?? []
      recordsForDate.push(record)
      grouped.set(record.session_date, recordsForDate)
    }
    return grouped
  }, [clockRecords])

  const monthStart = format(new Date(`${startDate}T12:00:00`), 'yyyy-MM-01')
  const monthEnd = format(new Date(new Date(`${endDate}T12:00:00`).getFullYear(), new Date(`${endDate}T12:00:00`).getMonth() + 1, 0), 'yyyy-MM-dd')
  const monthSchedules = useSchedulesByRange(monthStart, monthEnd)

  const employeePerfStats = useMemo(() => {
    const filteredEmpIds = new Set(filteredEmployees.map(e => e.id))
    const monthCompletions = completions.filter(c =>
      c.session_date >= monthStart && c.session_date <= monthEnd &&
      filteredEmpIds.has(c.employee_id) && c.status !== 'incomplete'
    )
    const monthHoursByEmp = new Map<string, number>()
    const monthTipsByEmp = new Map<string, number>()
    const departmentEmployeeIdsByDate = new Map<string, Set<string>>()
    for (const r of clockRecords) {
      if (!filteredEmpIds.has(r.employee_id) || r.session_date < monthStart || r.session_date > monthEnd) continue
      if (!recordMatchesDepartment(r, getClockRecordEmployee(r, employees), department, monthSchedules)) continue
      monthHoursByEmp.set(r.employee_id, (monthHoursByEmp.get(r.employee_id) ?? 0) + getEffectiveClockHours(r))
      const employeeIds = departmentEmployeeIdsByDate.get(r.session_date) ?? new Set<string>()
      employeeIds.add(r.employee_id)
      departmentEmployeeIdsByDate.set(r.session_date, employeeIds)
    }
    for (const eod of eodReports) {
      if (eod.session_date < monthStart || eod.session_date > monthEnd) continue
      const calculatedTips = calculateDailyTipPreview({ employees, clockRecords: clockRecordsByDate.get(eod.session_date) ?? [], schedules: monthSchedules, report: eod })
      const savedTips = getSavedDailyTips(eod)
      const useCalculatedTips = shouldRecalculateTips(savedTips, calculatedTips)
      const dailyTips = useCalculatedTips ? calculatedTips : savedTips
      for (const [employeeId, tip] of dailyTips) {
        if (!filteredEmpIds.has(employeeId)) continue
        if (department !== 'all' && !departmentEmployeeIdsByDate.get(eod.session_date)?.has(employeeId)) continue
        monthTipsByEmp.set(employeeId, (monthTipsByEmp.get(employeeId) ?? 0) + tip.tips)
      }
    }
    // Build working dates per employee (for task completion rate)
    const workingDatesByEmp = new Map<string, Set<string>>()
    for (const r of clockRecords) {
      if (!filteredEmpIds.has(r.employee_id) || r.session_date < monthStart || r.session_date > monthEnd) continue
      if (!recordMatchesDepartment(r, getClockRecordEmployee(r, employees), department, monthSchedules)) continue
      if (!workingDatesByEmp.has(r.employee_id)) workingDatesByEmp.set(r.employee_id, new Set())
      workingDatesByEmp.get(r.employee_id)!.add(r.session_date)
    }
    // Daily total task map
    const dailyTotalTaskMap = new Map<string, number>()
    for (const c of monthCompletions) {
      dailyTotalTaskMap.set(c.session_date, (dailyTotalTaskMap.get(c.session_date) ?? 0) + 1)
    }

    const base = filteredEmployees.map(emp => {
      const tasks = monthCompletions.filter(c => c.employee_id === emp.id).length
      const hrs = monthHoursByEmp.get(emp.id) ?? 0
      const totalTips = monthTipsByEmp.get(emp.id) ?? 0
      const workingDates = workingDatesByEmp.get(emp.id)
      let taskCompletionRate = 0
      if (workingDates && workingDates.size > 0) {
        let total = 0
        for (const date of workingDates) {
          const myTasks = monthCompletions.filter(c => c.employee_id === emp.id && c.session_date === date).length
          const dayTotal = dailyTotalTaskMap.get(date) ?? 0
          total += dayTotal > 0 ? myTasks / dayTotal : 0
        }
        taskCompletionRate = total / workingDates.size
      }
      return { empId: emp.id, tasks, hours: hrs, totalTips, taskCompletionRate, taskRate: hrs > 0 ? tasks / hrs : 0, tipRate: hrs > 0 ? totalTips / hrs : 0 }
    }).filter(item => item.tasks > 0 || item.hours > 0)

    const completionRateRM = getRankMap(base.filter(i => (workingDatesByEmp.get(i.empId)?.size ?? 0) > 0), i => i.taskCompletionRate, i => i.empId)
    const rateRM = getRankMap(base.filter(i => i.hours > 0), i => i.taskRate, i => i.empId)
    const tipRM = getRankMap(base.filter(i => i.hours > 0), i => i.tipRate, i => i.empId)

    const scored = base.map(item => {
      const completionRateRank = completionRateRM.get(item.empId) ?? 1
      const rateRank = rateRM.get(item.empId) ?? 1
      const tipRank = tipRM.get(item.empId) ?? 1
      return {
        ...item,
        score: Math.round(
          scoreFromRank(completionRateRank, Math.max(completionRateRM.size, 1)) * 0.40 +
          scoreFromRank(rateRank, Math.max(rateRM.size, 1)) * 0.35 +
          scoreFromRank(tipRank, Math.max(tipRM.size, 1)) * 0.25
        ),
      }
    }).sort((a, b) => b.score - a.score || b.tasks - a.tasks)

    return new Map(scored.map((item, idx) => [item.empId, { ...item, overallRank: idx + 1, staffCount: scored.length }]))
  }, [clockRecords, clockRecordsByDate, completions, department, employees, eodReports, filteredEmployees, monthEnd, monthSchedules, monthStart])

  const matchingPayrollRun = useMemo(() => {
    const exactDepartment = payrollRuns.find(run => (
      run.start_date === startDate &&
      run.end_date === endDate &&
      run.department === department
    ))
    if (exactDepartment) return exactDepartment
    return payrollRuns.find(run => (
      run.start_date === startDate &&
      run.end_date === endDate &&
      run.department === 'all'
    )) ?? null
  }, [department, endDate, payrollRuns, startDate])

  const periodPayrollRuns = useMemo(() => payrollRuns.filter(run => {
    const periodOverlaps = run.start_date <= endDate && run.end_date >= startDate
    if (!periodOverlaps) return false
    if (department === 'all') return true
    return run.department === department || run.department === 'all'
  }), [department, endDate, payrollRuns, startDate])

  const todayDate = format(new Date(), 'yyyy-MM-dd')
  const completedPayrollRuns = useMemo(
    () => periodPayrollRuns.filter(run => run.pay_date <= todayDate),
    [periodPayrollRuns, todayDate]
  )

  // Wage records from before the worksheet rollout have no payroll_run to match,
  // but were already paid through the legacy workflow. Do not count those as unpaid.
  const legacyWageCutoffDate = useMemo(() => {
    const firstWorksheetRun = payrollRuns
      .filter(run => run.pay_date <= todayDate)
      .filter(run => (run.payroll_run_items ?? []).length > 0)
      .reduce<string | null>((earliest, run) => {
        if (!earliest || run.start_date < earliest) return run.start_date
        return earliest
      }, null)
    return firstWorksheetRun
  }, [payrollRuns, todayDate])

  const detailRowsByEmployeeId = useMemo(() => {
    const rangeReports = eodReports.filter(report => report.session_date >= startDate && report.session_date <= endDate)
    const reportByDate = new Map(rangeReports.map(report => [report.session_date, report]))
    const savedTipsByDate = new Map(rangeReports.map(report => [report.session_date, getSavedDailyTips(report)]))
    const calculatedTipsByDate = new Map(
      rangeReports.map(report => [report.session_date, calculateDailyTipPreview({
        employees,
        clockRecords: clockRecordsByDate.get(report.session_date) ?? [],
        schedules,
        report,
      })])
    )
    const datesUsingCalculatedTips = new Set(
      rangeReports
        .filter(report => shouldRecalculateTips(
          savedTipsByDate.get(report.session_date) ?? new Map(),
          calculatedTipsByDate.get(report.session_date) ?? new Map()
        ))
        .map(report => report.session_date)
    )

    const clockRecordsByEmployeeDate = new Map<string, ShiftClock[]>()
    for (const record of clockRecords) {
      const key = `${record.employee_id}:${record.session_date}`
      const recordsForEmployeeDate = clockRecordsByEmployeeDate.get(key) ?? []
      recordsForEmployeeDate.push(record)
      clockRecordsByEmployeeDate.set(key, recordsForEmployeeDate)
    }
    const savedTipDatesByEmployee = new Map<string, Set<string>>()
    const calculatedTipDatesByEmployee = new Map<string, Set<string>>()
    for (const [date, tips] of savedTipsByDate) {
      for (const employeeId of tips.keys()) {
        const dates = savedTipDatesByEmployee.get(employeeId) ?? new Set<string>()
        dates.add(date)
        savedTipDatesByEmployee.set(employeeId, dates)
      }
    }
    for (const [date, tips] of calculatedTipsByDate) {
      for (const employeeId of tips.keys()) {
        const dates = calculatedTipDatesByEmployee.get(employeeId) ?? new Set<string>()
        dates.add(date)
        calculatedTipDatesByEmployee.set(employeeId, dates)
      }
    }
    const clockDatesByEmployee = new Map<string, Set<string>>()
    for (const record of clockRecords) {
      if (record.session_date < startDate || record.session_date > endDate) continue
      const employee = getClockRecordEmployee(record, employees)
      if (!employee || !recordMatchesDepartment(record, employee, department, schedules)) continue
      const dates = clockDatesByEmployee.get(record.employee_id) ?? new Set<string>()
      dates.add(record.session_date)
      clockDatesByEmployee.set(record.employee_id, dates)
    }

    const detailMap = new Map(
      filteredEmployees.map(emp => {
        const employeeDates = new Set<string>([
          ...(savedTipDatesByEmployee.get(emp.id) ?? []),
          ...(calculatedTipDatesByEmployee.get(emp.id) ?? []),
          ...(clockDatesByEmployee.get(emp.id) ?? []),
        ])

        const detailRows = [...employeeDates]
          .map(date => getDailyWageDetail({
            emp,
            date,
            clockRecordsByEmployeeDate,
            employees,
            department,
            schedules,
            report: reportByDate.get(date),
            calculatedTip: calculatedTipsByDate.get(date)?.get(emp.id),
            savedTip: savedTipsByDate.get(date)?.get(emp.id),
            useCalculatedTips: datesUsingCalculatedTips.has(date),
          }))
          .filter((row): row is WageDetailRow => row !== null)

        detailRows.sort((a, b) => b.date.localeCompare(a.date))
        return [emp.id, detailRows] as const
      })
    )

    for (const run of completedPayrollRuns) {
      for (const item of run.payroll_run_items ?? []) {
        if (department !== 'all' && item.department !== department) continue
        const key = item.employee_id ?? item.id
        const existingDetails = detailMap.get(key) ?? []
        if (existingDetails.some(detail => !detail.sourceRunId)) continue
        const savedAmount = Number(item.hours ?? 0) + Number(item.tips ?? 0) + Number(item.base_wages ?? 0) + Number(item.guarantee_top_up ?? 0) + Number(item.commission ?? 0)
        if (savedAmount <= 0) continue
        detailMap.set(key, [...existingDetails, {
          date: run.pay_date,
          sourceRunId: run.id,
          workDepartment: item.department,
          hours: Number(item.hours ?? 0),
          mealBreakMinutes: 0,
          tips: Number(item.tips ?? 0),
          baseWages: Number(item.base_wages ?? 0),
          guaranteeTopUp: Number(item.guarantee_top_up ?? 0),
          commission: Number(item.commission ?? 0),
          deductions: Number(item.deductions ?? 0),
          totalEarnings: Number(item.net_pay ?? item.payout_amount ?? 0),
        }])
      }
    }

    return detailMap
  }, [clockRecords, clockRecordsByDate, completedPayrollRuns, department, employees, eodReports, filteredEmployees, endDate, schedules, startDate])

  const rows = useMemo(() => {
    const savedItems = completedPayrollRuns.flatMap(run => (run.payroll_run_items ?? [])
      .filter(item => department === 'all' || item.department === department)
      .map(item => ({ ...item, runId: run.id })))
    const savedItemsByEmployee = new Map<string, typeof savedItems[number]>()
    const paymentBreakdownsByEmployee = new Map<string, Record<ReportPaymentMethod, number>>()
    for (const item of savedItems) {
      const key = item.employee_id ?? item.employee_name
      const itemBreakdown = item.payment_method
        ? getPayrollPaymentBreakdown({
          payment_method: item.payment_method,
          commission_payment_method: item.commission_payment_method,
          commission: Number(item.commission ?? 0),
          net_pay: Number(item.net_pay ?? item.payout_amount ?? 0),
          payment_allocations: item.payment_allocations,
        })
        : null
      const currentBreakdown = paymentBreakdownsByEmployee.get(key) ?? { cash: 0, check: 0, ach: 0, unknown: 0 }
      paymentBreakdownsByEmployee.set(key, {
        cash: normalizeMoney(currentBreakdown.cash + Number(itemBreakdown?.cash ?? 0)),
        check: normalizeMoney(currentBreakdown.check + Number(itemBreakdown?.check ?? 0)),
        ach: normalizeMoney(currentBreakdown.ach + Number(itemBreakdown?.ach ?? 0)),
        unknown: normalizeMoney(currentBreakdown.unknown + (itemBreakdown ? 0 : Number(item.payout_amount ?? 0))),
      })
      const current = savedItemsByEmployee.get(key)
      if (!current) {
        savedItemsByEmployee.set(key, { ...item })
        continue
      }
      savedItemsByEmployee.set(key, {
        ...current,
        hours: Number(current.hours ?? 0) + Number(item.hours ?? 0),
        tips: Number(current.tips ?? 0) + Number(item.tips ?? 0),
        base_wages: Number(current.base_wages ?? 0) + Number(item.base_wages ?? 0),
        guarantee_top_up: Number(current.guarantee_top_up ?? 0) + Number(item.guarantee_top_up ?? 0),
        commission: Number(current.commission ?? 0) + Number(item.commission ?? 0),
        deductions: Number(current.deductions ?? 0) + Number(item.deductions ?? 0),
        payout_amount: Number(current.payout_amount ?? 0) + Number(item.payout_amount ?? 0),
        net_pay: Number(current.net_pay ?? 0) + Number(item.net_pay ?? 0),
      })
    }

    const paidRows: WageSummaryRow[] = [...savedItemsByEmployee.values()].map(item => {
          const existingEmployee = employees.find(employee => employee.id === item.employee_id)
          const emp: Employee = existingEmployee ?? {
            id: item.employee_id ?? item.id,
            name: item.employee_name,
            phone: null,
            email: null,
            role: item.role ?? 'staff',
            primary_department: item.department,
            schedule_departments: [item.department],
            hourly_wage: null,
            guaranteed_hourly: null,
            tip_pool_hourly_rate: null,
            payment_method: item.payment_method,
            birth_date: null,
            login_enabled: false,
            is_active: true,
            created_at: item.created_at,
          }
          const matchingClocks = clockRecords.filter(
            record =>
              record.employee_id === emp.id &&
              record.session_date >= startDate &&
              record.session_date <= endDate &&
              recordMatchesDepartment(record, getClockRecordEmployee(record, employees) ?? emp, department, schedules)
          )
          return {
            emp,
            hours: Number(item.hours ?? 0),
            mealBreakMinutes: matchingClocks.reduce((sum, record) => sum + getMealBreakState(record).minutes, 0),
            tips: Number(item.tips ?? 0),
            baseWages: Number(item.base_wages ?? 0),
            guaranteeTopUp: Number(item.guarantee_top_up ?? 0),
            commission: Number(item.commission ?? 0),
            deductions: Number(item.deductions ?? 0),
            totalEarnings: Number(item.net_pay ?? item.payout_amount ?? 0),
            tipRate: Number(item.hours ?? 0) > 0 ? Number(item.tips ?? 0) / Number(item.hours ?? 0) : null,
            effectiveRate: Number(item.hours ?? 0) > 0 ? Number(item.net_pay ?? item.payout_amount ?? 0) / Number(item.hours ?? 0) : null,
            paymentMethod: getReportPaymentMethod(item.payment_method),
            paymentBreakdown: paymentBreakdownsByEmployee.get(item.employee_id ?? item.employee_name) ?? { cash: 0, check: 0, ach: 0, unknown: Number(item.payout_amount ?? 0) },
            hasAutoClockOut: matchingClocks.some(record => record.auto_clock_out),
            hasOpenClock: matchingClocks.some(record => !record.clock_out_at || isClockPending(record)),
            hasMissingMealBreak: matchingClocks.some(record => shouldWarnMissingMealBreak(record, emp)),
          }
        })

    const previewRows: WageSummaryRow[] = filteredEmployees
      .map(emp => {
        const detailRows = (detailRowsByEmployeeId.get(emp.id) ?? []).filter(detail =>
          !completedPayrollRuns.some(run => wageDetailMatchesPayroll(detail, emp.id, run, department)))
        const hours = detailRows.reduce((sum, row) => sum + row.hours, 0)
        const tips = detailRows.reduce((sum, row) => sum + row.tips, 0)
        const mealBreakMinutes = detailRows.reduce((sum, row) => sum + row.mealBreakMinutes, 0)
        const baseWages = detailRows.reduce((sum, row) => sum + row.baseWages, 0)
        const guaranteeTopUp = detailRows.reduce((sum, row) => sum + row.guaranteeTopUp, 0)
        const totalEarnings = detailRows.reduce((sum, row) => sum + row.totalEarnings, 0)
        const matchingClocks = clockRecords.filter(
          record =>
            record.employee_id === emp.id &&
            record.session_date >= startDate &&
            record.session_date <= endDate &&
            recordMatchesDepartment(record, getClockRecordEmployee(record, employees) ?? emp, department, schedules)
        )

        return {
          emp,
          hours,
          mealBreakMinutes,
          tips,
          baseWages,
          guaranteeTopUp,
          commission: 0,
          deductions: 0,
          totalEarnings,
          pendingEarnings: normalizeMoney(detailRows.filter(detail => !legacyWageCutoffDate || detail.date >= legacyWageCutoffDate).reduce((sum, detail) => sum + detail.totalEarnings, 0)),
          legacyEarnings: normalizeMoney(detailRows.filter(detail => legacyWageCutoffDate && detail.date < legacyWageCutoffDate).reduce((sum, detail) => sum + detail.totalEarnings, 0)),
          tipRate: hours > 0 ? tips / hours : null,
          effectiveRate: hours > 0 ? totalEarnings / hours : null,
          paymentMethod: getReportPaymentMethod(emp.payment_method),
          paymentBreakdown: {
            cash: 0, check: 0, ach: 0, unknown: 0,
          },
          hasAutoClockOut: matchingClocks.some(record => record.auto_clock_out),
          hasOpenClock: matchingClocks.some(record => !record.clock_out_at || isClockPending(record)),
          hasMissingMealBreak: matchingClocks.some(record => shouldWarnMissingMealBreak(record, emp)),
        }
      })
      .filter(row => row.hours > 0 || row.tips > 0 || row.baseWages > 0)
    const combined = new Map(paidRows.map(row => [row.emp.id, row]))
    for (const preview of previewRows) {
      const paid = combined.get(preview.emp.id)
      if (!paid) { combined.set(preview.emp.id, preview); continue }
      const merged = { ...paid, pendingEarnings: preview.pendingEarnings, legacyEarnings: preview.legacyEarnings }
      for (const key of ['hours', 'mealBreakMinutes', 'tips', 'baseWages', 'guaranteeTopUp', 'commission', 'deductions', 'totalEarnings'] as const) merged[key] = paid[key] + preview[key]
      merged.tipRate = merged.hours > 0 ? merged.tips / merged.hours : null
      merged.effectiveRate = merged.hours > 0 ? merged.totalEarnings / merged.hours : null
      combined.set(preview.emp.id, merged)
    }
    return [...combined.values()]
  }, [clockRecords, completedPayrollRuns, department, detailRowsByEmployeeId, employees, filteredEmployees, endDate, legacyWageCutoffDate, schedules, startDate])

  const buildWageReportHtml = (row: WageSummaryRow) => {
    const details = detailRowsByEmployeeId.get(row.emp.id) ?? []
    return `
      <h1>${row.emp.name} Wage Report</h1>
      <p class="muted">${startDate === endDate ? startDate : `${startDate} - ${endDate}`}</p>
      <p class="muted">Summary: full saved pay periods plus unmatched work in the selected dates. Daily rows use clock/EOD calculations; saved salary, commissions, and adjustments may differ. Snapshot-only rows are dated by pay date.</p>
      <div class="summary">
        <div class="card"><strong>Hours</strong><div class="metric">${row.hours.toFixed(2)} hrs</div></div>
        <div class="card"><strong>Paid By</strong><div class="metric">${formatPaymentBreakdown(row.paymentBreakdown)}</div></div>
        <div class="card"><strong>Tips</strong><div class="metric">${formatCurrency(row.tips)}</div></div>
        ${view === 'earnings' ? `<div class="card"><strong>Base Wages</strong><div class="metric">${formatCurrency(row.baseWages)}</div></div>` : ''}
        ${view === 'earnings' ? `<div class="card"><strong>Commission</strong><div class="metric">${formatCurrency(row.commission)}</div></div>` : ''}
        ${view === 'earnings' ? `<div class="card"><strong>Deductions</strong><div class="metric">${formatCurrency(row.deductions)}</div></div>` : ''}
        ${view === 'earnings' ? `<div class="card"><strong>Total Earnings</strong><div class="metric">${formatCurrency(row.totalEarnings)}</div></div>` : ''}
      </div>
      <h3>Comp Summary</h3>
      <p>
        Included saved pay periods and unmatched work total ${row.hours.toFixed(2)} hours and ${formatCurrency(row.tips)} in tips for ${row.emp.name}.
        ${view === 'earnings' ? ` Combined wages and guaranteed top-up brought total earnings to ${formatCurrency(row.totalEarnings)}.` : ''}
      </p>
      <table class="compact-table">
        <thead>
          <tr>
            <th>Date</th>
            <th class="right">Hours</th>
            <th class="right">Meal Break</th>
            <th class="right">Tips</th>
            ${view === 'earnings' ? '<th class="right">Base Wages</th><th class="right">Top-Up</th><th class="right">Commission</th><th class="right">Total</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${details.map(detail => `
            <tr>
              <td>${detail.date}</td>
              <td class="right">${detail.hours.toFixed(2)}</td>
              <td class="right">${formatMealBreakMinutes(detail.mealBreakMinutes)}</td>
              <td class="right">${formatCurrency(detail.tips)}</td>
              ${view === 'earnings' ? `<td class="right">${formatCurrency(detail.baseWages)}</td><td class="right">${formatCurrency(detail.guaranteeTopUp)}</td><td class="right">${formatCurrency(detail.commission)}</td><td class="right">${formatCurrency(detail.totalEarnings)}</td>` : ''}
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
  const displayedPaymentTotals = useMemo(
    () => displayedRows.reduce<Record<ReportPaymentMethod, number>>((totals, row) => {
      totals.cash += row.paymentBreakdown.cash
      totals.check += row.paymentBreakdown.check
      totals.ach += row.paymentBreakdown.ach
      totals.unknown += row.paymentBreakdown.unknown
      return totals
    }, { cash: 0, check: 0, ach: 0, unknown: 0 }),
    [displayedRows]
  )
  const unpaidTotal = useMemo(() => {
    return normalizeMoney(displayedRows.reduce((sum, row) => sum + (row.pendingEarnings ?? 0), 0))
  }, [displayedRows])
  const wageReconciliation = useMemo(() => reconcileWageRows(displayedRows), [displayedRows])
  const scopedPayrollRuns = completedPayrollRuns.filter(run => (run.payroll_run_items ?? []).some(item =>
    (department === 'all' || item.department === department)
    && (employeeFilter === 'all' || item.employee_id === employeeFilter)))
  const hasMatchingScopedRun = matchingPayrollRun && scopedPayrollRuns.some(run => run.id === matchingPayrollRun.id)
  const payoutStatus = hasMatchingScopedRun && unpaidTotal === 0
    ? 'created' : scopedPayrollRuns.length > 0 ? 'partial' : 'preview'
  const payoutStatusTotals = { ...displayedPaymentTotals, net: wageReconciliation.recordedPayout }
  const boundaryPayrollRuns = scopedPayrollRuns.filter(run => run.start_date < startDate || run.end_date > endDate)
  const unmatchedDetails = displayedRows.flatMap(row => (detailRowsByEmployeeId.get(row.emp.id) ?? [])
    .filter(detail => (!legacyWageCutoffDate || detail.date >= legacyWageCutoffDate)
      && !completedPayrollRuns.some(run => wageDetailMatchesPayroll(detail, row.emp.id, run, department)))
    .map(detail => ({ ...detail, employee: row.emp.name })))
  const tipSummary = useMemo(() => summarizeRestaurantTips({
    reports: eodReports, employees, clocks: clockRecords, schedules, startDate, endDate,
  }), [eodReports, employees, clockRecords, schedules, startDate, endDate])
  const detailTarget = displayedRows.find(row => row.emp.id === detailEmployeeId) ?? null
  const detailRows = useMemo(
    () => detailTarget ? (detailRowsByEmployeeId.get(detailTarget.emp.id) ?? []) : [],
    [detailRowsByEmployeeId, detailTarget]
  )
  const detailPayoutGroups = useMemo(() => {
    if (!detailTarget) return []
    const assignedDates = new Set<string>()
    const detailKey = (detail: WageDetailRow) => `${detail.date}|${detail.workDepartment ?? 'all'}|${detail.sourceRunId ?? ''}`
    const paidGroups = [...completedPayrollRuns]
      .filter(run => (run.payroll_run_items ?? []).some(item => item.employee_id === detailTarget.emp.id))
      .sort((left, right) => right.pay_date.localeCompare(left.pay_date))
      .map(run => {
        const groupRows = detailRows.filter(detail => wageDetailMatchesPayroll(detail, detailTarget.emp.id, run, department) && !assignedDates.has(detailKey(detail)))
        groupRows.forEach(detail => assignedDates.add(detailKey(detail)))
        return {
          key: run.id,
          title: `Pay date ${formatReportDate(run.pay_date)}`,
          subtitle: `${formatReportDate(run.start_date)} – ${formatReportDate(run.end_date)}`,
          paid: true,
          rows: groupRows,
        }
      })
      .filter(group => group.rows.length > 0)
    const unpaidRows = detailRows.filter(detail => !assignedDates.has(detailKey(detail)))
    const legacyRows = legacyWageCutoffDate
      ? unpaidRows.filter(detail => detail.date < legacyWageCutoffDate)
      : []
    const currentUnpaidRows = unpaidRows.filter(detail => !legacyRows.some(row => row.date === detail.date))
    const legacyGroup = legacyRows.length > 0
      ? [{ key: 'legacy-paid', title: 'Legacy paid', subtitle: 'Recorded before payroll worksheet tracking began', paid: true, rows: legacyRows }]
      : []
    return currentUnpaidRows.length > 0
      ? [{ key: 'unpaid', title: 'Unmatched Earnings', subtitle: 'Work not matched to a saved payout; review before paying', paid: false, rows: currentUnpaidRows }, ...legacyGroup, ...paidGroups]
      : [...legacyGroup, ...paidGroups]
  }, [completedPayrollRuns, department, detailRows, detailTarget, legacyWageCutoffDate])
  const selectedEmployeeName = employeeFilter === 'all'
    ? 'All Staff'
    : filteredEmployees.find(employee => employee.id === employeeFilter)?.name ?? 'Select staff'

  const handleExcelExport = async (exportRows = displayedRows, staff = selectedEmployeeName) => {
    setExportingExcel(true)
    setRefreshMessage(null)
    try {
      const earningsColumns: ExcelColumn[] = view === 'earnings' ? [
        { label: 'Base Wages', format: 'money' }, { label: 'Guaranteed Top-Up', format: 'money' },
        { label: 'Commission', format: 'money' }, { label: 'Deductions', format: 'money' },
        { label: 'Total Earnings', format: 'money' },
      ] : []
      const metadata: ExcelReportSheet['metadata'] = [
        ['Work Period', `${startDate} to ${endDate}`],
        ['Department', getDepartmentLabel(department, departmentDefinitions)], ['Staff', staff],
        ['View', view === 'earnings' ? 'Earnings' : 'Tip Only'],
        ['Payout Status', payoutStatus === 'created' ? 'Payout Created' : payoutStatus === 'partial' ? 'Partial Payout Created' : 'Preview Only'],
        ['Summary Basis', 'Full saved pay-period snapshots plus unmatched work in the selected dates. Saved periods may cross the selected range.'],
        ['Daily Details Basis', 'Clock/EOD calculations in the selected work dates; saved salary, commissions, and adjustments may differ.'],
      ]
      const paymentMethods = (row: WageSummaryRow) => (['cash', 'check', 'ach', 'unknown'] as const)
        .filter(method => row.paymentBreakdown[method] > 0)
        .map(method => method === 'unknown' ? 'Unknown' : paymentMethodLabel(method))
        .join(' + ') || 'Not recorded'
      await exportReportToExcel(`wage_report_${view}_${department}_${staff}_${startDate}_${endDate}`, [
        {
          name: 'Wage Summary', title: 'Wage Report', metadata,
          columns: [
            { label: 'Name' }, { label: 'Role' }, { label: 'Paid By' },
            { label: 'Cash Amount', format: 'money' }, { label: 'Check Amount', format: 'money' },
            { label: 'ACH Amount', format: 'money' }, { label: 'Unknown Amount', format: 'money' },
            { label: 'Clock Status' },
            { label: 'Hours', format: 'decimal' }, { label: 'Meal Break (minutes)', format: 'integer' },
            { label: 'Tips', format: 'money' }, { label: 'Tips / Hr', format: 'money', total: false },
            ...earningsColumns,
          ],
          rows: exportRows.map(row => [
            row.emp.name, getRoleLabel(row.emp.role, roleDefinitions), paymentMethods(row),
            row.paymentBreakdown.cash, row.paymentBreakdown.check, row.paymentBreakdown.ach, row.paymentBreakdown.unknown,
            row.hasOpenClock ? 'Clock Out Needed' : row.hasAutoClockOut ? 'Auto Clock-Out' : 'Verified',
            row.hours, row.mealBreakMinutes, row.tips, row.tipRate,
            ...(view === 'earnings' ? [row.baseWages, row.guaranteeTopUp, row.commission, row.deductions, row.totalEarnings] : []),
          ]),
        },
        {
          name: 'Daily Details', title: 'Wage Report — Daily Details', metadata,
          columns: [
            { label: 'Name' }, { label: 'Date' }, { label: 'Hours', format: 'decimal' },
            { label: 'Meal Break (minutes)', format: 'integer' }, { label: 'Tips', format: 'money' }, ...earningsColumns, { label: 'Source' },
          ],
          rows: exportRows.flatMap(row => (detailRowsByEmployeeId.get(row.emp.id) ?? []).map(detail => [
            row.emp.name, detail.date, detail.hours, detail.mealBreakMinutes, detail.tips,
            ...(view === 'earnings' ? [detail.baseWages, detail.guaranteeTopUp, detail.commission, detail.deductions, detail.totalEarnings] : []),
            detail.sourceRunId ? 'Saved payroll snapshot (pay date)' : 'Clock / EOD (work date)',
          ])),
        },
      ])
    } catch (error) {
      setRefreshMessage(error instanceof Error ? error.message : 'Failed to export wage report to Excel.')
    } finally {
      setExportingExcel(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    setRefreshMessage(null)
    notifyReportingDataChanged()
    await new Promise(resolve => window.setTimeout(resolve, 350))
    setLastRefreshedAt(new Date())
    setRefreshMessage('Reloaded clock records and tip distributions.')
    setRefreshing(false)
  }

  const handleSheetSync = async () => {
    setSheetSyncing(true)
    setRefreshMessage(null)
    try {
      const res = await fetch('/api/wage-sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: startDate,
          end_date: endDate,
          view,
        }),
      })
      const payload = (await res.json().catch(() => ({}))) as { error?: string; rowCount?: number }
      if (!res.ok) throw new Error(payload.error ?? 'Failed to sync wage report to Google Sheets')
      setRefreshMessage(`Wage report synced to Google Sheets${typeof payload.rowCount === 'number' ? ` (${payload.rowCount} rows)` : ''}.`)
    } catch (error) {
      setRefreshMessage(error instanceof Error ? error.message : 'Failed to sync wage report to Google Sheets')
    } finally {
      setSheetSyncing(false)
    }
  }

  return (
    <div className="relative left-1/2 w-[calc(100vw-1rem)] max-w-[1800px] -translate-x-1/2 p-4 sm:w-[calc(100vw-2rem)] sm:p-6">
      <AdminSubpageHeader
        title="Wage Report"
        subtitle="Reconcile saved pay periods, recorded payouts, and unmatched work."
        backHref="/admin"
        backLabel="Back to Admin Board"
      />
      <ReportingNav />
      <MissingTipDistributionNotice reports={eodReports} startDate={startDate} endDate={endDate} />
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
          showYearly
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
                <SelectTrigger className="w-44">
                  <span className={employeeFilter === 'all' ? '' : 'truncate'}>{selectedEmployeeName}</span>
                </SelectTrigger>
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
              <Button variant="outline" size="sm" onClick={() => void handleExcelExport()} disabled={exportingExcel || displayedRows.length === 0}>
                {exportingExcel ? 'Exporting…' : 'Export Excel'}
              </Button>
              {lastRefreshedAt && (
                <span className="text-xs text-muted-foreground">
                  Updated {formatDistanceToNow(lastRefreshedAt, { addSuffix: true })}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={handleSheetSync} disabled={sheetSyncing}>
                {sheetSyncing ? 'Syncing Sheet...' : 'Sync Sheet'}
              </Button>
              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </Button>
            </>
          }
        />
        <p className="mb-4 text-xs text-muted-foreground">
          Saved payroll amounts keep their full pay-period snapshots. Unmatched work uses the selected dates. Paid By shows recorded payouts after cash rounding; Total Earnings is before rounding.
        </p>
        {boundaryPayrollRuns.length > 0 && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-medium">Saved pay periods cross this date range</p>
          <p>Table totals include these full saved periods, not a prorated calendar-month amount: {boundaryPayrollRuns.map(run => `${formatReportDate(run.start_date)}–${formatReportDate(run.end_date)}`).join(', ')}.</p>
          <p className="mt-1 text-xs">The restaurant tip cards below use only {startDate} through {endDate}. Saved payroll tips can therefore differ.</p>
        </div>}
        <div className={[
          'mb-4 rounded-xl border px-4 py-3',
          payoutStatus === 'created' ? 'border-emerald-200 bg-emerald-50' : payoutStatus === 'partial' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50',
        ].join(' ')}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className={[
                'text-xs font-semibold uppercase',
                payoutStatus === 'created' ? 'text-emerald-700' : payoutStatus === 'partial' ? 'text-amber-700' : 'text-slate-500',
              ].join(' ')}>
                Payout Status
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {payoutStatus === 'created' ? (
                  <Badge variant="outline" className="border-emerald-300 bg-white text-emerald-800">Payout Created</Badge>
                ) : payoutStatus === 'partial' ? (
                  <Badge variant="outline" className="border-amber-300 bg-white text-amber-800">Partial Payout Created</Badge>
                ) : (
                  <Badge variant="outline" className="border-slate-300 bg-white text-slate-700">Preview Only</Badge>
                )}
                <span className="text-sm font-medium text-slate-950">
                  {payoutStatus === 'created'
                    ? 'This report is using a saved Wage Worksheet payout.'
                    : payoutStatus === 'partial'
                      ? 'Saved payouts are shown with any unmatched work in the selected dates.'
                      : 'This is calculated from clock records, EOD tips, and staffing settings. No payout has been saved yet.'}
                </span>
              </div>
              {matchingPayrollRun && hasMatchingScopedRun ? (
                <p className="mt-1 text-xs text-slate-600">
                  Run created {format(new Date(matchingPayrollRun.created_at), 'MMM d, yyyy h:mm a')} · Pay date {matchingPayrollRun.pay_date} · {matchingPayrollRun.department === 'all' ? 'All Staff' : matchingPayrollRun.department}
                </p>
              ) : scopedPayrollRuns.length > 0 ? (
                <p className="mt-1 text-xs text-slate-600">
                  Included saved periods: {scopedPayrollRuns.map(run => `${run.department} ${formatReportDate(run.start_date)}–${formatReportDate(run.end_date)}`).join(', ')}
                </p>
              ) : periodPayrollRuns.some(run => run.pay_date > todayDate && (run.payroll_run_items ?? []).some(item => employeeFilter === 'all' || item.employee_id === employeeFilter)) ? (
                <p className="mt-1 text-xs text-slate-600">Payroll runs are pending their pay date. Daily earnings remain pending until payday.</p>
              ) : (
                <p className="mt-1 text-xs text-slate-600">Save from Wage Worksheet when payroll is actually paid or ready to record.</p>
              )}
            </div>
            {payoutStatus !== 'preview' && (
              <div className="grid grid-cols-2 gap-2 text-right sm:grid-cols-4 lg:min-w-[480px]">
                <div className="rounded-lg border bg-white px-3 py-2">
                  <p className="text-[11px] font-medium uppercase text-slate-500">Cash</p>
                  <p className="font-semibold text-slate-950">{formatCurrency(payoutStatusTotals.cash)}</p>
                </div>
                <div className="rounded-lg border bg-white px-3 py-2">
                  <p className="text-[11px] font-medium uppercase text-slate-500">Check</p>
                  <p className="font-semibold text-slate-950">{formatCurrency(payoutStatusTotals.check)}</p>
                </div>
                <div className="rounded-lg border bg-white px-3 py-2">
                  <p className="text-[11px] font-medium uppercase text-slate-500">ACH</p>
                  <p className="font-semibold text-slate-950">{formatCurrency(payoutStatusTotals.ach)}</p>
                </div>
                <div className="rounded-lg border bg-white px-3 py-2">
                  <p className="text-[11px] font-medium uppercase text-slate-500">Recorded Payout</p>
                  <p className="font-semibold text-slate-950">{formatCurrency(payoutStatusTotals.net)}</p>
                </div>
              </div>
            )}
          </div>
        </div>
        <p className="mb-2 text-sm font-semibold">Restaurant tip allocation · All departments · {startDate} to {endDate}</p>
        <p className="mb-3 text-xs text-muted-foreground">These EOD totals stay the same when filtering employees or departments. They are allocations, not payroll payments.</p>
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border bg-emerald-50 p-3">
            <p className="text-xs font-medium uppercase text-emerald-700">Total Tip Collected</p>
            <p className="mt-1 text-xl font-bold text-emerald-950">{formatCurrency(tipSummary.totalCollected)}</p>
            <p className="mt-0.5 text-[11px] text-emerald-700">EOD total tips in range</p>
          </div>
          <div className="rounded-lg border bg-slate-50 p-3">
            <p className="text-xs font-medium uppercase text-slate-500">House Tips Allocated</p>
            <p className="mt-1 text-xl font-bold text-slate-950">{formatCurrency(tipSummary.houseTip)}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">Saved house deductions; 15% for unsaved previews</p>
          </div>
          <div className="rounded-lg border bg-blue-50 p-3">
            <p className="text-xs font-medium uppercase text-blue-700">Staff Tips Allocated</p>
            <p className="mt-1 text-xl font-bold text-blue-950">{formatCurrency(tipSummary.totalTipOut)}</p>
            <p className="mt-0.5 text-[11px] text-blue-700">All staff EOD allocations in the selected dates</p>
          </div>
          <div className="rounded-lg border bg-violet-50 p-3">
            <p className="text-xs font-medium uppercase text-violet-700">Distribution Summary</p>
            <p className="mt-1 text-xl font-bold text-violet-950">{formatCurrency(tipSummary.distributionTotal)}</p>
            <p className="mt-0.5 text-[11px] text-violet-700">House + staff allocations, all departments</p>
          </div>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">Collected minus allocated: {formatCurrency(tipSummary.difference)}. {tipSummary.difference !== 0 ? 'Review unallocated tips or rounding in Tip Distribution Editor.' : 'Restaurant tip allocations reconcile.'}</p>
        <p className="mb-2 text-sm font-semibold">Selected payroll · {getDepartmentLabel(department, departmentDefinitions)} · {selectedEmployeeName}</p>
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border bg-emerald-50 p-3">
            <p className="text-xs font-medium uppercase text-emerald-700">Cash Pay Out</p>
            <p className="mt-1 text-xl font-bold text-emerald-950">{formatCurrency(displayedPaymentTotals.cash)}</p>
          </div>
          <div className="rounded-lg border bg-slate-50 p-3">
            <p className="text-xs font-medium uppercase text-slate-500">Check Pay Out</p>
            <p className="mt-1 text-xl font-bold text-slate-950">{formatCurrency(displayedPaymentTotals.check)}</p>
          </div>
          <div className="rounded-lg border bg-blue-50 p-3">
            <p className="text-xs font-medium uppercase text-blue-700">ACH Pay Out</p>
            <p className="mt-1 text-xl font-bold text-blue-950">{formatCurrency(displayedPaymentTotals.ach)}</p>
          </div>
          <div className="rounded-lg border bg-amber-50 p-3">
            <p className="text-xs font-medium uppercase text-amber-700">Unmatched Earnings</p>
            <p className="mt-1 text-xl font-bold text-amber-950">{formatCurrency(unpaidTotal)}</p>
            <p className="mt-0.5 text-[11px] text-amber-700">Work not matched to a saved payout; review before paying</p>
            {unmatchedDetails.length > 0 && <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setUnmatchedOpen(true)}>Review unmatched work</Button>}
          </div>
        </div>
        <div className="mb-4 rounded-lg border bg-slate-50 p-3 text-sm" data-wage-reconciliation>
          <p className="font-semibold">Table earnings {formatCurrency(wageReconciliation.earnings)} = recorded payouts {formatCurrency(wageReconciliation.recordedPayout)} + rounding / payout adjustment {formatCurrency(wageReconciliation.payoutAdjustment)} + unmatched earnings {formatCurrency(wageReconciliation.pending)}{wageReconciliation.legacy !== 0 && ` + legacy estimated earnings ${formatCurrency(wageReconciliation.legacy)}`}</p>
          <p className="mt-1 text-xs text-muted-foreground">Tips in this table: {formatCurrency(wageReconciliation.tips)}. Saved payroll tips follow the included pay periods; the restaurant cards above follow EOD work dates.</p>
          {displayedPaymentTotals.unknown > 0 && <p className="mt-1 text-xs text-muted-foreground">Recorded payout includes {formatCurrency(displayedPaymentTotals.unknown)} with an unknown payment method.</p>}
        </div>
        <Table className={view === 'earnings' ? 'min-w-[1560px]' : 'min-w-[920px]'}>
          <TableHeader><TableRow>
            <TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Paid By</TableHead><TableHead>Clock Status</TableHead>
            <TableHead className="text-right">Hours</TableHead><TableHead className="text-right">Meal Break</TableHead><TableHead className="text-right">Tips</TableHead><TableHead className="text-right">Tips / Hr</TableHead>
            {view === 'earnings' && <><TableHead className="text-right">Base Wages</TableHead><TableHead className="text-right">Guaranteed Top-Up</TableHead><TableHead className="text-right">Commission</TableHead><TableHead className="text-right">Deductions</TableHead><TableHead className="text-right">Total Earnings</TableHead></>}
          </TableRow></TableHeader>
          <TableBody>
            {displayedRows.map(row => <TableRow key={row.emp.id}>
              <TableCell><button type="button" className="font-medium text-left hover:underline" onClick={() => { setExpandedDetailGroupKey(null); setDetailEmployeeId(row.emp.id) }}>{row.emp.name}</button></TableCell>
              <TableCell className="text-muted-foreground">{getRoleLabel(row.emp.role, roleDefinitions)}</TableCell>
              <TableCell>{formatPaymentBreakdown(row.paymentBreakdown)}</TableCell>
              <TableCell>{row.hasOpenClock ? <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Clock Out Needed</Badge> : row.hasAutoClockOut ? <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-800">Auto Clock-Out</Badge> : <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">Verified</Badge>}</TableCell>
              <TableCell className="text-right">{row.hours.toFixed(2)}h</TableCell><TableCell className="text-right text-muted-foreground">{formatMealBreakMinutes(row.mealBreakMinutes)}</TableCell><TableCell className="text-right font-semibold text-green-700">{formatCurrency(row.tips)}</TableCell><TableCell className="text-right">{row.tipRate !== null ? formatCurrency(row.tipRate) : '—'}</TableCell>
              {view === 'earnings' && <><TableCell className="text-right">{formatCurrency(row.baseWages)}</TableCell><TableCell className="text-right text-violet-700">{formatCurrency(row.guaranteeTopUp)}</TableCell><TableCell className="text-right">{formatCurrency(row.commission)}</TableCell><TableCell className="text-right text-red-700">{formatCurrency(row.deductions)}</TableCell><TableCell className="text-right font-bold">{formatCurrency(row.totalEarnings)}</TableCell></>}
            </TableRow>)}
            {displayedRows.length === 0 && <TableRow><TableCell colSpan={view === 'earnings' ? 13 : 8} className="py-6 text-center text-muted-foreground">No wage data for this range</TableCell></TableRow>}
          </TableBody>
          {displayedRows.length > 0 && <tfoot><TableRow><TableCell className="font-semibold">Period Total</TableCell><TableCell /><TableCell /><TableCell /><TableCell className="text-right font-semibold">{displayedRows.reduce((sum, row) => sum + row.hours, 0).toFixed(2)}h</TableCell><TableCell className="text-right font-semibold">{formatMealBreakMinutes(displayedRows.reduce((sum, row) => sum + row.mealBreakMinutes, 0))}</TableCell><TableCell className="text-right font-semibold">{formatCurrency(displayedRows.reduce((sum, row) => sum + row.tips, 0))}</TableCell><TableCell />{view === 'earnings' && <><TableCell className="text-right font-semibold">{formatCurrency(displayedRows.reduce((sum, row) => sum + row.baseWages, 0))}</TableCell><TableCell className="text-right font-semibold text-violet-700">{formatCurrency(displayedRows.reduce((sum, row) => sum + row.guaranteeTopUp, 0))}</TableCell><TableCell className="text-right font-semibold">{formatCurrency(displayedRows.reduce((sum, row) => sum + row.commission, 0))}</TableCell><TableCell className="text-right font-semibold text-red-700">{formatCurrency(displayedRows.reduce((sum, row) => sum + row.deductions, 0))}</TableCell><TableCell className="text-right font-bold">{formatCurrency(displayedRows.reduce((sum, row) => sum + row.totalEarnings, 0))}</TableCell></>}</TableRow></tfoot>}
        </Table>
      </div>

      <Dialog open={unmatchedOpen} onOpenChange={setUnmatchedOpen}>
        <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-4xl">
          <DialogHeader><DialogTitle>Unmatched work · {formatCurrency(unpaidTotal)}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">These employee/work-date entries have no matching saved payout in this department. Amounts use approved clocks, EOD tips, and current Staffing pay settings. Check for external payments or corrections before treating them as money owed.</p>
          <Table>
            <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Work Date</TableHead><TableHead>Department</TableHead><TableHead>Hours</TableHead><TableHead>Base Wages</TableHead><TableHead>Tips</TableHead><TableHead>Top-Up</TableHead><TableHead>Earnings</TableHead></TableRow></TableHeader>
            <TableBody>{unmatchedDetails.map((detail, index) => <TableRow key={`${detail.employee}-${detail.date}-${index}`}>
              <TableCell>{detail.employee}</TableCell><TableCell>{detail.date}</TableCell><TableCell>{detail.workDepartment ?? department}</TableCell><TableCell>{detail.hours.toFixed(2)}</TableCell>
              <TableCell>{formatCurrency(detail.baseWages)}</TableCell><TableCell>{formatCurrency(detail.tips)}</TableCell><TableCell>{formatCurrency(detail.guaranteeTopUp)}</TableCell><TableCell>{formatCurrency(detail.totalEarnings)}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailTarget} onOpenChange={(open) => { if (!open) { setDetailEmployeeId(null); setExpandedDetailGroupKey(null) } }}>
        <DialogContent className="w-[calc(100vw-3rem)] max-w-none sm:max-w-none max-h-[90vh] overflow-y-auto p-7">
          <DialogHeader>
            <DialogTitle>{detailTarget?.emp.name} Wage Detail</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">Summary totals preserve saved payroll snapshots plus unmatched work. Daily history shows clock/EOD calculations for the selected dates and can differ because of manual salary, commission, or payroll adjustments. Snapshot-only rows use the pay date.</p>
          {detailTarget && (() => {
            const perf = employeePerfStats.get(detailTarget.emp.id)
            return (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-2xl border bg-white p-5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Performance Score</div>
                  <div className="mt-2 text-2xl font-bold text-slate-700">{perf?.score ?? '—'}</div>
                  <div className="mt-0.5 text-xs text-slate-400">monthly weighted KPI</div>
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Overall Rank</div>
                  <div className="mt-2 text-2xl font-bold text-slate-700">{perf ? `#${perf.overallRank}` : '—'}</div>
                  <div className="mt-0.5 text-xs text-slate-400">{perf ? `of ${perf.staffCount} staff` : 'no data'}</div>
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tips / Hr</div>
                  <div className="mt-2 text-2xl font-bold text-slate-700">{detailTarget.tipRate !== null ? formatCurrency(detailTarget.tipRate) : '—'}</div>
                  <div className="mt-0.5 text-xs text-slate-400">this period</div>
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Effective Rate</div>
                  <div className="mt-2 text-2xl font-bold text-slate-700">{detailTarget.effectiveRate !== null ? formatCurrency(detailTarget.effectiveRate) : '—'}</div>
                  <div className="mt-0.5 text-xs text-slate-400">total earnings / hr</div>
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Hours Worked</div>
                  <div className="mt-2 text-2xl font-bold text-slate-700">{detailTarget.hours.toFixed(2)}</div>
                  <div className="mt-0.5 text-xs text-slate-400">hrs this period</div>
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tips</div>
                  <div className="mt-2 text-2xl font-bold text-slate-700">{formatCurrency(detailTarget.tips)}</div>
                  <div className="mt-0.5 text-xs text-slate-400">this period</div>
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Base Wages</div>
                  <div className="mt-2 text-2xl font-bold text-slate-700">{formatCurrency(detailTarget.baseWages)}</div>
                  <div className="mt-0.5 text-xs text-slate-400">this period</div>
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Commission</div>
                  <div className="mt-2 text-2xl font-bold text-slate-700">{formatCurrency(detailTarget.commission)}</div>
                  <div className="mt-0.5 text-xs text-slate-400">this period</div>
                </div>
                <div className="rounded-2xl border bg-white p-5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Total Earnings</div>
                  <div className="mt-2 text-2xl font-bold text-slate-700">{formatCurrency(detailTarget.totalEarnings)}</div>
                  <div className="mt-0.5 text-xs text-slate-400">net earnings for this work period</div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void handleExcelExport([detailTarget], detailTarget.emp.name)} disabled={exportingExcel}>
                  {exportingExcel ? 'Exporting…' : 'Export Excel'}
                </Button>
                <Button variant="outline" onClick={() => exportReportToPdf(`${detailTarget.emp.name} Wage Report`, buildWageReportHtml(detailTarget))}>
                  PDF Export
                </Button>
                <Button onClick={() => void handleEmailReport(detailTarget.emp.id)} disabled={emailingEmployeeId === detailTarget.emp.id}>
                  {emailingEmployeeId === detailTarget.emp.id ? 'Sending…' : 'Email Report'}
                </Button>
              </div>
              <div className="space-y-3">
                {detailPayoutGroups.map(group => {
                  const expanded = expandedDetailGroupKey === group.key
                  const groupHours = group.rows.reduce((sum, row) => sum + row.hours, 0)
                  const groupTips = group.rows.reduce((sum, row) => sum + row.tips, 0)
                  const groupTotal = group.rows.reduce((sum, row) => sum + row.totalEarnings, 0)
                  return <div key={group.key} className={`rounded-xl border ${group.paid ? 'border-emerald-200' : 'border-amber-300'}`}>
                    <button type="button" className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-left ${group.paid ? 'bg-emerald-50' : 'bg-amber-50'}`} onClick={() => setExpandedDetailGroupKey(expanded ? null : group.key)}>
                      <div><div className="font-semibold text-slate-950">{group.title}</div><div className="text-xs text-muted-foreground">{group.subtitle}</div></div>
                      <div className="flex flex-wrap gap-4 text-sm"><span>{groupHours.toFixed(2)}h</span><span>{formatCurrency(groupTips)} tips</span><span className="font-semibold">{formatCurrency(groupTotal)}</span><span className="text-blue-700">{expanded ? 'Collapse' : 'View daily details'}</span></div>
                    </button>
                    {expanded && <div className="overflow-x-auto border-t bg-white"><Table>
                      <TableHeader><TableRow><TableHead>Date</TableHead><TableHead className="text-right">Hours</TableHead><TableHead className="text-right">Meal Break</TableHead><TableHead className="text-right">Tips</TableHead>{view === 'earnings' && <><TableHead className="text-right">Base Wages</TableHead><TableHead className="text-right">Top-Up</TableHead><TableHead className="text-right">Commission</TableHead><TableHead className="text-right">Total</TableHead></>}</TableRow></TableHeader>
                      <TableBody>{group.rows.map(detail => <TableRow key={detail.date}><TableCell>{detail.date}</TableCell><TableCell className="text-right">{detail.hours.toFixed(2)}h</TableCell><TableCell className="text-right text-muted-foreground">{formatMealBreakMinutes(detail.mealBreakMinutes)}</TableCell><TableCell className="text-right">{formatCurrency(detail.tips)}</TableCell>{view === 'earnings' && <><TableCell className="text-right">{formatCurrency(detail.baseWages)}</TableCell><TableCell className="text-right">{formatCurrency(detail.guaranteeTopUp)}</TableCell><TableCell className="text-right">{formatCurrency(detail.commission)}</TableCell><TableCell className="text-right font-semibold">{formatCurrency(detail.totalEarnings)}</TableCell></>}</TableRow>)}</TableBody>
                    </Table></div>}
                  </div>
                })}
                {detailPayoutGroups.length === 0 && <div className="rounded-xl border p-4 text-sm text-muted-foreground">No daily wage details for this range.</div>}
              </div>
            </div>
          )})()}
        </DialogContent>
      </Dialog>
    </div>
  )
}
