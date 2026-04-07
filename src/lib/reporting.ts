import { addDays, addMonths, addWeeks, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek, subDays, subMonths, subWeeks } from 'date-fns'
import { Employee } from '@/lib/types'
import { employeeMatchesScheduleDepartment } from '@/lib/organization'

export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'custom'
export type ReportDepartment = 'foh' | 'boh'

export function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`
}

export function getPercent(value: number) {
  return `${value.toFixed(1)}%`
}

export function isEmployeeInDepartment(employee: Employee, department: ReportDepartment) {
  return employeeMatchesScheduleDepartment(employee, department)
}

export function getReportRange(period: ReportPeriod, refDate: Date, customStart: string, customEnd: string): [string, string] {
  if (period === 'custom' && customStart && customEnd) {
    return customStart <= customEnd ? [customStart, customEnd] : [customEnd, customStart]
  }

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

export function getReportLabel(period: ReportPeriod, refDate: Date, customStart: string, customEnd: string) {
  if (period === 'custom' && customStart && customEnd) {
    if (customStart === customEnd) return format(new Date(`${customStart}T12:00:00`), 'MMM d, yyyy')
    return `${format(new Date(`${customStart}T12:00:00`), 'MMM d, yyyy')} - ${format(new Date(`${customEnd}T12:00:00`), 'MMM d, yyyy')}`
  }
  if (period === 'daily') return format(refDate, 'MMM d, yyyy')
  if (period === 'weekly') {
    return `Week of ${format(startOfWeek(refDate, { weekStartsOn: 1 }), 'MMM d, yyyy')}`
  }
  return format(refDate, 'MMMM yyyy')
}

export function shiftReportDate(period: ReportPeriod, refDate: Date, direction: 'prev' | 'next') {
  if (period === 'custom') return refDate
  if (period === 'daily') return direction === 'prev' ? subDays(refDate, 1) : addDays(refDate, 1)
  if (period === 'weekly') return direction === 'prev' ? subWeeks(refDate, 1) : addWeeks(refDate, 1)
  return direction === 'prev' ? subMonths(refDate, 1) : addMonths(refDate, 1)
}
