'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Employee, Schedule, ScheduleDepartment } from '@/lib/types'
import {
  getWeekDays, getPrevWeek, getNextWeek, formatDate,
  formatDisplayDate, formatWeekRange, getDayName, calcHours, formatHours, formatTime
} from '@/lib/dateUtils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ChevronLeft, ChevronRight, Plus, Trash2, Send, CloudOff, Copy } from 'lucide-react'

type ShiftDraft = {
  id?: string
  employee_id: string
  date: string
  start_time: string
  end_time: string
  is_off?: boolean
}

function snapTimeToHalfHour(value: string) {
  const [hourText = '0', minuteText = '0'] = value.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const totalMinutes = hour * 60 + minute
  const snappedMinutes = Math.round(totalMinutes / 30) * 30
  const normalizedMinutes = ((snappedMinutes % (24 * 60)) + (24 * 60)) % (24 * 60)
  const nextHour = Math.floor(normalizedMinutes / 60)
  const nextMinute = normalizedMinutes % 60
  return `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`
}

function getAllowedTimeOptions() {
  const options: string[] = []
  for (let minutes = 12 * 60; minutes <= 27 * 60; minutes += 30) {
    const normalized = minutes % (24 * 60)
    const hour = Math.floor(normalized / 60)
    const minute = normalized % 60
    options.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
  }
  return options
}

function getDefaultTimes(dateStr: string): { start: string; end: string } {
  const day = new Date(dateStr + 'T12:00:00').getDay() // 0=Sun,1=Mon,...,6=Sat
  if (day === 5 || day === 6) return { start: '15:30', end: '02:00' }  // Fri-Sat
  if (day === 0) return { start: '15:30', end: '00:00' }               // Sun
  return { start: '15:30', end: '01:00' }                               // Mon-Thu
}

function draftKey(weekRef: Date) {
  const days = getWeekDays(weekRef)
  return `schedule_draft_${formatDate(days[0])}`
}

async function saveServerDrafts(weekStart: string, department: ScheduleDepartment, nextDrafts: ShiftDraft[]) {
  const weekUpsert = await supabase
    .from('schedule_draft_weeks')
    .upsert({ week_start: weekStart, updated_at: new Date().toISOString() }, { onConflict: 'week_start' })

  if (weekUpsert.error) throw weekUpsert.error

  const deleteExisting = await supabase
    .from('schedule_drafts')
    .delete()
    .eq('week_start', weekStart)
    .eq('department', department)

  if (deleteExisting.error) throw deleteExisting.error

  if (nextDrafts.length === 0) return

  const insertDrafts = await supabase
    .from('schedule_drafts')
    .insert(nextDrafts.map(draft => ({
      week_start: weekStart,
      department,
      employee_id: draft.employee_id,
      date: draft.date,
      start_time: draft.start_time,
      end_time: draft.end_time,
      is_off: !!draft.is_off,
      updated_at: new Date().toISOString(),
    })))

  if (insertDrafts.error) throw insertDrafts.error
}

async function clearServerDrafts(weekStart: string, department: ScheduleDepartment) {
  const draftDelete = await supabase
    .from('schedule_drafts')
    .delete()
    .eq('week_start', weekStart)
    .eq('department', department)

  if (draftDelete.error) throw draftDelete.error

  const remainingDrafts = await supabase
    .from('schedule_drafts')
    .select('id', { count: 'exact', head: true })
    .eq('week_start', weekStart)

  if (remainingDrafts.error) throw remainingDrafts.error

  if ((remainingDrafts.count ?? 0) > 0) return

  const weekDelete = await supabase
    .from('schedule_draft_weeks')
    .delete()
    .eq('week_start', weekStart)

  if (weekDelete.error) throw weekDelete.error
}

function isEmployeeInDepartment(employee: Employee, department: ScheduleDepartment) {
  return department === 'boh'
    ? employee.role === 'kitchen_staff' || employee.role === 'manager'
    : employee.role !== 'kitchen_staff'
}

