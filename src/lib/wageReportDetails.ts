import { getPayrollPaymentBreakdown, normalizeMoney, type SavedPayrollRun } from '@/lib/payroll'
import { wageDetailMatchesPayroll } from '@/lib/wageReportReconciliation'
import type { PayrollRunItem } from '@/lib/types'

export type WageWorkDetail = {
  date: string; workDepartment?: string; sourceRunId?: string
  hours: number; mealBreakMinutes: number; tips: number; baseWages: number
  guaranteeTopUp: number; commission: number; deductions: number; totalEarnings: number
}

export function savedWagePayments(item: PayrollRunItem) {
  const payments = item.payment_method ? getPayrollPaymentBreakdown({
    payment_method: item.payment_method, commission_payment_method: item.commission_payment_method,
    commission: Number(item.commission ?? 0), net_pay: Number(item.net_pay ?? item.payout_amount ?? 0),
    payment_allocations: item.payment_allocations,
  }) : null
  return { cash: payments?.cash ?? 0, check: payments?.check ?? 0, ach: payments?.ach ?? 0,
    unknown: payments ? 0 : Number(item.payout_amount ?? 0) }
}

function detailTotals(rows: WageWorkDetail[]) {
  const sum = (key: keyof Pick<WageWorkDetail, 'hours' | 'tips' | 'baseWages' | 'guaranteeTopUp' | 'commission' | 'deductions' | 'totalEarnings'>) =>
    normalizeMoney(rows.reduce((total, row) => total + row[key], 0))
  return { hours: sum('hours'), tips: sum('tips'), baseWages: sum('baseWages'),
    guaranteeTopUp: sum('guaranteeTopUp'), commission: sum('commission'), deductions: sum('deductions'), totalEarnings: sum('totalEarnings') }
}

export function buildWagePayoutGroups({ runs, employee, department, details, legacyCutoff }: {
  runs: SavedPayrollRun[]; employee: { id: string; name: string }; department: string
  details: WageWorkDetail[]; legacyCutoff: string | null
}) {
  const dailyRows = details.filter(row => !row.sourceRunId)
  const assigned = new Set<WageWorkDetail>()
  const saved = [...runs].sort((a, b) => b.pay_date.localeCompare(a.pay_date) || b.id.localeCompare(a.id)).flatMap(run => {
    const items = (run.payroll_run_items ?? []).filter(item =>
      (item.employee_id ? item.employee_id === employee.id : item.employee_name === employee.name)
      && (department === 'all' || item.department === department))
    if (!items.length) return []
    const rows = dailyRows.filter(row => !assigned.has(row) && wageDetailMatchesPayroll(row, employee.id, run, department))
    rows.forEach(row => assigned.add(row))
    // Saved payroll is authoritative even when there are clocks, no hours, or only a deduction.
    const totals = detailTotals(items.map(item => ({ date: run.pay_date, hours: Number(item.hours ?? 0), mealBreakMinutes: 0,
      tips: Number(item.tips ?? 0), baseWages: Number(item.base_wages ?? 0), guaranteeTopUp: Number(item.guarantee_top_up ?? 0),
      commission: Number(item.commission ?? 0), deductions: Number(item.deductions ?? 0), totalEarnings: Number(item.net_pay ?? item.payout_amount ?? 0) })))
    const payments = items.reduce((result, item) => {
      const itemPayments = savedWagePayments(item)
      for (const method of ['cash', 'check', 'ach', 'unknown'] as const) result[method] = normalizeMoney(result[method] + itemPayments[method])
      return result
    }, { cash: 0, check: 0, ach: 0, unknown: 0 })
    const payout = normalizeMoney(Object.values(payments).reduce((total, amount) => total + amount, 0))
    return [{ key: run.id, kind: 'saved' as 'saved' | 'unmatched' | 'legacy', run, items, rows, totals, payments, payout,
      adjustment: normalizeMoney(totals.totalEarnings - payout) }]
  })
  const unsaved = (kind: 'unmatched' | 'legacy', rows: WageWorkDetail[]) => ({
    key: kind, kind, run: null, items: [] as PayrollRunItem[], rows, totals: detailTotals(rows),
    payments: { cash: 0, check: 0, ach: 0, unknown: 0 }, payout: 0, adjustment: 0,
  })
  const remaining = dailyRows.filter(row => !assigned.has(row))
  const unmatched = remaining.filter(row => !legacyCutoff || row.date >= legacyCutoff)
  const legacy = remaining.filter(row => legacyCutoff && row.date < legacyCutoff)
  return [...(unmatched.length ? [unsaved('unmatched', unmatched)] : []), ...saved,
    ...(legacy.length ? [unsaved('legacy', legacy)] : [])]
}

export function wagePaymentMethods(payments: { cash: number; check: number; ach: number; unknown: number }) {
  return (['cash', 'check', 'ach', 'unknown'] as const).filter(method => payments[method] > 0)
    .map(method => ({cash: 'Cash', check: 'Check', ach: 'ACH', unknown: 'Unknown'})[method]).join(' + ') || 'Not recorded'
}
