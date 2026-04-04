'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Employee, Schedule, ScheduleDepartment } from '@/lib/types'
import {
  getWeekDays, getPrevWeek, getNextWeek, formatDate,
  formatDisplayDate, formatWeekRange, getDayName, calcHours, formatHours, formatTime
} from '@/lib/dateUtils'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'

function isEmployeeInDepartment(employee: Employee, department: ScheduleDepartment) {
  return department === 'boh'
    ? employee.role === 'kitchen_staff' || employee.role === 'manager'
    : employee.role !== 'kitchen_staff'
}

interface WeeklyScheduleGridProps {
  department: ScheduleDepartment
}

export function WeeklyScheduleGrid({ department }: WeeklyScheduleGridProps) {
  const [weekRef, setWeekRef] = useState(new Date())
  const [days, setDays] = useState<Date[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [employeeNamesById, setEmployeeNamesById] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    setDays(getWeekDays(weekRef))
  }, [weekRef])

  const loadData = useCallback(async () => {
    if (days.length === 0) return
    setLoading(true)
    const startDate = formatDate(days[0])
    const endDate = formatDate(days[6])

    const [empRes, schRes, draftRes] = await Promise.all([
      supabase.from('employees').select('*').eq('is_active', true).order('name'),
      supabase.from('schedules').select('*, employee:employees(id, name, role, is_active, pin_hash, phone, email, birth_date, created_at)').gte('date', startDate).lte('date', endDate),
      supabase.from('schedule_drafts').select('employee_id, display_order').eq('week_start', startDate).eq('department', department).order('display_order'),
    ])

    const activeEmployees = (empRes.data ?? []).filter(employee => isEmployeeInDepartment(employee, department))
    const loadedSchedules = (schRes.data ?? []) as Array<Schedule & { employee?: Employee | null }>
    const departmentSchedules = loadedSchedules.filter(schedule => {
      const role = schedule.employee?.role ?? 'server'
      return department === 'boh' ? role === 'kitchen_staff' || role === 'manager' : role !== 'kitchen_staff'
    })
    const namesById = new Map<string, string>()

    for (const employee of activeEmployees) {
      namesById.set(employee.id, employee.name)
    }
    for (const schedule of departmentSchedules) {
      if (schedule.employee?.name) {
        namesById.set(schedule.employee_id, schedule.employee.name)
      }
    }

    const scheduledOnlyEmployees = Array.from(
      new Map(
        departmentSchedules
          .filter(schedule => !activeEmployees.some(employee => employee.id === schedule.employee_id))
          .map(schedule => [
            schedule.employee_id,
            schedule.employee ?? {
              id: schedule.employee_id,
              name: namesById.get(schedule.employee_id) ?? `Staff ${schedule.employee_id.slice(0, 6)}`,
              role: department === 'boh' ? 'kitchen_staff' : 'server',
              phone: null,
              email: null,
              pin_hash: '',
              birth_date: null,
              is_active: false,
              created_at: '',
            },
          ])
      ).values()
    )

    const mergedEmployees = [...activeEmployees, ...scheduledOnlyEmployees].sort((a, b) => a.name.localeCompare(b.name))
    const storedRowOrder = Array.from(
      new Set(((draftRes.data ?? []) as Array<{ employee_id: string; display_order: number | null }>).map(row => row.employee_id))
    )
    const rowOrderMap = new Map(storedRowOrder.map((id, index) => [id, index]))
    const orderedEmployees = [...mergedEmployees].sort((a, b) => {
      const aOrder = rowOrderMap.get(a.id)
      const bOrder = rowOrderMap.get(b.id)
      if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder
      if (aOrder !== undefined) return -1
      if (bOrder !== undefined) return 1
      return a.name.localeCompare(b.name)
    })

    setEmployeeNamesById(namesById)
    setEmployees(orderedEmployees)
    setSchedules(departmentSchedules)
    setLoading(false)
  }, [days, department])

  useEffect(() => { loadData() }, [loadData])

  const getShifts = (employeeId: string, date: string) =>
    schedules.filter(s => s.employee_id === employeeId && s.date === date)

  const getDayTotal = (date: string) =>
    schedules
      .filter(s => s.date === date)
      .reduce((sum, s) => sum + calcHours(s.start_time, s.end_time), 0)

  const totalWeekHours = days.reduce((sum, day) => sum + getDayTotal(formatDate(day)), 0)
  const totalShifts = schedules.length

  const exportDepartmentPdf = () => {
    if (days.length === 0) return

    const title = `${department.toUpperCase()} Schedule`
    const weekLabel = formatWeekRange(weekRef)
    const tableRows = employees.map(employee => {
      const dayCells = days.map(day => {
        const shifts = getShifts(employee.id, formatDate(day))
        return `
          <td>
            ${shifts.length === 0 ? '<div class="muted">Off</div>' : shifts.map(shift => `
              <div class="shift">
                <div>${formatTime(shift.start_time)} - ${formatTime(shift.end_time)}</div>
                <div class="muted">${formatHours(calcHours(shift.start_time, shift.end_time))}</div>
              </div>
            `).join('')}
          </td>
        `
      }).join('')

      return `
        <tr>
          <td>
            <div class="employee-name">${employeeNamesById.get(employee.id) ?? employee.name}</div>
            <div class="muted">${employee.role.replace('_', ' ')}</div>
          </td>
          ${dayCells}
        </tr>
      `
    }).join('')

    const printWindow = window.open('', '_blank', 'width=1400,height=900')
    if (!printWindow) return

    printWindow.document.write(`
      <html>
        <head>
          <title>${title} PDF</title>
          <style>
            @page { size: A4 landscape; margin: 10mm; }
            body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif; margin: 0; padding: 18px; color: #111827; }
            h1 { margin: 0 0 4px 0; font-size: 28px; }
            .sub { margin-bottom: 14px; color: #475569; font-size: 14px; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            th, td { border: 1.5px solid #475569; vertical-align: top; padding: 10px; font-size: 13px; }
            th { background: #dbe4ee; font-weight: 700; }
            .employee-name { font-weight: 800; font-size: 14px; margin-bottom: 2px; }
            .muted { color: #475569; font-size: 12px; }
            .shift { background: #e2e8f0; border: 1.5px solid #64748b; border-radius: 10px; padding: 7px; margin-bottom: 6px; }
            .totals-row td { background: #e5e7eb; text-align: center; vertical-align: middle; }
            .totals-label { font-weight: 700; text-align: left; }
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
          </style>
        </head>
        <body>
          <h1>${title}</h1>
          <div class="sub">${weekLabel}</div>
          <table>
            <thead>
              <tr>
                <th style="width: 150px;">Employee</th>
                ${days.map(day => `
                  <th>
                    <div>${getDayName(day)}</div>
                    <div class="muted">${formatDisplayDate(day)}</div>
                  </th>
                `).join('')}
              </tr>
            </thead>
            <tbody>
              ${tableRows}
              <tr class="totals-row">
                <td class="totals-label">Daily Total Hours</td>
                ${days.map(day => `
                  <td>
                    <div style="font-weight:800;font-size:16px;">${formatHours(getDayTotal(formatDate(day)))}</div>
                  </td>
                `).join('')}
              </tr>
            </tbody>
          </table>
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  return (
    <div className="space-y-5">
      <div className="rounded-[28px] border border-slate-300 bg-[linear-gradient(180deg,#f7f3ea_0%,#ffffff_78%)] p-5 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center rounded-full border border-slate-300 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-600">
              {department === 'boh' ? 'Back Of House' : 'Front Of House'}
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
                {department === 'boh' ? 'BOH Weekly Schedule' : 'FOH Weekly Schedule'}
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                {department === 'boh'
                  ? 'Kitchen and manager coverage for the week.'
                  : 'Front-of-house lineup and shift coverage for the week.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Staff</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{employees.length}</div>
              </div>
              <div className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Shifts</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{totalShifts}</div>
              </div>
              <div className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Week Hours</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{formatHours(totalWeekHours)}</div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-300 bg-white/90 p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className="h-11 w-11 rounded-2xl" onClick={() => setWeekRef(getPrevWeek(weekRef))}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <div className="min-w-56 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Week Of</div>
                <div className="mt-1 text-base font-semibold text-slate-900">{formatWeekRange(weekRef)}</div>
              </div>
              <Button variant="outline" size="sm" className="h-11 w-11 rounded-2xl" onClick={() => setWeekRef(getNextWeek(weekRef))}>
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-11 rounded-2xl px-4" onClick={() => setWeekRef(new Date())}>
                Today&apos;s Week
              </Button>
              <Button variant="outline" size="sm" className="h-11 rounded-2xl px-4" onClick={exportDepartmentPdf}>
                <Download className="w-4 h-4 mr-2" />
                Export PDF
              </Button>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-[30px] border-2 border-slate-700 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
          <table className="w-full min-w-[1040px] text-[15px]">
            <thead className="bg-[linear-gradient(180deg,#1f2937_0%,#334155_100%)] text-white">
              <tr>
                <th className="sticky left-0 z-10 text-left p-4 font-semibold text-base w-44 border-b-2 border-slate-700 bg-[linear-gradient(180deg,#111827_0%,#1f2937_100%)]">Employee</th>
                {days.map(d => (
                  <th key={d.toISOString()} className="text-center p-4 font-semibold text-base border-b-2 border-l border-slate-500 min-w-32">
                    <div className="text-[15px] font-semibold">{getDayName(d)}</div>
                    <div className="mt-1 text-sm font-normal text-slate-200">{formatDisplayDate(d)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => {
                return (
                  <tr key={emp.id} className="border-b border-slate-300 odd:bg-white even:bg-[#f6f1e8] hover:bg-[#ebe3d2]">
                    <td className="sticky left-0 z-[1] p-4 align-top border-r border-slate-300 bg-inherit">
                      <div className="font-semibold text-base text-slate-900">{employeeNamesById.get(emp.id) ?? emp.name}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">{emp.role.replace('_', ' ')}{!emp.is_active ? ' • archived' : ''}</div>
                    </td>
                    {days.map(d => {
                      const dateStr = formatDate(d)
                      const shifts = getShifts(emp.id, dateStr)
                      return (
                        <td key={d.toISOString()} className="border-l border-slate-300 p-3 align-top">
                          {shifts.length === 0 ? (
                            <div className="flex min-h-[76px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 text-sm font-medium uppercase tracking-[0.18em] text-slate-400">
                              Off
                            </div>
                          ) : (
                            shifts.map((s, i) => (
                              <div key={i} className="mb-2 rounded-2xl border-2 border-slate-700 bg-[linear-gradient(180deg,#faf7f2_0%,#efe7d7_100%)] p-3 text-sm shadow-sm">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                                  Shift
                                </div>
                                <div className="mt-1 font-semibold text-[15px] text-slate-900">
                                  {formatTime(s.start_time)} – {formatTime(s.end_time)}
                                </div>
                                <div className="mt-1 text-sm text-slate-600">{formatHours(calcHours(s.start_time, s.end_time))}</div>
                              </div>
                            ))
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {employees.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-muted-foreground">
                    No employees found. Add staff in the Staffing tab.
                  </td>
                </tr>
              )}
            </tbody>
            {employees.length > 0 && (
              <tfoot className="bg-[linear-gradient(180deg,#d6d3d1_0%,#e7e5e4_100%)]">
                <tr>
                  <td className="sticky left-0 z-10 p-4 text-base font-semibold border-t-2 border-slate-700 bg-[linear-gradient(180deg,#d6d3d1_0%,#e7e5e4_100%)]">Daily Total Hours</td>
                  {days.map(d => (
                    <td key={`total-${d.toISOString()}`} className="border-t-2 border-l border-slate-500 p-4 text-center">
                      <div className="text-xl font-semibold text-slate-900">{formatHours(getDayTotal(formatDate(d)))}</div>
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  )
}
