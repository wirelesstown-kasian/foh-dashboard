'use client'

import { Employee, Schedule, ShiftClock } from '@/lib/types'
import { formatTime, calcHours, formatHours, getBusinessDate, isBirthdayToday } from '@/lib/dateUtils'
import { Gift, Phone } from 'lucide-react'

interface Props {
  schedules: Schedule[]
  employees: Employee[]
  clockRecords: ShiftClock[]
}

function isBohRole(role: Employee['role']) {
  return role === 'kitchen_staff' || role === 'manager'
}

export function StaffSidebar({ schedules, employees, clockRecords }: Props) {
  // schedules are already filtered to today by the parent — use directly
  const businessDate = getBusinessDate()
  const staffOnToday = schedules.map(s => ({
    schedule: s,
    employee: employees.find(e => e.id === s.employee_id),
  })).filter(x => x.employee)

  const groupedStaff = {
    foh: staffOnToday.filter(({ employee }) => !isBohRole(employee!.role)),
    boh: staffOnToday.filter(({ employee }) => isBohRole(employee!.role)),
  }

  return (
    <aside className="w-72 shrink-0 bg-white border-r flex flex-col">
      <div className="p-3 border-b">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Today&apos;s Staff</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {businessDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {staffOnToday.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No scheduled staff today</p>
        )}
        {([
          ['FOH', groupedStaff.foh],
          ['BOH', groupedStaff.boh],
        ] as const).map(([label, entries]) => (
          <section key={label} className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                {entries.length}
              </span>
            </div>
            <div className="space-y-2">
              {entries.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-400">
                  No scheduled {label} staff
                </div>
              )}
              {entries.map(({ schedule, employee }) => (
                <div key={schedule.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                  {(() => {
                    const record = clockRecords.find(item => item.employee_id === employee!.id)
                    const statusLabel = !record
                      ? 'Not clocked in'
                      : record.approval_status === 'pending_review'
                        ? 'Pending review'
                        : record.clock_out_at
                          ? 'Clocked out'
                          : 'Clocked in'
                    const statusClass = !record
                      ? 'bg-slate-200 text-slate-700'
                      : record.approval_status === 'pending_review'
                        ? 'bg-amber-100 text-amber-700'
                        : record.clock_out_at
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-emerald-100 text-emerald-700'
                    return (
                      <div className="mb-2 flex justify-end">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusClass}`}>
                          {statusLabel}
                        </span>
                      </div>
                    )
                  })()}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-sm">{employee!.name}</span>
                      {isBirthdayToday(employee!.birth_date) && (
                        <Gift className="w-3.5 h-3.5 text-pink-500" />
                      )}
                    </div>
                    <span className="text-[11px] uppercase tracking-wide text-slate-500">{employee!.role.replace('_', ' ')}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-700">
                    <span>{formatTime(schedule.start_time)} – {formatTime(schedule.end_time)}</span>
                    <span className="text-slate-500">{formatHours(calcHours(schedule.start_time, schedule.end_time))}</span>
                  </div>
                  {employee!.phone && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-slate-600">
                      <Phone className="w-3 h-3" />
                      {employee!.phone}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  )
}
