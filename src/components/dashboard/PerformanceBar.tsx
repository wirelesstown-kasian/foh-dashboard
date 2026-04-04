'use client'

import { Employee, TaskCompletion } from '@/lib/types'
import { format } from 'date-fns'

interface Props {
  employees: Employee[]
  completions: TaskCompletion[]
  today: string
}

export function PerformanceBar({ employees, completions, today }: Props) {
  const thisMonth = format(new Date(), 'yyyy-MM')
  const isCompleted = (completion: TaskCompletion) => completion.status !== 'incomplete'

  const dailyCounts = employees.map(emp => ({
    emp,
    daily: completions.filter(c => c.employee_id === emp.id && c.session_date === today && isCompleted(c)).length,
    monthly: completions.filter(c => c.employee_id === emp.id && c.session_date.startsWith(thisMonth) && isCompleted(c)).length,
  })).filter(x => x.daily > 0 || x.monthly > 0)
    .sort((a, b) => b.daily - a.daily)

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
