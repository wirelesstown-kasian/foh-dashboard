'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Employee, Schedule } from '@/lib/types'
import {
  getWeekDays, getPrevWeek, getNextWeek, formatDate,
  formatDisplayDate, formatWeekRange, getDayName, calcHours, formatHours, formatTime
} from '@/lib/dateUtils'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export function WeeklyScheduleGrid() {
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

    const activeEmployees = empRes.data ?? []
    const loadedSchedules = (schRes.data ?? []) as Array<Schedule & { employee?: Employee | null }>
    const namesById = new Map<string, string>()

    for (const employee of activeEmployees) {
      namesById.set(employee.id, employee.name)
    }
    for (const schedule of loadedSchedules) {
      if (schedule.employee?.name) {
        namesById.set(schedule.employee_id, schedule.employee.name)
      }
    }

    const scheduledOnlyEmployees = Array.from(
      new Map(
        loadedSchedules
          .filter(schedule => !activeEmployees.some(employee => employee.id === schedule.employee_id))
          .map(schedule => [
            schedule.employee_id,
            schedule.employee ?? {
              id: schedule.employee_id,
              name: namesById.get(schedule.employee_id) ?? `Staff ${schedule.employee_id.slice(0, 6)}`,
              role: 'server',
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
    setSchedules(loadedSchedules)
    setLoading(false)
  }, [days])

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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Schedule</h1>
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
                    <div className="text-xs font-medium text-amber-700 mt-0.5">
                      {formatHours(getDayTotal(formatDate(d)))} total
                    </div>
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
          </table>
        </div>
      )}
    </div>
  )
}