interface PlanningGridProps {
  department: ScheduleDepartment
}

export function PlanningGrid({ department }: PlanningGridProps) {
  const [weekRef, setWeekRef] = useState(new Date())
  const [days, setDays] = useState<Date[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [displayedEmployeeIds, setDisplayedEmployeeIds] = useState<string[]>([])
  const [drafts, setDrafts] = useState<ShiftDraft[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [addDialog, setAddDialog] = useState<{ date: string; employee_id: string } | null>(null)
  const [addStaffDialogOpen, setAddStaffDialogOpen] = useState(false)
  const [staffToAdd, setStaffToAdd] = useState<string>('')
  const [addForm, setAddForm] = useState({ start_time: '15:30', end_time: '01:00', is_off: false })
  const [employeeNamesById, setEmployeeNamesById] = useState<Map<string, string>>(new Map())
  const [serverDraftsReady, setServerDraftsReady] = useState(true)
  const allowedTimeOptions = getAllowedTimeOptions()

  useEffect(() => {
    setDays(getWeekDays(weekRef))
  }, [weekRef])

  const currentWeekStart = formatDate(getWeekDays(new Date())[0])
  const previousWeekStart = formatDate(getWeekDays(getPrevWeek(new Date()))[0])
  const viewedWeekStart = days.length > 0 ? formatDate(days[0]) : currentWeekStart
  const isEditableWeek = viewedWeekStart >= previousWeekStart
  const currentDraftKey = `${draftKey(weekRef)}_${department}`
  const currentRowsKey = `${currentDraftKey}_rows`

  const persistDrafts = useCallback((nextDrafts: ShiftDraft[], nextDirty = true) => {
    if (!isEditableWeek) return
    localStorage.setItem(currentDraftKey, JSON.stringify(nextDrafts))
    setDrafts(nextDrafts)
    setIsDirty(nextDirty)
  }, [currentDraftKey, isEditableWeek])

  const persistDisplayedEmployeeIds = useCallback((nextIds: string[]) => {
    const uniqueIds = Array.from(new Set(nextIds))
    localStorage.setItem(currentRowsKey, JSON.stringify(uniqueIds))
    setDisplayedEmployeeIds(uniqueIds)
  }, [currentRowsKey])

  const loadData = useCallback(async () => {
    if (days.length === 0) return
    setLoading(true)
    const startDate = formatDate(days[0])
    const endDate = formatDate(days[6])
    const key = `${draftKey(days[0])}_${department}`

    const [empRes, schRes, draftWeekRes, draftRes] = await Promise.all([
      supabase.from('employees').select('*').eq('is_active', true).order('name'),
      supabase.from('schedules').select('*, employee:employees(id, name, role, is_active, pin_hash, phone, email, birth_date, created_at)').gte('date', startDate).lte('date', endDate),
      supabase.from('schedule_draft_weeks').select('week_start').eq('week_start', startDate).maybeSingle(),
      supabase.from('schedule_drafts').select('*').eq('week_start', startDate).eq('department', department).order('date'),
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
        loadedSchedules
          .filter(schedule => {
            const role = schedule.employee?.role ?? 'server'
            return department === 'boh' ? role === 'kitchen_staff' || role === 'manager' : role !== 'kitchen_staff'
          })
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

    const saved = localStorage.getItem(key)
    const savedRows = localStorage.getItem(`${key}_rows`)
    const published = departmentSchedules.map((s: Schedule) => ({
      id: s.id,
      employee_id: s.employee_id,
      date: s.date,
      start_time: s.start_time,
      end_time: s.end_time,
    }))

    const hasServerDraftWeek = !!draftWeekRes.data && !draftWeekRes.error
    const hasServerDrafts = (draftRes.data?.length ?? 0) > 0
    const canUseServerDrafts = (hasServerDraftWeek || hasServerDrafts) && !draftRes.error

    if (draftWeekRes.error || draftRes.error) {
      setServerDraftsReady(false)
    } else {
      setServerDraftsReady(true)
    }

    let nextDrafts: ShiftDraft[] = published
    if (canUseServerDrafts && isEditableWeek) {
      const serverDrafts = ((draftRes.data ?? []) as Array<ShiftDraft & { id?: string }>).map(draft => ({
        id: draft.id,
        employee_id: draft.employee_id,
        date: draft.date,
        start_time: draft.start_time,
        end_time: draft.end_time,
        is_off: draft.is_off ?? false,
      }))
      nextDrafts = serverDrafts
      setDrafts(serverDrafts)
      setIsDirty(true)
      localStorage.setItem(key, JSON.stringify(serverDrafts))
    } else if (saved && isEditableWeek && published.length === 0) {
      nextDrafts = JSON.parse(saved) as ShiftDraft[]
      setDrafts(nextDrafts)
      setIsDirty(true)
    } else {
      nextDrafts = published
      setDrafts(published)
      setIsDirty(false)
      localStorage.removeItem(key)
    }

    const autoShownIds = nextDrafts.map(draft => draft.employee_id)
    const restoredRowIds = savedRows ? (JSON.parse(savedRows) as string[]) : []
    const validRowIds = [...restoredRowIds, ...autoShownIds].filter(employeeId =>
      [...activeEmployees, ...scheduledOnlyEmployees].some(employee => employee.id === employeeId)
    )
    setDisplayedEmployeeIds(Array.from(new Set(validRowIds)))
    setLoading(false)
  }, [days, department, isEditableWeek])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (loading || days.length === 0 || !isEditableWeek) return
    localStorage.setItem(currentDraftKey, JSON.stringify(drafts))
  }, [currentDraftKey, drafts, loading, days, isEditableWeek])

  useEffect(() => {
    if (loading || !isEditableWeek) return
    localStorage.setItem(currentRowsKey, JSON.stringify(displayedEmployeeIds))
  }, [currentRowsKey, displayedEmployeeIds, isEditableWeek, loading])

  useEffect(() => {
    if (loading || !isEditableWeek || days.length === 0 || !isDirty || !serverDraftsReady) return

    const weekStart = formatDate(days[0])
    const timeoutId = window.setTimeout(() => {
      void saveServerDrafts(weekStart, department, drafts).catch(error => {
        console.error('Failed to save schedule drafts to server', error)
      })
    }, 300)

    return () => window.clearTimeout(timeoutId)
  }, [days, department, drafts, isDirty, isEditableWeek, loading, serverDraftsReady])

  useEffect(() => {
    if (!isEditableWeek) return

    const persistCurrentDrafts = () => {
      localStorage.setItem(currentDraftKey, JSON.stringify(drafts))
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistCurrentDrafts()
      }
    }

    window.addEventListener('pagehide', persistCurrentDrafts)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      persistCurrentDrafts()
      window.removeEventListener('pagehide', persistCurrentDrafts)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [currentDraftKey, drafts, isEditableWeek])

  const openAddDialog = (date: string, employee_id: string) => {
    if (!isEditableWeek) return
    const defaults = getDefaultTimes(date)
    setAddForm({ start_time: defaults.start, end_time: defaults.end, is_off: false })
    setAddDialog({ date, employee_id })
  }

  const getShifts = (employeeId: string, date: string) =>
    drafts.filter(d => d.employee_id === employeeId && d.date === date)

  const displayedEmployees = displayedEmployeeIds
    .map(employeeId => employees.find(employee => employee.id === employeeId))
    .filter((employee): employee is Employee => !!employee)

  const availableEmployeesToAdd = employees.filter(employee => !displayedEmployeeIds.includes(employee.id))

  const addShift = () => {
    if (!addDialog || !isEditableWeek) return
    const nextDrafts = [
      ...drafts,
      {
        employee_id: addDialog.employee_id,
        date: addDialog.date,
        start_time: addForm.is_off ? '00:00:00' : addForm.start_time + ':00',
        end_time: addForm.is_off ? '00:00:00' : addForm.end_time + ':00',
        is_off: addForm.is_off,
      }
    ]
    persistDrafts(nextDrafts)
    setAddDialog(null)
  }

  const removeShift = (idx: number) => {
    if (!isEditableWeek) return
    const nextDrafts = drafts.filter((_, i) => i !== idx)
    persistDrafts(nextDrafts)
  }

  const getWeeklyHours = (employeeId: string) =>
    drafts
      .filter(d => d.employee_id === employeeId && !d.is_off)
      .reduce((sum, d) => sum + calcHours(d.start_time, d.end_time), 0)

  const getDayTotal = (date: string) =>
    drafts
      .filter(d => d.date === date && !d.is_off)
      .reduce((sum, d) => sum + calcHours(d.start_time, d.end_time), 0)

  const addStaffRow = () => {
    if (!staffToAdd) return
    persistDisplayedEmployeeIds([...displayedEmployeeIds, staffToAdd])
    setStaffToAdd('')
    setAddStaffDialogOpen(false)
  }

  const removeStaffRow = (employeeId: string) => {
    if (!isEditableWeek) return
    const nextDisplayedIds = displayedEmployeeIds.filter(id => id !== employeeId)
    const nextDrafts = drafts.filter(draft => draft.employee_id !== employeeId)
    persistDisplayedEmployeeIds(nextDisplayedIds)
    persistDrafts(nextDrafts)
  }

  const copyPreviousWeekForEmployee = async (employeeId: string) => {
    if (days.length === 0 || !isEditableWeek) return

    const currentWeekStartDate = days[0]
    const previousWeekDays = getWeekDays(getPrevWeek(currentWeekStartDate))
    const previousWeekStart = formatDate(previousWeekDays[0])
    const previousWeekEnd = formatDate(previousWeekDays[6])

    const { data: previousSchedules, error } = await supabase
      .from('schedules')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('date', previousWeekStart)
      .lte('date', previousWeekEnd)
      .order('date')

    if (error || !previousSchedules) {
      console.error('Failed to load previous week schedules', error)
      return
    }

    const shiftedDrafts = previousSchedules.map(schedule => {
      const previousDate = new Date(schedule.date + 'T12:00:00')
      const nextDate = new Date(previousDate)
      nextDate.setDate(nextDate.getDate() + 7)

      return {
        employee_id: employeeId,
        date: formatDate(nextDate),
        start_time: schedule.start_time,
        end_time: schedule.end_time,
        is_off: false,
      } satisfies ShiftDraft
    })

    const employeeDraftsRemoved = drafts.filter(draft => draft.employee_id !== employeeId)
    if (!displayedEmployeeIds.includes(employeeId)) {
      persistDisplayedEmployeeIds([...displayedEmployeeIds, employeeId])
    }
    persistDrafts([...employeeDraftsRemoved, ...shiftedDrafts].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      return a.start_time.localeCompare(b.start_time)
    }))
  }

  const handlePublish = async () => {
    if (days.length === 0 || !isEditableWeek) return
    setSaving(true)
    const startDate = formatDate(days[0])
    const endDate = formatDate(days[6])
    const key = `${draftKey(days[0])}_${department}`
    const departmentEmployeeIds = employees.map(employee => employee.id)

    if (departmentEmployeeIds.length > 0) {
      await supabase
        .from('schedules')
        .delete()
        .gte('date', startDate)
        .lte('date', endDate)
        .in('employee_id', departmentEmployeeIds)
    }

    const shiftsToPublish = drafts.filter(d => !d.is_off)
    if (shiftsToPublish.length > 0) {
      await supabase.from('schedules').insert(
        shiftsToPublish.map(d => ({
          employee_id: d.employee_id,
          date: d.date,
          start_time: d.start_time,
          end_time: d.end_time,
        }))
      )
    }

    const scheduledSendDate = new Date(days[0])
    scheduledSendDate.setDate(scheduledSendDate.getDate() - 1)
    const scheduledSendDateStr = formatDate(scheduledSendDate)
    const todayStr = formatDate(new Date())

    await supabase
      .from('schedule_publications')
      .upsert({
        week_start: startDate,
        week_end: endDate,
        scheduled_send_date: scheduledSendDateStr,
        published_at: new Date().toISOString(),
        email_sent_at: null,
      }, { onConflict: 'week_start' })

    if (scheduledSendDateStr <= todayStr) {
      fetch('/api/send-schedule-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week_start: startDate, week_end: endDate }),
      })
        .then(async response => {
          if (!response.ok) return
          await supabase
            .from('schedule_publications')
            .update({ email_sent_at: new Date().toISOString() })
            .eq('week_start', startDate)
        })
        .catch(() => { /* fire and forget */ })
    }

    await clearServerDrafts(startDate, department).catch(error => {
      console.error('Failed to clear schedule drafts after publish', error)
    })
    localStorage.removeItem(`${key}_${department}`)
    await loadData()
    setIsDirty(false)
    setSaving(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {isDirty && (
            <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
              <CloudOff className="w-3 h-3" /> Unpublished Draft
            </span>
          )}
          {!isEditableWeek && (
            <span className="text-xs text-gray-600 bg-gray-100 border border-gray-300 rounded-full px-2 py-0.5">
              Archived Week · Only current week and last week can be edited
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setWeekRef(getPrevWeek(weekRef))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="font-medium text-sm min-w-48 text-center">{formatWeekRange(weekRef)}</span>
          <Button variant="outline" size="sm" onClick={() => setWeekRef(getNextWeek(weekRef))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button onClick={handlePublish} disabled={saving || !isDirty || !isEditableWeek}>
            <Send className="w-4 h-4 mr-2" />
            {saving ? 'Publishing…' : `Publish ${department.toUpperCase()} Schedule`}
          </Button>
        </div>
      </div>

      <div className="mb-5 rounded-2xl border bg-slate-50/80 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{department === 'boh' ? 'BOH Staff Lines' : 'FOH Staff Lines'}</h2>
            <p className="text-sm text-muted-foreground">
              Add only the staff you want to schedule for this week, then build shifts row by row.
            </p>
          </div>
          <Button variant="outline" onClick={() => setAddStaffDialogOpen(true)} disabled={!isEditableWeek}>
            <Plus className="w-4 h-4 mr-2" />
            Add Staff
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
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
                <th className="text-center p-3 font-semibold border-b w-24">Total</th>
              </tr>
            </thead>
            <tbody>
              {displayedEmployees.map(emp => (
                <tr key={emp.id} className="border-b hover:bg-gray-50">
                  <td className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{employeeNamesById.get(emp.id) ?? emp.name}</div>
                        <div className="text-xs text-muted-foreground capitalize">{emp.role}{!emp.is_active ? ' • archived' : ''}</div>
                        <button
                          className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 disabled:text-gray-400"
                          disabled={!isEditableWeek}
                          onClick={() => void copyPreviousWeekForEmployee(emp.id)}
                        >
                          <Copy className="w-3 h-3" />
                          Copy Previous Week
                        </button>
                      </div>
                      <button
                        className="text-red-400 hover:text-red-600 disabled:text-gray-300"
                        disabled={!isEditableWeek}
                        onClick={() => removeStaffRow(emp.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                  {days.map(d => {
                    const dateStr = formatDate(d)
                    const shifts = getShifts(emp.id, dateStr)
                    return (
                      <td key={d.toISOString()} className="p-2 align-top">
                        {shifts.map((sh, idx) => {
                          const globalIdx = drafts.indexOf(sh)
                          return sh.is_off ? (
                            <div key={idx} className="bg-gray-100 border border-gray-300 rounded p-1.5 mb-1 text-xs group relative text-center text-gray-500 font-medium">
                              Off
                              <button
                                className="absolute top-1 right-1 hidden group-hover:block text-red-400 hover:text-red-600"
                                disabled={!isEditableWeek}
                                onClick={() => removeShift(globalIdx)}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <div key={idx} className="bg-blue-50 border border-blue-200 rounded p-1.5 mb-1 text-xs group relative">
                              <div className="font-medium text-blue-800">
                                {formatTime(sh.start_time)} – {formatTime(sh.end_time)}
                              </div>
                              <div className="text-blue-600">{formatHours(calcHours(sh.start_time, sh.end_time))}</div>
                              <button
                                className="absolute top-1 right-1 hidden group-hover:block text-red-400 hover:text-red-600"
                                disabled={!isEditableWeek}
                                onClick={() => removeShift(globalIdx)}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          )
                        })}
                        <button
                          className="w-full border border-dashed border-gray-300 rounded p-1 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors text-xs flex items-center justify-center gap-1 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300 disabled:hover:border-gray-200 disabled:hover:text-gray-300"
                          disabled={!isEditableWeek}
                          onClick={() => openAddDialog(dateStr, emp.id)}
                        >
                          <Plus className="w-3 h-3" /> Add
                        </button>
                      </td>
                    )
                  })}
                  <td className="p-3 text-center font-semibold text-sm">
                    {formatHours(getWeeklyHours(emp.id))}
                  </td>
                </tr>
              ))}
              {displayedEmployees.length === 0 && (
                <tr><td colSpan={9} className="text-center py-12 text-muted-foreground">No staff lines yet. Use Add Staff to start building this week&apos;s schedule.</td></tr>
              )}
            </tbody>
            {displayedEmployees.length > 0 && (
              <tfoot className="bg-slate-50">
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
                      {formatHours(displayedEmployees.reduce((sum, employee) => sum + getWeeklyHours(employee.id), 0))}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Week Total</div>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <Dialog open={addStaffDialogOpen} onOpenChange={setAddStaffDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Staff Line</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Choose which {department === 'boh' ? 'kitchen staff' : 'FOH staff'} member to add to this weekly planner.
            </p>
            <Select value={staffToAdd} onValueChange={(value: string | null) => value && setStaffToAdd(value)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select staff member" />
              </SelectTrigger>
              <SelectContent>
                {availableEmployeesToAdd.map(employee => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {employee.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setAddStaffDialogOpen(false)}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={addStaffRow} disabled={!staffToAdd}>
                Add Staff
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!addDialog} onOpenChange={v => !v && setAddDialog(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Add Shift</DialogTitle>
          </DialogHeader>
          {addDialog && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {employeeNamesById.get(addDialog.employee_id) ?? employees.find(e => e.id === addDialog.employee_id)?.name} — {addDialog.date}
              </p>

              {/* Off toggle */}
              <div className="flex gap-2">
                <button
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    !addForm.is_off
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                  onClick={() => setAddForm(f => ({ ...f, is_off: false }))}
                >
                  Working
                </button>
                <button
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    addForm.is_off
                      ? 'bg-gray-500 text-white border-gray-500'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                  onClick={() => setAddForm(f => ({ ...f, is_off: true }))}
                >
                  Off
                </button>
              </div>

              {!addForm.is_off && (
                <>
                  <div>
                    <label className="text-sm font-medium">Start Time</label>
                    <select
                      className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={addForm.start_time}
                      onChange={e => setAddForm(f => ({ ...f, start_time: snapTimeToHalfHour(e.target.value) }))}
                    >
                      {allowedTimeOptions.map(option => (
                        <option key={option} value={option}>
                          {formatTime(`${option}:00`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">End Time</label>
                    <select
                      className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={addForm.end_time}
                      onChange={e => setAddForm(f => ({ ...f, end_time: snapTimeToHalfHour(e.target.value) }))}
                    >
                      {allowedTimeOptions.map(option => (
                        <option key={option} value={option}>
                          {formatTime(`${option}:00`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Hours: {formatHours(calcHours(addForm.start_time + ':00', addForm.end_time + ':00'))}
                  </div>
                </>
              )}

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setAddDialog(null)}>Cancel</Button>
                <Button className="flex-1" onClick={addShift}>
                  {addForm.is_off ? 'Mark Off' : 'Add Shift'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
