import { clockMatchesWorkDepartment, getClockWorkDepartment, getEffectiveClockHours, getMealBreakState } from '@/lib/clockUtils'
import { getDailyGuaranteeTopUp } from '@/lib/payroll'
import type { DailyTipAmount, DailyTipReport } from '@/lib/dailyTips'
import type { ReportDepartment } from '@/lib/reporting'
import type { WageWorkDetail } from '@/lib/wageReportDetails'
import type { Employee, Schedule, ShiftClock } from '@/lib/types'

function getClockRecordEmployee(record: ShiftClock, employees: Employee[]) {
  const relatedEmployee = record.employee as Employee | Employee[] | undefined
  if (Array.isArray(relatedEmployee)) {
    return relatedEmployee[0] ?? employees.find(employee => employee.id === record.employee_id) ?? null
  }
  return relatedEmployee ?? employees.find(employee => employee.id === record.employee_id) ?? null
}

export function calculateDailyWageDetail({
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
  report?: DailyTipReport
  calculatedTip?: DailyTipAmount
  savedTip?: DailyTipAmount
  useCalculatedTips: boolean
}): WageWorkDetail | null {
  const matchingClockRecords = (clockRecordsByEmployeeDate.get(`${emp.id}:${date}`) ?? [])
    .filter(record => clockMatchesWorkDepartment(record, department, getClockRecordEmployee(record, employees) ?? emp, schedules))
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
