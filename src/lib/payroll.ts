import { EodReport, Employee, PaymentMethod, PayrollRun, PayrollRunItem, Schedule, ShiftClock } from '@/lib/types'
import { clockMatchesWorkDepartment, getClockWorkDepartment, getEffectiveClockHours, isClockPending } from '@/lib/clockUtils'
import { getEmployeeScheduleDepartments } from '@/lib/employeeSelect'
import { calculateTips } from '@/lib/tipCalc'
import { isTipEligibleForWork } from '@/lib/tipEligibility'

export type PayrollDraftRow = {
  employee_id: string
  employee_name: string
  role: string
  department: string
  payment_method: PaymentMethod | ''
  hours: number
  tips: number
  base_wages: number
  guarantee_top_up: number
  commission: number
  deductions: number
  gross_pay: number
  net_pay: number
  payout_amount: number
  cash_rounding: number
  has_auto_clock_out: boolean
  has_open_clock: boolean
  has_tip_data: boolean
  memo: string
  display_order: number
}

export type PayrollTotals = {
  cash: number
  check: number
  ach: number
  gross: number
  deductions: number
  net: number
}

export const DEFAULT_PAYMENT_METHOD: PaymentMethod = 'cash'

export function paymentMethodLabel(paymentMethod: PaymentMethod | '' | null | undefined) {
  if (paymentMethod === 'ach') return 'ACH'
  if (paymentMethod === 'check') return 'Check'
  if (paymentMethod === 'cash') return 'Cash'
  return 'Select'
}

export function normalizeMoney(value: unknown) {
  const numberValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : 0
  return Number.isFinite(numberValue) ? Math.round(numberValue * 100) / 100 : 0
}

export function calculatePayrollAmounts(row: Pick<PayrollDraftRow, 'hours' | 'tips' | 'base_wages' | 'guarantee_top_up' | 'commission' | 'deductions' | 'payment_method'>) {
  const gross = normalizeMoney(row.base_wages + row.guarantee_top_up + row.tips + row.commission)
  const net = normalizeMoney(Math.max(0, gross - row.deductions))
  const payout = row.payment_method === 'cash' ? Math.floor(net) : net
  return {
    gross_pay: gross,
    net_pay: net,
    payout_amount: payout,
    cash_rounding: normalizeMoney(net - payout),
  }
}

export function getPayrollTotals(rows: Array<Pick<PayrollDraftRow, 'payment_method' | 'payout_amount' | 'gross_pay' | 'deductions' | 'net_pay'>>) {
  return rows.reduce<PayrollTotals>((totals, row) => {
    if (row.payment_method === 'cash') totals.cash += row.payout_amount
    if (row.payment_method === 'check') totals.check += row.payout_amount
    if (row.payment_method === 'ach') totals.ach += row.payout_amount
    totals.gross += row.gross_pay
    totals.deductions += row.deductions
    totals.net += row.net_pay
    return totals
  }, { cash: 0, check: 0, ach: 0, gross: 0, deductions: 0, net: 0 })
}

type DailyPayrollTip = {
  hours: number
  tips: number
}

function addTipToMap(tipsByEmployee: Map<string, number>, employeeId: string, tips: number) {
  tipsByEmployee.set(employeeId, (tipsByEmployee.get(employeeId) ?? 0) + Number(tips ?? 0))
}

function getSavedDailyTips(report: EodReport & { tip_distributions?: { employee_id: string; hours_worked?: number | null; net_tip: number }[] }) {
  const savedTips = new Map<string, DailyPayrollTip>()
  for (const distribution of report.tip_distributions ?? []) {
    const current = savedTips.get(distribution.employee_id) ?? { hours: 0, tips: 0 }
    savedTips.set(distribution.employee_id, {
      hours: current.hours + Number(distribution.hours_worked ?? 0),
      tips: current.tips + Number(distribution.net_tip ?? 0),
    })
  }
  return savedTips
}

function employeeHasDepartmentClock(
  employeeId: string,
  sessionDate: string,
  department: string,
  employees: Employee[],
  clockRecords: ShiftClock[],
  schedules: Schedule[] = []
) {
  if (department === 'all') return true
  const employee = employees.find(item => item.id === employeeId)
  return clockRecords.some(record =>
    record.employee_id === employeeId &&
    record.session_date === sessionDate &&
    clockMatchesWorkDepartment(record, department, employee, schedules)
  )
}

function getCalculatedDailyTips(report: EodReport, employees: Employee[], clockRecords: ShiftClock[], schedules: Schedule[] = []) {
  const employeeById = new Map(employees.map(employee => [employee.id, employee]))
  const hoursByEmployee = new Map<string, number>()

  for (const record of clockRecords) {
    if (record.session_date !== report.session_date) continue
    const employee = employeeById.get(record.employee_id)
    if (!employee || !isTipEligibleForWork(employee, getClockWorkDepartment(record, employee, schedules))) continue

    const hours = getEffectiveClockHours(record)
    if (hours <= 0) continue
    hoursByEmployee.set(record.employee_id, (hoursByEmployee.get(record.employee_id) ?? 0) + hours)
  }

  const tipResults = calculateTips(
    Number(report.tip_total ?? 0),
    [...hoursByEmployee.entries()].map(([employeeId, hours]) => ({
      employee_id: employeeId,
      hours_worked: hours,
      tip_pool_hourly_rate: employeeById.get(employeeId)?.tip_pool_hourly_rate ?? null,
    }))
  )

  return new Map(
    tipResults.map(result => [result.employee_id, {
      hours: result.hours_worked,
      tips: result.net_tip,
    }])
  )
}

