import { getClockWorkDepartment, getEffectiveClockHours } from '@/lib/clockUtils'
import { calculateTips } from '@/lib/tipCalc'
import { isTipEligibleForWork } from '@/lib/tipEligibility'
import type { Employee, EodReport, Schedule, ShiftClock } from '@/lib/types'

export type DailyTipAmount = { hours: number; tips: number }
export type DailyTipReport = Pick<EodReport, 'session_date' | 'tip_total'> & {
  tip_distributions?: { employee_id: string; hours_worked?: number | null; net_tip: number }[]
}

export function getSavedDailyTips(report: DailyTipReport) {
  const saved = new Map<string, DailyTipAmount>()
  for (const distribution of report.tip_distributions ?? []) {
    const current = saved.get(distribution.employee_id) ?? { hours: 0, tips: 0 }
    saved.set(distribution.employee_id, {
      hours: current.hours + Number(distribution.hours_worked ?? 0),
      tips: current.tips + Number(distribution.net_tip ?? 0),
    })
  }
  return saved
}

export function calculateDailyTipPreview({ employees, clockRecords, schedules = [], report }: {
  employees: Employee[]
  clockRecords: ShiftClock[]
  schedules?: Schedule[]
  report: DailyTipReport
}) {
  const employeesById = new Map(employees.map(employee => [employee.id, employee]))
  const hoursByEmployee = new Map<string, number>()
  for (const record of clockRecords) {
    if (record.session_date !== report.session_date) continue
    const employee = employeesById.get(record.employee_id)
    if (!employee || !isTipEligibleForWork(employee, getClockWorkDepartment(record, employee, schedules))) continue
    const hours = getEffectiveClockHours(record)
    if (hours <= 0) continue
    hoursByEmployee.set(record.employee_id, (hoursByEmployee.get(record.employee_id) ?? 0) + hours)
  }
  const results = calculateTips(Number(report.tip_total ?? 0), [...hoursByEmployee].map(([employeeId, hours]) => ({
    employee_id: employeeId,
    hours_worked: hours,
    tip_pool_hourly_rate: employeesById.get(employeeId)?.tip_pool_hourly_rate ?? null,
  })))
  return new Map(results.map(result => [result.employee_id, { hours: result.hours_worked, tips: result.net_tip }]))
}

// Preserve the existing Wage Report/Payroll Worksheet rule: keep saved tip
// adjustments unless eligible clock participants or their hours have changed.
export function shouldRecalculateTips(saved: Map<string, DailyTipAmount>, calculated: Map<string, DailyTipAmount>) {
  if (calculated.size === 0) return false
  for (const [employeeId, preview] of calculated) {
    const original = saved.get(employeeId)
    if (!original || Math.abs(original.hours - preview.hours) > 0.01) return true
  }
  return false
}

export function getDailyReportTips(args: Parameters<typeof calculateDailyTipPreview>[0]) {
  const saved = getSavedDailyTips(args.report)
  const calculated = calculateDailyTipPreview(args)
  const source = shouldRecalculateTips(saved, calculated) ? 'calculated' : 'saved'
  return { tips: source === 'calculated' ? calculated : saved, source }
}
