import { calculateDailyWageDetail } from '@/lib/dailyWages'
import { calculateDailyTipPreview, getSavedDailyTips, shouldRecalculateTips, type DailyTipReport } from '@/lib/dailyTips'
import { getClockWorkDepartment } from '@/lib/clockUtils'
import { normalizeMoney } from '@/lib/payroll'
import type { HistoricalPayroll } from '@/lib/historicalDashboardTotals'
import type { Employee, Schedule, ShiftClock } from '@/lib/types'

// Calculated earnings by work date, never a fabricated cash/check payment.
export type LegacyPayrollDay = { date: string; department?: 'server' | 'manager' | 'other'; tipOut: number; payrollOut: number; totalPayrollOut: number }

export function calculateLegacyFohPayroll({ employees, clocks, schedules, reports, cutoff, imports }: {
  employees: Employee[]; clocks: ShiftClock[]; schedules: Schedule[]; reports: DailyTipReport[]
  cutoff: string | null; imports: HistoricalPayroll[]
}): LegacyPayrollDay[] {
  if (!cutoff) return []
  const clocksByDate = new Map<string, ShiftClock[]>()
  const clocksByEmployeeDate = new Map<string, ShiftClock[]>()
  for (const clock of clocks) {
    if (clock.session_date >= cutoff) continue
    clocksByDate.set(clock.session_date, [...(clocksByDate.get(clock.session_date) ?? []), clock])
    const key = `${clock.employee_id}:${clock.session_date}`
    clocksByEmployeeDate.set(key, [...(clocksByEmployeeDate.get(key) ?? []), clock])
  }
  const reportsByDate = new Map(reports.map(report => [report.session_date, report]))
  const employeesById = new Map(employees.map(employee => [employee.id, employee]))
  return [...clocksByDate].sort(([a], [b]) => a.localeCompare(b)).flatMap(([date, dailyClocks]) => {
    // Exclude source coverage even when a partial selected range cannot display
    // that imported period. Never replace an already imported Server payment.
    if (imports.some(row => row.category === 'server' && row.start_date <= date && date <= row.end_date)) return []
    const report = reportsByDate.get(date)
    const saved = report ? getSavedDailyTips(report) : new Map()
    const calculated = report ? calculateDailyTipPreview({ employees, clockRecords: dailyClocks, schedules, report }) : new Map()
    const useCalculatedTips = shouldRecalculateTips(saved, calculated)
    const serverIds = new Set(dailyClocks.filter(clock => {
      const employee = employeesById.get(clock.employee_id)
      return employee && getClockWorkDepartment(clock, employee, schedules) === 'server'
    }).map(clock => clock.employee_id))
    // Older tipped staff can now belong to Management. Keep their Wage Report
    // earnings too, without pulling imported Kitchen wages into this fallback.
    const legacyIds = new Set([...serverIds, ...dailyClocks.filter(clock => {
      const employee = employeesById.get(clock.employee_id)
      const department = employee && getClockWorkDepartment(clock, employee, schedules)
      return employee && department !== 'kitchen' && department !== 'cook' && (saved.get(employee.id)?.tips ?? 0) > 0
    }).map(clock => clock.employee_id)])
    const byDepartment = new Map<string, LegacyPayrollDay>()
    for (const id of legacyIds) {
      const detail = calculateDailyWageDetail({ emp: employeesById.get(id)!, date,
        clockRecordsByEmployeeDate: clocksByEmployeeDate, employees, department: serverIds.has(id) ? 'server' : 'all', schedules, report,
        calculatedTip: calculated.get(id), savedTip: saved.get(id), useCalculatedTips })
      if (!detail) continue
      const department = detail.workDepartment === 'server' ? 'server' : detail.workDepartment === 'manager' ? 'manager' : 'other'
      const row = byDepartment.get(department) ?? { date, department, tipOut: 0, payrollOut: 0, totalPayrollOut: 0 }
      row.tipOut += detail.tips
      row.payrollOut += detail.baseWages + detail.guaranteeTopUp
      row.totalPayrollOut = row.tipOut + row.payrollOut
      byDepartment.set(department, row)
    }
    return [...byDepartment.values()].filter(row => row.totalPayrollOut > 0)
  })
}

export function summarizeLegacyPayroll(days: LegacyPayrollDay[]) {
  const tipOut = normalizeMoney(days.reduce((sum, day) => sum + day.tipOut, 0))
  const payrollOut = normalizeMoney(days.reduce((sum, day) => sum + day.payrollOut, 0))
  return { tipOut, payrollOut, totalPayrollOut: normalizeMoney(tipOut + payrollOut) }
}
