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
import { clockMatchesWorkDepartment, getMealBreakState, shouldWarnMissingMealBreak, getEffectiveClockHours, isClockPending } from '@/lib/clockUtils'
import { getDepartmentLabel, getRoleLabel } from '@/lib/organization'
import { exportReportToPdf } from '@/lib/reportExport'
import { escapeHtml } from '@/lib/emailUtils'
import { exportReportToExcel, type ExcelColumn, type ExcelReportSheet } from '@/lib/reportExcel'
import { calculateDailyTipPreview, getSavedDailyTips, shouldRecalculateTips } from '@/lib/dailyTips'
import { getPayrollPaymentBreakdown, normalizeMoney, paymentMethodLabel } from '@/lib/payroll'
import { calculateDailyWageDetail } from '@/lib/dailyWages'
import { reconcileWageRows, summarizeRestaurantTips, wageDetailMatchesPayroll } from '@/lib/wageReportReconciliation'
import { buildWagePayoutGroups, wagePaymentMethods, type WageWorkDetail } from '@/lib/wageReportDetails'
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
type WageSortKey = 'name' | 'role' | 'paymentMethod' | 'hours' | 'tips' | 'baseWages' | 'guaranteeTopUp' | 'commission' | 'deductions' | 'totalEarnings'

type WageDetailRow = WageWorkDetail

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

const overviewCurrency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

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

