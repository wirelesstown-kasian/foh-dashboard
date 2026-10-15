import { normalizeMoney, type SavedPayrollRun } from '@/lib/payroll'
import { getDailyReportTips } from '@/lib/dailyTips'
import type { Employee, EodReport, Schedule, ShiftClock, TipDistribution } from '@/lib/types'

export type WageDetailCoverage = { date: string; workDepartment?: string; sourceRunId?: string }

export function wageDetailMatchesPayroll(detail: WageDetailCoverage, employeeId: string, run: SavedPayrollRun, department: string) {
  if (detail.sourceRunId) return detail.sourceRunId === run.id
  if (detail.date < run.start_date || detail.date > run.end_date) return false
  const workDepartment = detail.workDepartment ?? department
  return (run.payroll_run_items ?? []).some(item => item.employee_id === employeeId
    && (workDepartment === 'all' || item.department === workDepartment))
}

export function summarizeRestaurantTips({ reports, employees, clocks, schedules, startDate, endDate }: {
  reports: Array<EodReport & { tip_distributions?: TipDistribution[] }>
  employees: Employee[]; clocks: ShiftClock[]; schedules: Schedule[]; startDate: string; endDate: string
}) {
  let totalCollected = 0, houseTip = 0, totalTipOut = 0
  for (const report of reports) {
    if (report.session_date < startDate || report.session_date > endDate) continue
    totalCollected += Number(report.tip_total ?? 0)
    if (report.tip_distributions?.length) {
      houseTip += report.tip_distributions.reduce((sum, row) => sum + Number(row.house_deduction ?? 0), 0)
      totalTipOut += report.tip_distributions.reduce((sum, row) => sum + Number(row.net_tip ?? 0), 0)
    } else {
      const { tips } = getDailyReportTips({ report, employees,
        clockRecords: clocks.filter(clock => clock.session_date === report.session_date), schedules })
      houseTip += Number(report.tip_total ?? 0) * 0.15
      totalTipOut += [...tips.values()].reduce((sum, tip) => sum + tip.tips, 0)
    }
  }
  const distributionTotal = normalizeMoney(houseTip + totalTipOut)
  return { totalCollected: normalizeMoney(totalCollected), houseTip: normalizeMoney(houseTip),
    totalTipOut: normalizeMoney(totalTipOut), distributionTotal,
    difference: normalizeMoney(totalCollected - distributionTotal) }
}

export function reconcileWageRows(rows: Array<{
  totalEarnings: number; tips: number; pendingEarnings?: number; legacyEarnings?: number
  paymentBreakdown: { cash: number; check: number; ach: number; unknown: number }
}>) {
  const total = (get: (row: typeof rows[number]) => number) => normalizeMoney(rows.reduce((sum, row) => sum + get(row), 0))
  const earnings = total(row => row.totalEarnings)
  const pending = total(row => row.pendingEarnings ?? 0)
  const legacy = total(row => row.legacyEarnings ?? 0)
  const recordedPayout = total(row => Object.values(row.paymentBreakdown).reduce((sum, amount) => sum + amount, 0))
  return { earnings, pending, legacy, recordedPayout, tips: total(row => row.tips),
    payoutAdjustment: normalizeMoney(earnings - pending - legacy - recordedPayout) }
}
