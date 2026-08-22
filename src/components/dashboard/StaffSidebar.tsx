'use client'

import { useMemo, useState } from 'react'
import { Employee, Schedule, ShiftClock } from '@/lib/types'
import { formatTime, calcHours, formatHours, getBusinessDate, isBirthdayToday } from '@/lib/dateUtils'
import { getDepartmentLabel, getFallbackScheduleDepartment } from '@/lib/organization'
import { ChevronDown, ChevronRight, Gift, Phone } from 'lucide-react'
import { useAppSettings } from '@/components/useAppSettings'

interface Props {
  schedules: Schedule[]
  employees: Employee[]
  clockRecords: ShiftClock[]
}

type StaffEntry = {
  employee: Employee
  schedule: Schedule | null
  record: ShiftClock | null
  department: string
}

export function StaffSidebar({ schedules, employees, clockRecords }: Props) {
  const { departmentDefinitions } = useAppSettings()
  const [openDepartments, setOpenDepartments] = useState<Record<string, boolean>>({})

  const businessDate = getBusinessDate()
  const staffOnToday = useMemo(() => {
    const scheduledEntries = schedules.map((schedule): StaffEntry | null => {
      const employee = employees.find(item => item.id === schedule.employee_id) ?? schedule.employee ?? null
      if (!employee) return null
      const record = [...clockRecords]
        .filter(item => item.employee_id === schedule.employee_id)
        .sort((a, b) => {
          if (!a.clock_out_at && b.clock_out_at) return -1
          if (a.clock_out_at && !b.clock_out_at) return 1
          return b.clock_in_at.localeCompare(a.clock_in_at)
        })[0] ?? null
      const department = schedule?.department ?? getFallbackScheduleDepartment(employee)
      return { employee, schedule, record, department }
    }).filter((entry): entry is StaffEntry => entry !== null)

    const scheduledEmployeeIds = new Set(schedules.map(schedule => schedule.employee_id))
    const clockOnlyEntries = Array.from(new Set(
      clockRecords
        .filter(record => !scheduledEmployeeIds.has(record.employee_id))
        .map(record => record.employee_id)
    )).map((employeeId): StaffEntry | null => {
      const employee = employees.find(item => item.id === employeeId)
      if (!employee) return null
      const record = [...clockRecords]
        .filter(item => item.employee_id === employeeId)
        .sort((a, b) => {
          if (!a.clock_out_at && b.clock_out_at) return -1
          if (a.clock_out_at && !b.clock_out_at) return 1
          return b.clock_in_at.localeCompare(a.clock_in_at)
        })[0] ?? null
      return {
        employee,
        schedule: null,
        record,
        department: getFallbackScheduleDepartment(employee),
      }
    }).filter((entry): entry is StaffEntry => entry !== null)

    return [...scheduledEntries, ...clockOnlyEntries]
  }, [clockRecords, employees, schedules])

  const groupedStaff = useMemo(() => {
    const definitionOrder = new Map(departmentDefinitions.map((definition, index) => [definition.key, index]))
    const groups = new Map<string, typeof staffOnToday>()
    for (const entry of staffOnToday) {
      const key = entry.department || 'server'
      groups.set(key, [...(groups.get(key) ?? []), entry])
    }

    return [...groups.entries()]
      .map(([department, entries]) => ({
        department,
        entries: entries.sort((left, right) => {
          const leftTime = left.schedule?.start_time ?? left.record?.clock_in_at ?? ''
          const rightTime = right.schedule?.start_time ?? right.record?.clock_in_at ?? ''
          return leftTime.localeCompare(rightTime) || left.employee.name.localeCompare(right.employee.name)
        }),
      }))
      .sort((left, right) => (
        (definitionOrder.get(left.department) ?? 999) - (definitionOrder.get(right.department) ?? 999) ||
        getDepartmentLabel(left.department, departmentDefinitions).localeCompare(getDepartmentLabel(right.department, departmentDefinitions))
      ))
  }, [departmentDefinitions, staffOnToday])

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
        {groupedStaff.map(({ department, entries }) => {
          const label = getDepartmentLabel(department, departmentDefinitions)
          const isOpen = openDepartments[department] ?? true

          return (
          <section key={department} className="space-y-2">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-lg px-1 py-0.5 hover:bg-slate-50"
              onClick={() => setOpenDepartments(current => ({ ...current, [department]: !isOpen }))}
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
                <div key={`${employee.id}-${schedule?.id ?? 'clock'}`} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex min-w-0 items-center gap-1">
                      <span className="truncate text-xs font-medium">{employee.name}</span>
                      {isBirthdayToday(employee.birth_date) && (
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
                        <span>{getDepartmentLabel(department, departmentDefinitions)}</span>
                        <span>Clock-in only</span>
                      </>
                    )}
                  </div>
                  {employee.phone && (
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
                      <Phone className="w-2.5 h-2.5" />
                      {employee.phone}
                    </div>
                  )}
                </div>
                )
              })}
            </div>
            )}
          </section>
          )
        })}
      </div>
    </aside>
  )
}
