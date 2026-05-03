'use client'

import { useState } from 'react'
import { Employee, Schedule, ShiftClock } from '@/lib/types'
import { formatTime, calcHours, formatHours, getBusinessDate, isBirthdayToday } from '@/lib/dateUtils'
import { getDepartmentLabel, getFallbackScheduleDepartment, getRoleLabel } from '@/lib/organization'
import { ChevronDown, ChevronRight, Gift, Phone } from 'lucide-react'
import { useAppSettings } from '@/components/useAppSettings'

interface Props {
  schedules: Schedule[]
  employees: Employee[]
  clockRecords: ShiftClock[]
}

export function StaffSidebar({ schedules, employees, clockRecords }: Props) {
  const { roleDefinitions, departmentDefinitions } = useAppSettings()
  const [fohOpen, setFohOpen] = useState(true)
  const [bohOpen, setBohOpen] = useState(false)

  const businessDate = getBusinessDate()
  const scheduledEmployeeIds = new Set(schedules.map(schedule => schedule.employee_id))
  const clockActivityEmployeeIds = new Set(clockRecords.map(record => record.employee_id))
  const staffIds = Array.from(new Set([...scheduledEmployeeIds, ...clockActivityEmployeeIds]))
  const staffOnToday = staffIds.map(employeeId => {
    const employee = employees.find(item => item.id === employeeId)
    const schedule = schedules.find(item => item.employee_id === employeeId) ?? null
    const record = [...clockRecords]
      .filter(item => item.employee_id === employeeId)
      .sort((a, b) => {
        if (!a.clock_out_at && b.clock_out_at) return -1
        if (a.clock_out_at && !b.clock_out_at) return 1
        return b.clock_in_at.localeCompare(a.clock_in_at)
      })[0] ?? null
    return { employee, schedule, record }
  }).filter(entry => entry.employee)

  const groupedStaff = {
    foh: staffOnToday.filter(({ employee, schedule }) => (schedule?.department ?? getFallbackScheduleDepartment(employee!)) === 'foh'),
    boh: staffOnToday.filter(({ employee, schedule }) => (schedule?.department ?? getFallbackScheduleDepartment(employee!)) === 'boh'),
  }

  return (
    <aside className="flex min-h-0 w-72 shrink-0 flex-col border-r bg-white">
      <div className="p-3 border-b">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Today&apos;s Staff</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {businessDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {staffOnToday.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No scheduled or clocked-in staff today</p>
        )}
        {([
          ['FOH', groupedStaff.foh, fohOpen, setFohOpen],
          ['BOH', groupedStaff.boh, bohOpen, setBohOpen],
        ] as const).map(([label, entries, isOpen, setOpen]) => (
          <section key={label} className="space-y-2">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-lg px-1 py-0.5 hover:bg-slate-50"
              onClick={() => setOpen(v => !v)}
            >
              <div className="flex items-center gap-1.5">
                {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</h3>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                {entries.length}
              </span>
            </button>
            {isOpen && (
            <div className="space-y-1">
              {entries.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-400">
                  No scheduled {label} staff
                </div>
              )}
              {entries.map(({ schedule, employee, record }) => {
                const statusLabel = !record
                  ? 'Not in'
                  : record.approval_status === 'pending_review'
                    ? 'Pending'
                    : record.clock_out_at
                      ? 'Out'
                      : 'In'
                const statusClass = !record
                  ? 'bg-slate-200 text-slate-600'
                  : record.approval_status === 'pending_review'
                    ? 'bg-amber-100 text-amber-700'
                    : record.clock_out_at
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-emerald-100 text-emerald-700'
                return (
                <div key={`${employee!.id}-${schedule?.id ?? 'clock'}`} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex min-w-0 items-center gap-1">
                      <span className="truncate text-xs font-medium">{employee!.name}</span>
                      {isBirthdayToday(employee!.birth_date) && (
                        <Gift className="w-3 h-3 shrink-0 text-pink-500" />
                      )}
                    </div>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${statusClass}`}>
                      {statusLabel}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-1 text-[11px] text-slate-500">
                    {schedule ? (
                      <>
                        <span>{formatTime(schedule.start_time)}–{formatTime(schedule.end_time)}</span>
                        <span>{formatHours(calcHours(schedule.start_time, schedule.end_time))}</span>
                      </>
                    ) : (
                      <>
                        <span>{getDepartmentLabel(employee?.primary_department ?? 'foh', departmentDefinitions)}</span>
                        <span>Clock-in only</span>
                      </>
                    )}
                  </div>
                  {employee!.phone && (
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
                      <Phone className="w-2.5 h-2.5" />
                      {employee!.phone}
                    </div>
                  )}
                </div>
                )
              })}
            </div>
            )}
          </section>
        ))}
      </div>
    </aside>
  )
}