function shouldUseCalculatedDailyTips(savedTips: Map<string, DailyPayrollTip>, calculatedTips: Map<string, DailyPayrollTip>) {
  if (calculatedTips.size === 0) return false

  for (const [employeeId, calculated] of calculatedTips) {
    const saved = savedTips.get(employeeId)
    if (!saved) return true
    if (Math.abs(saved.hours - calculated.hours) > 0.01) return true
  }

  return false
}

export function getSavedTipMap(
  reports: Array<EodReport & { tip_distributions?: { employee_id: string; hours_worked?: number | null; net_tip: number }[] }>,
  startDate: string,
  endDate: string,
  employees: Employee[] = [],
  clockRecords: ShiftClock[] = [],
  department = 'all',
  schedules: Schedule[] = []
) {
  const tipsByEmployee = new Map<string, number>()
  for (const report of reports) {
    if (report.session_date < startDate || report.session_date > endDate) continue
    const savedTips = getSavedDailyTips(report)
    const calculatedTips = getCalculatedDailyTips(report, employees, clockRecords, schedules)
    const dailyTips = shouldUseCalculatedDailyTips(savedTips, calculatedTips) ? calculatedTips : savedTips
    for (const [employeeId, tip] of dailyTips) {
      if (!employeeHasDepartmentClock(employeeId, report.session_date, department, employees, clockRecords, schedules)) continue
      addTipToMap(tipsByEmployee, employeeId, tip.tips)
    }
  }
  return tipsByEmployee
}

export function buildPayrollDraftRows({
  employees,
  clockRecords,
  eodReports,
  department,
  startDate,
  endDate,
  schedules = [],
}: {
  employees: Employee[]
  clockRecords: ShiftClock[]
  eodReports: Array<EodReport & { tip_distributions?: { employee_id: string; hours_worked?: number | null; net_tip: number }[] }>
  department: string
  startDate: string
  endDate: string
  schedules?: Schedule[]
}) {
  const tipsByEmployee = getSavedTipMap(eodReports, startDate, endDate, employees, clockRecords, department, schedules)
  const employeeById = new Map(employees.map(employee => [employee.id, employee]))
  const clocksByEmployee = new Map<string, ShiftClock[]>()

  for (const record of clockRecords) {
    if (record.session_date < startDate || record.session_date > endDate) continue
    const employee = employeeById.get(record.employee_id)
    if (department !== 'all' && !clockMatchesWorkDepartment(record, department, employee, schedules)) continue
    if (!clocksByEmployee.has(record.employee_id)) clocksByEmployee.set(record.employee_id, [])
    clocksByEmployee.get(record.employee_id)!.push(record)
  }

  return employees
    .filter(employee =>
      department === 'all' ||
      getEmployeeScheduleDepartments(employee).includes(department) ||
      clocksByEmployee.has(employee.id)
    )
    .map((employee, index): PayrollDraftRow => {
      const employeeClocks = clocksByEmployee.get(employee.id) ?? []
      const hours = normalizeMoney(employeeClocks.reduce((sum, record) => sum + getEffectiveClockHours(record), 0))
      const hasTipData = tipsByEmployee.has(employee.id)
      const tips = normalizeMoney(tipsByEmployee.get(employee.id) ?? 0)
      const baseWages = normalizeMoney(hours * Number(employee.hourly_wage ?? 0))
      const guaranteeTarget = normalizeMoney(hours * Number(employee.guaranteed_hourly ?? 0))
      const guaranteeTopUp = normalizeMoney(Math.max(0, guaranteeTarget - (baseWages + tips)))
      const paymentMethod: PaymentMethod | '' = employee.payment_method ?? ''
      const baseRow = {
        employee_id: employee.id,
        employee_name: employee.name,
        role: employee.role,
        department: department === 'all' ? (getEmployeeScheduleDepartments(employee)[0] ?? employee.primary_department ?? 'all') : department,
        payment_method: paymentMethod,
        hours,
        tips,
        base_wages: baseWages,
        guarantee_top_up: guaranteeTopUp,
        commission: 0,
        deductions: 0,
        gross_pay: 0,
        net_pay: 0,
        payout_amount: 0,
        cash_rounding: 0,
        has_auto_clock_out: employeeClocks.some(record => record.auto_clock_out),
        has_open_clock: employeeClocks.some(record => !record.clock_out_at || isClockPending(record)),
        has_tip_data: hasTipData,
        memo: '',
        display_order: index,
      }
      return { ...baseRow, ...calculatePayrollAmounts(baseRow) }
    })
}

export function payrollItemToDraftRow(item: PayrollRunItem): PayrollDraftRow {
  return {
    employee_id: item.employee_id ?? '',
    employee_name: item.employee_name,
    role: item.role ?? '',
    department: item.department,
    payment_method: item.payment_method ?? '',
    hours: Number(item.hours ?? 0),
    tips: Number(item.tips ?? 0),
    base_wages: Number(item.base_wages ?? 0),
    guarantee_top_up: Number(item.guarantee_top_up ?? 0),
    commission: Number(item.commission ?? 0),
    deductions: Number(item.deductions ?? 0),
    gross_pay: Number(item.gross_pay ?? 0),
    net_pay: Number(item.net_pay ?? 0),
    payout_amount: Number(item.payout_amount ?? 0),
    cash_rounding: Number(item.cash_rounding ?? 0),
    has_auto_clock_out: item.has_auto_clock_out,
    has_open_clock: item.has_open_clock,
    has_tip_data: Number(item.tips ?? 0) > 0,
    memo: item.memo ?? '',
    display_order: item.display_order,
  }
}

export type SavedPayrollRun = PayrollRun & { payroll_run_items?: PayrollRunItem[] }
