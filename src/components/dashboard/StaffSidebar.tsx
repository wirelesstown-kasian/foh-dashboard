'use client'

import { Employee, Schedule } from '@/lib/types'
import { formatTime, calcHours, formatHours, getBusinessDate, isBirthdayToday } from '@/lib/dateUtils'
import { Gift, Phone } from 'lucide-react'

interface Props {
  schedules: Schedule[]
  employees: Employee[]
}

export function StaffSidebar({ schedules, employees }: Props) {
  // schedules are already filtered to today by the parent — use directly
  const businessDate = getBusinessDate()
  const staffOnToday = schedules.map(s => ({
    schedule: s,
    employee: employees.find(e => e.id === s.employee_id),
  })).filter(x => x.employee)

  return (
    <aside className="w-56 shrink-0 bg-white border-r flex flex-col">
      <div className="p-3 border-b">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Today&apos;s Staff</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {businessDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {staffOnToday.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No scheduled staff today</p>
        )}
        {staffOnToday.map(({ schedule, employee }) => (
          <div key={schedule.id} className="rounded-lg border bg-gray-50 p-2.5">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-sm">{employee!.name}</span>
              {isBirthdayToday(employee!.birth_date) && (
                <Gift className="w-3.5 h-3.5 text-pink-500" />
              )}
            </div>
            <div className="text-xs text-muted-foreground capitalize mt-0.5">{employee!.role}</div>
            <div className="text-xs text-gray-700 mt-1">
              {formatTime(schedule.start_time)} – {formatTime(schedule.end_time)}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatHours(calcHours(schedule.start_time, schedule.end_time))}
            </div>
            {employee!.phone && (
              <div className="flex items-center gap-1 mt-1.5 text-xs text-blue-600">
                <Phone className="w-3 h-3" />
                {employee!.phone}
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}
