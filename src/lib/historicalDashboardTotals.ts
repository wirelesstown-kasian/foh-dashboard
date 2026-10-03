export type HistoricalPeriod = { start_date: string; end_date: string; period_kind: 'month' | 'partial' }

export type HistoricalSale = HistoricalPeriod & {
  cash: number
  batch_total: number
  gross_revenue: number
  sales_tax: number
  tips_before_house_cut: number
  net_revenue: number
  delivery_payment: number
}

export type HistoricalPayroll = HistoricalPeriod & {
  category: 'server' | 'kitchen' | 'owner'
  additive?: boolean
  treatment_note?: string
  cash_tip?: number | null
  check_tip?: number | null
  base?: number | null
  cash?: number | null
  check?: number | null
}

export type HistoricalAdjustments = {
  version: 1
  sales: HistoricalSale[]
  payroll: HistoricalPayroll[]
}

export function periodRows<T extends HistoricalPeriod>(rows: T[], startDate: string, endDate: string) {
  // Source rows are period totals. A week or custom range must contain the
  // whole source period; splitting it into invented daily amounts is misleading.
  return rows.filter(row => startDate <= row.start_date && row.end_date <= endDate)
}

export function monthlyTrendValues(
  dated: Array<{ date: string; value: number }>,
  imported: Array<{ start_date: string; end_date: string; value: number }>,
) {
  const totals = new Map<string, number>()
  for (const point of dated) {
    const month = point.date.slice(0, 7)
    totals.set(month, (totals.get(month) ?? 0) + point.value)
  }
  for (const period of imported) {
    // The workbook supplies period totals, so only place a period in a month
    // when it lies wholly inside that month. Never split it into invented days.
    const month = period.start_date.slice(0, 7)
    if (month !== period.end_date.slice(0, 7)) continue
    totals.set(month, (totals.get(month) ?? 0) + period.value)
  }
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }))
}

export function nonOverlappingSales(
  rows: HistoricalSale[],
  reports: Array<{ session_date: string; revenue_total?: number | null; tip_total?: number | null }>,
) {
  return rows.filter(row => !reports.some(report =>
    report.session_date >= row.start_date && report.session_date <= row.end_date
      && (Number(report.revenue_total ?? 0) !== 0 || Number(report.tip_total ?? 0) !== 0)
  ))
}

export function nonOverlappingPayroll(
  rows: HistoricalPayroll[],
  paidRuns: Array<{ start_date: string; end_date: string; department: string }>,
) {
  const group = (department: string) => {
    const value = department.toLowerCase()
    if (value.includes('kitchen') || value.includes('cook')) return 'kitchen'
    if (value.includes('server')) return 'server'
    if (value.includes('manager') || value.includes('owner')) return 'owner'
    return 'other'
  }
  return rows.filter(row => row.additive === true || !paidRuns.some(run => group(run.department) === row.category
    && run.start_date <= row.end_date && run.end_date >= row.start_date))
}

export function historicalRevenue(rows: HistoricalSale[]) {
  return rows.reduce((sum, row) => ({
    net: sum.net + Number(row.net_revenue),
    gross: sum.gross + Number(row.gross_revenue),
    cash: sum.cash + Number(row.cash),
    card: sum.card + Number(row.batch_total) - Number(row.delivery_payment),
    delivery: sum.delivery + Number(row.delivery_payment),
    tax: sum.tax + Number(row.sales_tax),
    collectedTip: sum.collectedTip + Number(row.tips_before_house_cut),
  }), { net: 0, gross: 0, cash: 0, card: 0, delivery: 0, tax: 0, collectedTip: 0 })
}

export function historicalPayroll(rows: HistoricalPayroll[]) {
  return rows.reduce((sum, row) => {
    if (row.category === 'server') {
      const cashTip = Number(row.cash_tip ?? 0)
      const checkTip = Number(row.check_tip ?? 0)
      const base = Number(row.base ?? 0)
      return {
        ...sum,
        tipOut: sum.tipOut + cashTip + checkTip,
        payrollOut: sum.payrollOut + base,
        totalPayrollOut: sum.totalPayrollOut + cashTip + checkTip + base,
        cashPayrollOut: sum.cashPayrollOut + cashTip,
        checkPayrollOut: sum.checkPayrollOut + checkTip + base,
        server: sum.server + cashTip + checkTip + base,
        serverWages: sum.serverWages + base,
      }
    }
    const cash = Number(row.cash ?? 0)
    const check = Number(row.check ?? 0)
    const department = row.category === 'owner' ? 'manager' : row.category
    return {
      ...sum,
      payrollOut: sum.payrollOut + cash + check,
      totalPayrollOut: sum.totalPayrollOut + cash + check,
      cashPayrollOut: sum.cashPayrollOut + cash,
      checkPayrollOut: sum.checkPayrollOut + check,
      [department]: sum[department] + cash + check,
    }
  }, {
    tipOut: 0, payrollOut: 0, totalPayrollOut: 0,
    cashPayrollOut: 0, checkPayrollOut: 0,
    server: 0, serverWages: 0, kitchen: 0, manager: 0,
  })
}