function getDailyWageDetail(args: Parameters<typeof calculateDailyWageDetail>[0]): WageDetailRow | null {
  return calculateDailyWageDetail(args)
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
  const [sortKey, setSortKey] = useState<WageSortKey>('name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

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
    const payoutGroups = buildWagePayoutGroups({ runs: completedPayrollRuns, employee: row.emp, department, details, legacyCutoff: legacyWageCutoffDate })
    const savedPayoutHtml = payoutGroups.filter(group => group.kind === 'saved').map(group => `
      <tr><td>${group.run ? `${formatReportDate(group.run.pay_date)}<br>${formatReportDate(group.run.start_date)} – ${formatReportDate(group.run.end_date)}` : ''}</td>
        <td>${escapeHtml([...new Set(group.items.map(item => getDepartmentLabel(item.department, departmentDefinitions)))].join(', '))}</td>
        <td class="right">${group.totals.hours.toFixed(2)}</td><td class="right">${formatCurrency(group.totals.baseWages)}</td>
        <td class="right">${formatCurrency(group.totals.tips)}</td><td class="right">${formatCurrency(group.totals.guaranteeTopUp)}</td>
        <td class="right">${formatCurrency(group.totals.commission)}</td><td class="right">${formatCurrency(group.totals.deductions)}</td>
        <td class="right">${formatCurrency(group.totals.totalEarnings)}</td><td>${formatPaymentBreakdown(group.payments)}</td>
        <td class="right">${formatCurrency(group.payout)}</td></tr>`).join('')
    return `
      <h1>${escapeHtml(row.emp.name)} Wage Report</h1>
      <p class="muted">${startDate === endDate ? startDate : `${startDate} - ${endDate}`}</p>
      <p class="muted">Summary: full saved pay periods plus unmatched work in the selected dates. Daily rows use clock/EOD calculations; saved salary, commissions, and adjustments may differ. Snapshot-only rows are dated by pay date.</p>
      <div class="summary">
        <div class="card"><strong>Hours</strong><div class="metric">${row.hours.toFixed(2)} hrs</div></div>
        <div class="card"><strong>Paid By</strong><div class="metric">${wagePaymentMethods(row.paymentBreakdown)}</div></div>
        <div class="card"><strong>Tips</strong><div class="metric">${formatCurrency(row.tips)}</div></div>
        ${view === 'earnings' ? `<div class="card"><strong>Base Wages</strong><div class="metric">${formatCurrency(row.baseWages)}</div></div>` : ''}
        ${view === 'earnings' ? `<div class="card"><strong>Commission</strong><div class="metric">${formatCurrency(row.commission)}</div></div>` : ''}
        ${view === 'earnings' ? `<div class="card"><strong>Deductions</strong><div class="metric">${formatCurrency(row.deductions)}</div></div>` : ''}
        ${view === 'earnings' ? `<div class="card"><strong>Total Earnings</strong><div class="metric">${formatCurrency(row.totalEarnings)}</div></div>` : ''}
      </div>
      ${view === 'earnings' && savedPayoutHtml ? `<h3>Saved payout details</h3><table class="compact-table"><thead><tr><th>Pay date / period</th><th>Department</th><th>Hours</th><th>Base / salary</th><th>Tips</th><th>Top-up</th><th>Commission</th><th>Deductions</th><th>Total earnings</th><th>Payment details</th><th>Recorded payout</th></tr></thead><tbody>${savedPayoutHtml}</tbody></table>` : ''}
      <h3>Work-date history</h3>
      <p>
        Included saved pay periods and unmatched work total ${row.hours.toFixed(2)} hours and ${formatCurrency(row.tips)} in tips for ${escapeHtml(row.emp.name)}.
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

  const displayedRows = useMemo(() => {
    const selected = employeeFilter === 'all' ? rows : rows.filter(row => row.emp.id === employeeFilter)
    const sortValue = (row: WageSummaryRow) => sortKey === 'name' ? row.emp.name
      : sortKey === 'role' ? getRoleLabel(row.emp.role, roleDefinitions)
        : sortKey === 'paymentMethod' ? wagePaymentMethods(row.paymentBreakdown) : row[sortKey]
    return [...selected].sort((a, b) => {
      const left = sortValue(a), right = sortValue(b)
      const comparison = typeof left === 'number' && typeof right === 'number'
        ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' })
      return (sortDirection === 'asc' ? comparison : -comparison) || a.emp.name.localeCompare(b.emp.name) || a.emp.id.localeCompare(b.emp.id)
    })
  }, [employeeFilter, rows, sortKey, sortDirection, roleDefinitions])
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
  const detailPayoutGroups = useMemo(() => detailTarget ? buildWagePayoutGroups({
    runs: completedPayrollRuns, employee: detailTarget.emp, department, details: detailRows, legacyCutoff: legacyWageCutoffDate,
  }) : [], [completedPayrollRuns, department, detailRows, detailTarget, legacyWageCutoffDate])
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
        <section aria-labelledby="payroll-overview-heading" className="mb-4 space-y-2.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="payroll-overview-heading" className="text-base font-semibold text-slate-950">Payroll overview</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-900">{getDepartmentLabel(department, departmentDefinitions)}</span>
                <span>{selectedEmployeeName}</span>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span>{formatReportDate(startDate)} – {formatReportDate(endDate)}</span>
              </div>
            </div>
            <span className={[
              'rounded-full border px-3 py-1 text-xs font-semibold',
              unpaidTotal > 0 ? 'border-amber-200 bg-amber-50 text-amber-900'
                : scopedPayrollRuns.length > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 bg-slate-50 text-slate-600',
            ].join(' ')}>
              {unpaidTotal > 0 ? 'Unmatched work to review' : scopedPayrollRuns.length > 0 ? 'Saved payouts included' : 'Preview only'}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="min-w-0 rounded-lg bg-slate-900 px-3 py-3 text-white">
              <p className="text-sm font-medium text-slate-200">Total earnings</p>
              <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums lg:text-2xl">{overviewCurrency.format(wageReconciliation.earnings)}</p>
              <p className="mt-1 text-xs text-slate-300">Includes <span className="font-medium tabular-nums text-white">{overviewCurrency.format(wageReconciliation.tips)}</span> in payroll tips</p>
            </div>
            <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-3">
              <p className="text-sm font-medium text-slate-600">Recorded payouts</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-emerald-800 tabular-nums lg:text-2xl">{overviewCurrency.format(wageReconciliation.recordedPayout)}</p>
              <p className="mt-1 text-xs leading-snug text-slate-600">Saved payroll payments after cash rounding.</p>
            </div>
            <div className={[
              'min-w-0 rounded-lg border px-3 py-3',
              unpaidTotal > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50',
            ].join(' ')}>
              <p className="text-sm font-medium text-slate-600">Unmatched earnings</p>
              <p className={['mt-1 text-xl font-semibold tracking-tight tabular-nums lg:text-2xl', unpaidTotal > 0 ? 'text-amber-950' : 'text-slate-950'].join(' ')}>{overviewCurrency.format(unpaidTotal)}</p>
              <p className="mt-1 text-xs leading-snug text-slate-600">{unpaidTotal > 0 ? 'Work without a matching saved payout. Review before paying.' : 'No unmatched earnings in this selection.'}</p>
              {unmatchedDetails.length > 0 && <Button variant="link" size="sm" className="mt-1 h-auto p-0 text-xs font-semibold text-amber-950 underline underline-offset-4" onClick={() => setUnmatchedOpen(true)}>Review unmatched work</Button>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs">
            <span className="font-medium text-slate-500">Recorded payouts by method</span>
            {(['cash', 'check', 'ach'] as const).map(method => (
              <span key={method} className="flex items-baseline gap-2 text-slate-600">{paymentMethodLabel(method)} <span className="font-semibold text-slate-950 tabular-nums">{overviewCurrency.format(displayedPaymentTotals[method])}</span></span>
            ))}
            {displayedPaymentTotals.unknown > 0 && <span className="flex items-baseline gap-2 text-slate-600">Unknown <span className="font-semibold text-slate-950 tabular-nums">{overviewCurrency.format(displayedPaymentTotals.unknown)}</span></span>}
          </div>
          {boundaryPayrollRuns.length > 0 && <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <p className="font-semibold">Saved pay periods cross this date range</p>
            <p className="mt-1 text-xs leading-relaxed">Payroll includes full saved pay periods, including work outside these dates. Restaurant tips below use only the selected work dates.</p>
          </div>}
          <details className="group rounded-lg border border-slate-200" data-wage-reconciliation>
            <summary className="cursor-pointer rounded-lg px-3 py-2 text-xs font-medium text-slate-700 outline-offset-4 marker:text-slate-400">
              Payroll details &amp; pay periods
              {wageReconciliation.payoutAdjustment !== 0 && <span className="mt-1 block pl-4 text-xs font-normal text-slate-500 sm:ml-3 sm:mt-0 sm:inline sm:pl-0">Rounding / adjustment: {overviewCurrency.format(wageReconciliation.payoutAdjustment)}</span>}
            </summary>
            <div className="grid gap-5 border-t border-slate-200 px-4 py-4 text-sm lg:grid-cols-2">
              <div>
                <h3 className="mb-3 font-semibold text-slate-950">How the table total adds up</h3>
                <dl className="space-y-2 text-slate-600">
                  <div className="flex justify-between gap-4"><dt>Recorded payouts</dt><dd className="font-medium text-slate-950 tabular-nums">{overviewCurrency.format(wageReconciliation.recordedPayout)}</dd></div>
                  <div className="flex justify-between gap-4"><dt>Rounding / payout adjustment</dt><dd className="font-medium text-slate-950 tabular-nums">{overviewCurrency.format(wageReconciliation.payoutAdjustment)}</dd></div>
                  <div className="flex justify-between gap-4"><dt>Unmatched earnings</dt><dd className="font-medium text-slate-950 tabular-nums">{overviewCurrency.format(wageReconciliation.pending)}</dd></div>
                  {wageReconciliation.legacy !== 0 && <div className="flex justify-between gap-4"><dt>Legacy estimated earnings</dt><dd className="font-medium text-slate-950 tabular-nums">{overviewCurrency.format(wageReconciliation.legacy)}</dd></div>}
                  <div className="flex justify-between gap-4 border-t border-slate-200 pt-2 font-semibold text-slate-950"><dt>Total earnings</dt><dd className="tabular-nums">{overviewCurrency.format(wageReconciliation.earnings)}</dd></div>
                </dl>
                <p className="mt-3 text-xs leading-relaxed text-slate-500">Tips in this table: {overviewCurrency.format(wageReconciliation.tips)}. These follow the included pay periods and can differ from restaurant tips by work date.</p>
                {displayedPaymentTotals.unknown > 0 && <p className="mt-2 text-xs text-slate-500">An unknown payment method means the payout was saved without a payment method.</p>}
              </div>
              <div>
                <h3 className="mb-3 font-semibold text-slate-950">Included saved pay periods</h3>
                {scopedPayrollRuns.length > 0 ? (
                  <ul className="max-h-40 space-y-2 overflow-y-auto text-xs text-slate-600">
                    {scopedPayrollRuns.map(run => <li key={run.id}>
                      <span className="font-medium text-slate-800">{formatReportDate(run.start_date)} – {formatReportDate(run.end_date)}</span>
                      <span className="mt-0.5 block">{getDepartmentLabel(run.department, departmentDefinitions)} · Pay date {formatReportDate(run.pay_date)}</span>
                    </li>)}
                  </ul>
                ) : <p className="text-xs leading-relaxed text-slate-600">No saved payout matches this selection. Earnings use clock records, EOD tips and Staffing pay settings.</p>}
                {matchingPayrollRun && hasMatchingScopedRun && <p className="mt-3 text-xs text-slate-500">Run created {format(new Date(matchingPayrollRun.created_at), 'MMM d, yyyy h:mm a')}.</p>}
                {periodPayrollRuns.some(run => run.pay_date > todayDate && (run.payroll_run_items ?? []).some(item => employeeFilter === 'all' || item.employee_id === employeeFilter)) && <p className="mt-3 text-xs text-slate-500">A saved payroll run has a future pay date. Its payout will appear when that date is reached.</p>}
                <p className="mt-3 text-xs leading-relaxed text-slate-500">Saved amounts include full pay periods without prorating. Unmatched work uses only the selected dates. Review external payments or corrections before treating unmatched work as money owed.</p>
              </div>
            </div>
          </details>
        </section>
        <section aria-labelledby="restaurant-tips-heading" className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="restaurant-tips-heading" className="text-base font-semibold text-slate-950">Restaurant tips</h2>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">All departments · All staff</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">EOD work dates: {formatReportDate(startDate)} – {formatReportDate(endDate)}. These totals stay the same when you filter departments or staff.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-sm text-slate-600">Tips collected</p>
              <p className="mt-0.5 text-xl font-semibold tracking-tight text-slate-950 tabular-nums">{overviewCurrency.format(tipSummary.totalCollected)}</p>
              <p className="mt-1 text-xs text-slate-500">Total tips reported in EOD</p>
            </div>
            <div>
              <p className="text-sm text-slate-600">Allocated to staff</p>
              <p className="mt-0.5 text-xl font-semibold tracking-tight text-slate-950 tabular-nums">{overviewCurrency.format(tipSummary.totalTipOut)}</p>
              <p className="mt-1 text-xs text-slate-500">Tip allocations, before payroll payments</p>
            </div>
            <div>
              <p className="text-sm text-slate-600">Allocated to house</p>
              <p className="mt-0.5 text-xl font-semibold tracking-tight text-slate-950 tabular-nums">{overviewCurrency.format(tipSummary.houseTip)}</p>
              <p className="mt-1 text-xs text-slate-500">Saved deductions; 15% for unsaved previews</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2 text-xs">
            <p className="text-slate-600">Staff + house allocations <span className="ml-1 font-semibold text-slate-950 tabular-nums">{overviewCurrency.format(tipSummary.distributionTotal)}</span></p>
            <p className={tipSummary.difference === 0 ? 'font-medium text-emerald-800' : 'font-medium text-amber-900'}>
              {tipSummary.difference === 0 ? 'Balanced · collected tips fully allocated'
                : `${overviewCurrency.format(Math.abs(tipSummary.difference))} ${tipSummary.difference > 0 ? 'unallocated' : 'over-allocated'} · review Tip Distribution Editor`}
            </p>
          </div>
        </section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-950">Staff breakdown <span className="ml-2 font-normal text-slate-500">{view === 'earnings' ? 'Earnings' : 'Tips only'}</span></h2>
          <div className="flex items-center gap-2">
            <span id="wage-sort-label" className="text-xs text-slate-500">Sort by</span>
            <Select value={sortKey} onValueChange={(value: string | null) => value && setSortKey(value as WageSortKey)}>
              <SelectTrigger aria-labelledby="wage-sort-label" className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem><SelectItem value="role">Role</SelectItem><SelectItem value="paymentMethod">Payment method</SelectItem>
                <SelectItem value="hours">Hours</SelectItem><SelectItem value="tips">Tips</SelectItem><SelectItem value="baseWages">Base wages</SelectItem>
                <SelectItem value="guaranteeTopUp">Guaranteed top-up</SelectItem><SelectItem value="commission">Commission</SelectItem><SelectItem value="deductions">Deductions</SelectItem><SelectItem value="totalEarnings">Total earnings</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="text-xs" aria-label="Toggle sort direction" onClick={() => setSortDirection(current => current === 'asc' ? 'desc' : 'asc')}>{sortDirection === 'asc' ? 'Ascending ↑' : 'Descending ↓'}</Button>
          </div>
        </div>
        <Table data-wage-staff-table className={`${view === 'earnings' ? 'min-w-[1100px]' : 'min-w-[800px]'} text-xs [&_th]:h-8 [&_th]:whitespace-normal [&_th]:px-2 [&_td]:px-2 [&_td]:py-1.5`}>
          <TableHeader><TableRow>
            <TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Paid By</TableHead><TableHead>Clock Status</TableHead>
            <TableHead className="text-right">Hours</TableHead><TableHead className="text-right">Meal Break</TableHead><TableHead className="text-right">Tips</TableHead><TableHead className="text-right">Tips / Hr</TableHead>
            {view === 'earnings' && <><TableHead className="text-right">Base Wages</TableHead><TableHead className="text-right">Guaranteed Top-Up</TableHead><TableHead className="text-right">Commission</TableHead><TableHead className="text-right">Deductions</TableHead><TableHead className="text-right">Total Earnings</TableHead></>}
          </TableRow></TableHeader>
          <TableBody>
            {displayedRows.map(row => <TableRow key={row.emp.id}>
              <TableCell><button type="button" className="font-medium text-left hover:underline" onClick={() => { setExpandedDetailGroupKey(null); setDetailEmployeeId(row.emp.id) }}>{row.emp.name}</button></TableCell>
              <TableCell className="text-muted-foreground">{getRoleLabel(row.emp.role, roleDefinitions)}</TableCell>
              <TableCell><button type="button" className="text-left font-medium text-blue-700 underline decoration-blue-200 underline-offset-4 hover:decoration-blue-700" aria-label={`View payout details for ${row.emp.name}`} onClick={() => { setExpandedDetailGroupKey(null); setDetailEmployeeId(row.emp.id) }}>{wagePaymentMethods(row.paymentBreakdown)}</button></TableCell>
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
        <DialogContent data-wage-detail-dialog className="w-[calc(100vw-2rem)] max-w-[1400px] gap-3 p-4 sm:max-w-[1400px] max-h-[calc(100svh-2rem)] overflow-y-auto">
          <DialogHeader className="gap-1 pr-8">
            <DialogTitle>{detailTarget?.emp.name} Wage Detail</DialogTitle>
            <p className="text-xs text-slate-500">{getDepartmentLabel(department, departmentDefinitions)} · {formatReportDate(startDate)} – {formatReportDate(endDate)}</p>
          </DialogHeader>
          {detailTarget && <>
            <dl className="grid grid-cols-3 gap-2 rounded-lg border bg-slate-50 p-2 sm:grid-cols-5 xl:grid-cols-9" data-wage-detail-summary>
              {[
                ['Hours', `${detailTarget.hours.toFixed(2)}h`], ['Tips', overviewCurrency.format(detailTarget.tips)],
                ['Base / salary', overviewCurrency.format(detailTarget.baseWages)], ['Top-up', overviewCurrency.format(detailTarget.guaranteeTopUp)],
                ['Commission', overviewCurrency.format(detailTarget.commission)], ['Deductions', overviewCurrency.format(detailTarget.deductions)],
                ['Total earnings', overviewCurrency.format(detailTarget.totalEarnings)],
                ['Recorded payouts', overviewCurrency.format(Object.values(detailTarget.paymentBreakdown).reduce((sum, amount) => sum + amount, 0))],
                ['Unmatched', overviewCurrency.format(detailTarget.pendingEarnings ?? 0)],
              ].map(([label, value]) => <div key={label} className="min-w-0 px-1 py-1"><dt className="text-[11px] text-slate-500">{label}</dt><dd className="mt-0.5 text-sm font-semibold text-slate-950 tabular-nums">{value}</dd></div>)}
            </dl>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Payout details</h3>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void handleExcelExport([detailTarget], detailTarget.emp.name)} disabled={exportingExcel}>{exportingExcel ? 'Exporting…' : 'Export Excel'}</Button>
                <Button variant="outline" size="sm" onClick={() => exportReportToPdf(`${detailTarget.emp.name} Wage Report`, buildWageReportHtml(detailTarget))}>PDF Export</Button>
                <Button size="sm" onClick={() => void handleEmailReport(detailTarget.emp.id)} disabled={emailingEmployeeId === detailTarget.emp.id}>{emailingEmployeeId === detailTarget.emp.id ? 'Sending…' : 'Email Report'}</Button>
              </div>
            </div>
            <p className="text-xs leading-snug text-slate-500">Saved payouts include full pay periods, commissions, salary and adjustments. Expand a pay date for work-date history. Recorded payouts are after cash rounding.</p>
            <div className="max-h-[48vh] overflow-auto rounded-lg border" data-wage-payout-details>
              <Table className="min-w-[1060px] text-xs [&_th]:h-8 [&_th]:whitespace-normal [&_th]:px-2 [&_td]:px-2 [&_td]:py-1.5">
                <TableHeader className="sticky top-0 z-10 bg-slate-100"><TableRow>
                  <TableHead>Pay date / period</TableHead><TableHead className="text-right">Hours</TableHead><TableHead className="text-right">Base / salary</TableHead><TableHead className="text-right">Tips</TableHead><TableHead className="text-right">Top-up</TableHead><TableHead className="text-right">Commission</TableHead><TableHead className="text-right">Deductions</TableHead><TableHead className="text-right">Total earnings</TableHead><TableHead>Payment details</TableHead><TableHead className="text-right">Recorded payout</TableHead>
                </TableRow></TableHeader>
                {detailPayoutGroups.map(group => {
                  const expanded = expandedDetailGroupKey === group.key
                  const label = group.run ? formatReportDate(group.run.pay_date) : group.kind === 'unmatched' ? 'Unmatched work' : 'Legacy paid'
                  return <TableBody key={group.key} data-payout-group={group.key}>
                    <TableRow className={group.kind === 'unmatched' ? 'bg-amber-50' : ''}>
                      <TableCell>
                        <button type="button" className="text-left font-semibold text-blue-700 hover:underline" aria-expanded={expanded} aria-label={`View daily history for ${label}`} onClick={() => setExpandedDetailGroupKey(expanded ? null : group.key)}>{expanded ? '▾' : '▸'} {label}</button>
                        {group.run && <span className="ml-1 text-[10px] text-slate-500">{[...new Set(group.items.map(item => getDepartmentLabel(item.department, departmentDefinitions)))].join(', ')}</span>}
                        <span className="mt-0.5 block text-[11px] text-slate-500">{group.run ? `${formatReportDate(group.run.start_date)} – ${formatReportDate(group.run.end_date)}` : 'Selected work dates'}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{group.totals.hours.toFixed(2)}</TableCell><TableCell className="text-right tabular-nums">{overviewCurrency.format(group.totals.baseWages)}</TableCell><TableCell className="text-right tabular-nums">{overviewCurrency.format(group.totals.tips)}</TableCell><TableCell className="text-right tabular-nums">{overviewCurrency.format(group.totals.guaranteeTopUp)}</TableCell><TableCell className="text-right font-medium tabular-nums">{overviewCurrency.format(group.totals.commission)}</TableCell><TableCell className="text-right tabular-nums">{overviewCurrency.format(group.totals.deductions)}</TableCell><TableCell className="text-right font-semibold tabular-nums">{overviewCurrency.format(group.totals.totalEarnings)}</TableCell>
                      <TableCell className="text-[11px]">{group.kind === 'saved' ? (['cash', 'check', 'ach', 'unknown'] as const).filter(method => group.payments[method] > 0).map(method => <span key={method} className="block">{method === 'unknown' ? 'Unknown' : paymentMethodLabel(method)} {overviewCurrency.format(group.payments[method])}</span>) : 'No saved payout'}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{group.kind === 'saved' ? overviewCurrency.format(group.payout) : '—'}{group.adjustment !== 0 && <span className="mt-0.5 block text-[10px] font-normal text-slate-500">{overviewCurrency.format(group.adjustment)} adjustment</span>}</TableCell>
                    </TableRow>
                    {expanded && <TableRow><TableCell colSpan={10} className="bg-slate-50 p-3">
                      {group.items.map(item => <p key={item.id} className="mb-1 text-xs text-slate-600">{getDepartmentLabel(item.department, departmentDefinitions)} · Regular method: {item.payment_method ? paymentMethodLabel(item.payment_method) : 'Unknown'}{Number(item.commission) > 0 && ` · Commission method: ${paymentMethodLabel(item.commission_payment_method ?? item.payment_method)}`}{item.memo && ` · ${item.memo}`}</p>)}
                      <p className="mb-2 text-[11px] text-slate-500">Work-date history uses clocks and EOD tips for the selected dates. Saved salary, commission and payroll adjustments are shown in the payout row above and are not prorated into these daily estimates.</p>
                      {group.rows.length > 0 ? <Table className="text-xs [&_th]:h-7 [&_td]:py-1">
                        <TableHeader><TableRow><TableHead>Work date</TableHead><TableHead className="text-right">Hours</TableHead><TableHead className="text-right">Meal break</TableHead><TableHead className="text-right">Tips</TableHead><TableHead className="text-right">Base wages</TableHead><TableHead className="text-right">Top-up</TableHead><TableHead className="text-right">Daily estimate</TableHead></TableRow></TableHeader>
                        <TableBody>{group.rows.map((detail, index) => <TableRow key={`${detail.date}-${index}`}><TableCell>{formatReportDate(detail.date)}</TableCell><TableCell className="text-right">{detail.hours.toFixed(2)}h</TableCell><TableCell className="text-right">{formatMealBreakMinutes(detail.mealBreakMinutes)}</TableCell><TableCell className="text-right">{overviewCurrency.format(detail.tips)}</TableCell><TableCell className="text-right">{overviewCurrency.format(detail.baseWages)}</TableCell><TableCell className="text-right">{overviewCurrency.format(detail.guaranteeTopUp)}</TableCell><TableCell className="text-right">{overviewCurrency.format(detail.totalEarnings)}</TableCell></TableRow>)}</TableBody>
                      </Table> : <p className="text-xs text-slate-500">No clock / EOD rows in the selected dates. The saved payout above is still included.</p>}
                    </TableCell></TableRow>}
                  </TableBody>
                })}
              </Table>
              {detailPayoutGroups.length === 0 && <p className="p-3 text-xs text-slate-500">No payout or work-date details for this selection.</p>}
            </div>
            <details className="rounded-lg border px-3 py-2 text-xs text-slate-600">
              <summary className="cursor-pointer font-medium">Rates &amp; monthly performance</summary>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                <span>Tips / hr: <strong>{detailTarget.tipRate !== null ? formatCurrency(detailTarget.tipRate) : '—'}</strong></span>
                <span>Effective rate: <strong>{detailTarget.effectiveRate !== null ? formatCurrency(detailTarget.effectiveRate) : '—'}</strong></span>
                <span>Performance score: <strong>{employeePerfStats.get(detailTarget.emp.id)?.score ?? '—'}</strong></span>
                <span>Overall rank: <strong>{employeePerfStats.has(detailTarget.emp.id) ? `#${employeePerfStats.get(detailTarget.emp.id)?.overallRank} of ${employeePerfStats.get(detailTarget.emp.id)?.staffCount}` : '—'}</strong></span>
              </div>
            </details>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  )
}
