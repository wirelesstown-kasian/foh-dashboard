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
  return department === 'boh' ? employee.role === 'kitchen_staff' : employee.role !== 'kitchen_staff'
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

    const [empRes, schRes] = await Promise.all([
      supabase.from('employees').select('*').eq('is_active', true).order('name'),
      supabase.from('schedules').select('*, employee:employees(id, name, role, is_active, pin_hash, phone, email, birth_date, created_at)').gte('date', startDate).lte('date', endDate),
    ])

    const activeEmployees = (empRes.data ?? []).filter(employee => isEmployeeInDepartment(employee, department))
    const loadedSchedules = (schRes.data ?? []) as Array<Schedule & { employee?: Employee | null }>
    const departmentSchedules = loadedSchedules.filter(schedule => {
      const role = schedule.employee?.role ?? 'server'
      return department === 'boh' ? role === 'kitchen_staff' : role !== 'kitchen_staff'
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

    setEmployeeNamesById(namesById)
    setEmployees([...activeEmployees, ...scheduledOnlyEmployees].sort((a, b) => a.name.localeCompare(b.name)))
    setSchedules(departmentSchedules)
    setLoading(false)
  }, [days, department])

  useEffect(() => { loadData() }, [loadData])

  const getShifts = (employeeId: string, date: string) =>
    schedules.filter(s => s.employee_id === employeeId && s.date === date)

  const getWeeklyHours = (employeeId: string) =>
    schedules
      .filter(s => s.employee_id === employeeId)
      .reduce((sum, s) => sum + calcHours(s.start_time, s.end_time), 0)

  const getDayTotal = (date: string) =>
    schedules
      .filter(s => s.date === date)
      .reduce((sum, s) => sum + calcHours(s.start_time, s.end_time), 0)

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
          <td class="weekly-total">${formatHours(getWeeklyHours(employee.id))}</td>
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
            h1 { margin: 0 0 4px 0; font-size: 26px; }
            .sub { margin-bottom: 12px; color: #6b7280; font-size: 13px; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            th, td { border: 1px solid #d1d5db; vertical-align: top; padding: 8px; font-size: 11px; }
            th { background: #f8fafc; font-weight: 700; }
            .employee-name { font-weight: 700; margin-bottom: 2px; }
            .muted { color: #6b7280; font-size: 11px; }
            .shift { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 5px; margin-bottom: 5px; }
            .weekly-total { font-weight: 700; text-align: center; }
            .totals-row td { background: #fff7ed; text-align: center; vertical-align: middle; }
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
                <th style="width: 80px;">Weekly</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
              <tr class="totals-row">
                <td class="totals-label">Daily Total Hours</td>
                ${days.map(day => `
                  <td>
                    <div style="font-weight:700">${formatHours(getDayTotal(formatDate(day)))}</div>
                    <div class="muted">${formatDisplayDate(day)}</div>
                  </td>
                `).join('')}
                <td class="weekly-total">
                  ${formatHours(employees.reduce((sum, employee) => sum + getWeeklyHours(employee.id), 0))}
                </td>
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
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">{department === 'boh' ? 'BOH Schedule' : 'FOH Schedule'}</h1>
          <p className="text-sm text-muted-foreground">
            {department === 'boh' ? 'Kitchen staff schedule view.' : 'Front-of-house weekly schedule view.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setWeekRef(getPrevWeek(weekRef))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="font-medium text-sm min-w-48 text-center">{formatWeekRange(weekRef)}</span>
          <Button variant="outline" size="sm" onClick={() => setWeekRef(getNextWeek(weekRef))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekRef(new Date())}>
            Today&apos;s Week
          </Button>
          <Button variant="outline" size="sm" onClick={exportDepartmentPdf}>
            <Download className="w-4 h-4 mr-2" />
            Export PDF
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 font-semibold w-36 border-b">Employee</th>
                {days.map(d => (
                  <th key={d.toISOString()} className="text-center p-3 font-semibold border-b min-w-32">
                    <div>{getDayName(d)}</div>
                    <div className="text-xs text-muted-foreground font-normal">{formatDisplayDate(d)}</div>
                  </th>
                ))}
                <th className="text-center p-3 font-semibold border-b w-24">Weekly</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => {
                const weekHrs = getWeeklyHours(emp.id)
                return (
                  <tr key={emp.id} className="border-b hover:bg-gray-50">
                    <td className="p-3">
                      <div className="font-medium">{employeeNamesById.get(emp.id) ?? emp.name}</div>
                      <div className="text-xs text-muted-foreground capitalize">{emp.role}{!emp.is_active ? ' • archived' : ''}</div>
                    </td>
                    {days.map(d => {
                      const dateStr = formatDate(d)
                      const shifts = getShifts(emp.id, dateStr)
                      return (
                        <td key={d.toISOString()} className="p-2 align-top">
                          {shifts.length === 0 ? (
                            <div className="text-center text-gray-300 text-lg">—</div>
                          ) : (
                            shifts.map((s, i) => (
                              <div key={i} className="bg-blue-50 border border-blue-200 rounded p-1.5 mb-1 text-xs">
                                <div className="font-medium text-blue-800">
                                  {formatTime(s.start_time)} – {formatTime(s.end_time)}
                                </div>
                                <div className="text-blue-600">{formatHours(calcHours(s.start_time, s.end_time))}</div>
                              </div>
                            ))
                          )}
                        </td>
                      )
                    })}
                    <td className="p-3 text-center">
                      <span className={`font-semibold text-sm ${weekHrs > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                        {weekHrs > 0 ? formatHours(weekHrs) : '—'}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {employees.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-muted-foreground">
                    No employees found. Add staff in the Staffing tab.
                  </td>
                </tr>
              )}
            </tbody>
            {employees.length > 0 && (
              <tfoot className="bg-amber-50/60">
                <tr>
                  <td className="p-4 text-base font-semibold border-t">Daily Total Hours</td>
                  {days.map(d => (
                    <td key={`total-${d.toISOString()}`} className="border-t p-4 text-center">
                      <div className="text-lg font-semibold text-slate-900">{formatHours(getDayTotal(formatDate(d)))}</div>
                      <div className="text-xs text-muted-foreground mt-1">{formatDisplayDate(d)}</div>
                    </td>
                  ))}
                  <td className="border-t p-4 text-center">
                    <div className="text-lg font-semibold text-slate-900">
                      {formatHours(employees.reduce((sum, employee) => sum + getWeeklyHours(employee.id), 0))}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Week Total</div>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  )
}
