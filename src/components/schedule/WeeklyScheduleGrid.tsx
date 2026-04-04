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
        <div className="overflow-x-auto rounded-lg border-2 border-slate-500 bg-white">
          <table className="w-full min-w-[980px] text-[15px]">
            <thead className="bg-slate-200">
              <tr>
                <th className="text-left p-4 font-semibold text-base w-40 border-b-2 border-slate-500">Employee</th>
                {days.map(d => (
                  <th key={d.toISOString()} className="text-center p-4 font-semibold text-base border-b-2 border-l border-slate-400 border-slate-500 min-w-32">
                    <div>{getDayName(d)}</div>
                    <div className="text-sm text-slate-600 font-normal">{formatDisplayDate(d)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => {
                return (
                  <tr key={emp.id} className="border-b border-slate-300 hover:bg-slate-50">
                    <td className="p-4 align-top">
                      <div className="font-semibold text-base">{employeeNamesById.get(emp.id) ?? emp.name}</div>
                      <div className="text-sm text-slate-600 capitalize">{emp.role}{!emp.is_active ? ' • archived' : ''}</div>
                    </td>
                    {days.map(d => {
                      const dateStr = formatDate(d)
                      const shifts = getShifts(emp.id, dateStr)
                      return (
                        <td key={d.toISOString()} className="border-l border-slate-300 p-3 align-top">
                          {shifts.length === 0 ? (
                            <div className="text-center text-slate-300 text-xl">—</div>
                          ) : (
                            shifts.map((s, i) => (
                              <div key={i} className="mb-2 rounded-lg border-2 border-slate-400 bg-slate-100 p-2.5 text-sm">
                                <div className="font-semibold text-slate-900">
                                  {formatTime(s.start_time)} – {formatTime(s.end_time)}
                                </div>
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
              <tfoot className="bg-slate-200">
                <tr>
                  <td className="p-4 text-base font-semibold border-t-2 border-slate-500">Daily Total Hours</td>
                  {days.map(d => (
                    <td key={`total-${d.toISOString()}`} className="border-t-2 border-l border-slate-400 border-slate-500 p-4 text-center">
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
