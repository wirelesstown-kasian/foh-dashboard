'use client'

import { Employee, Schedule, ShiftClock, TaskCompletion } from '@/lib/types'

interface Props {
  employees: Employee[]
  completions: TaskCompletion[]
  schedules: Schedule[]
  clockRecords: ShiftClock[]
  today: string
}

export function PerformanceBar({ employees, completions, schedules, clockRecords, today }: Props) {
  const isCompleted = (completion: TaskCompletion) => completion.status !== 'incomplete'
  const clockedInIds = new Set(
    clockRecords
      .filter(record => record.clock_in_at && !record.clock_out_at)
      .map(record => record.employee_id)
  )
  const visibleEmployees = clockedInIds.size > 0
    ? employees.filter(employee => clockedInIds.has(employee.id))
    : employees.filter(employee => new Set(schedules.filter(s => s.date === today).map(s => s.employee_id)).has(employee.id))

  const dailyCounts = visibleEmployees.map(emp => ({
    emp,
    daily: completions.filter(c => c.employee_id === emp.id && c.session_date === today && isCompleted(c)).length,
    monthly: completions.filter(c => c.employee_id === emp.id && isCompleted(c)).length,
  })).sort((a, b) => b.daily - a.daily || b.monthly - a.monthly || a.emp.name.localeCompare(b.emp.name))

  if (clockedInIds.size === 0) return null
  if (dailyCounts.length === 0) return null

  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {dailyCounts.map(({ emp, daily, monthly }) => (
        <div key={emp.id} className="flex items-center gap-2 bg-white rounded-lg border px-3 py-2 shrink-0">
          <div>
            <p className="font-medium text-sm">{emp.name}</p>
            <p className="text-xs text-muted-foreground capitalize">{emp.role}</p>
          </div>
          <div className="flex gap-2 ml-2">
            <div className="text-center">
              <p className="text-lg font-bold text-amber-600">{daily}</p>
              <p className="text-xs text-muted-foreground">today</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-blue-600">{monthly}</p>
              <p className="text-xs text-muted-foreground">month</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
