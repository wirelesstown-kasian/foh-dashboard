'use client'

import { Employee, Schedule, TaskCompletion } from '@/lib/types'

interface Props {
  employees: Employee[]
  completions: TaskCompletion[]
  schedules: Schedule[]
  today: string
}

export function PerformanceBar({ employees, completions, schedules, today }: Props) {
  const isCompleted = (completion: TaskCompletion) => completion.status !== 'incomplete'
  const scheduledEmployeeIds = new Set(schedules.filter(schedule => schedule.date === today).map(schedule => schedule.employee_id))
  const scheduledEmployees = employees.filter(employee => scheduledEmployeeIds.has(employee.id))

  const dailyCounts = scheduledEmployees.map(emp => ({
    emp,
    daily: completions.filter(c => c.employee_id === emp.id && c.session_date === today && isCompleted(c)).length,
    monthly: completions.filter(c => c.employee_id === emp.id && isCompleted(c)).length,
  })).sort((a, b) => b.daily - a.daily || b.monthly - a.monthly || a.emp.name.localeCompare(b.emp.name))

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
