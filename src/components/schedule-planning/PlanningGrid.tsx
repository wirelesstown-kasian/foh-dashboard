'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Employee, Schedule } from '@/lib/types'
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
import { ChevronLeft, ChevronRight, Plus, Trash2, Send, CloudOff } from 'lucide-react'

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
  for (let minutes = 15 * 60; minutes <= 27 * 60; minutes += 30) {
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

async function saveServerDrafts(weekStart: string, nextDrafts: ShiftDraft[]) {
  const weekUpsert = await supabase
    .from('schedule_draft_weeks')
    .upsert({ week_start: weekStart, updated_at: new Date().toISOString() }, { onConflict: 'week_start' })

  if (weekUpsert.error) throw weekUpsert.error

  const deleteExisting = await supabase
    .from('schedule_drafts')
    .delete()
    .eq('week_start', weekStart)

  if (deleteExisting.error) throw deleteExisting.error

  if (nextDrafts.length === 0) return

  const insertDrafts = await supabase
    .from('schedule_drafts')
    .insert(nextDrafts.map(draft => ({
      week_start: weekStart,
      employee_id: draft.employee_id,
      date: draft.date,
      start_time: draft.start_time,
      end_time: draft.end_time,
      is_off: !!draft.is_off,
      updated_at: new Date().toISOString(),
    })))

  if (insertDrafts.error) throw insertDrafts.error
}

async function clearServerDrafts(weekStart: string) {
  const draftDelete = await supabase
    .from('schedule_drafts')
    .delete()
    .eq('week_start', weekStart)

  if (draftDelete.error) throw draftDelete.error

  const weekDelete = await supabase
    .from('schedule_draft_weeks')
    .delete()
    .eq('week_start', weekStart)

  if (weekDelete.error) throw weekDelete.error
}

export function PlanningGrid() {
  const [weekRef, setWeekRef] = useState(new Date())
  const [days, setDays] = useState<Date[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [drafts, setDrafts] = useState<ShiftDraft[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [addDialog, setAddDialog] = useState<{ date: string; employee_id: string } | null>(null)
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
  const currentDraftKey = draftKey(weekRef)

  const persistDrafts = useCallback((nextDrafts: ShiftDraft[], nextDirty = true) => {
    if (!isEditableWeek) return
    localStorage.setItem(currentDraftKey, JSON.stringify(nextDrafts))
    setDrafts(nextDrafts)
    setIsDirty(nextDirty)
  }, [currentDraftKey, isEditableWeek])

  const loadData = useCallback(async () => {
    if (days.length === 0) return
    setLoading(true)
    const startDate = formatDate(days[0])
    const endDate = formatDate(days[6])
    const key = `schedule_draft_${startDate}`

    const [empRes, schRes, draftWeekRes, draftRes] = await Promise.all([
      supabase.from('employees').select('*').eq('is_active', true).order('name'),
      supabase.from('schedules').select('*, employee:employees(id, name, role, is_active, pin_hash, phone, email, birth_date, created_at)').gte('date', startDate).lte('date', endDate),
      supabase.from('schedule_draft_weeks').select('week_start').eq('week_start', startDate).maybeSingle(),
      supabase.from('schedule_drafts').select('*').eq('week_start', startDate).order('date'),
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

    const saved = localStorage.getItem(key)
    const published = loadedSchedules.map((s: Schedule) => ({
      id: s.id,
      employee_id: s.employee_id,
      date: s.date,
      start_time: s.start_time,
      end_time: s.end_time,
    }))

    const hasServerDraftWeek = !!draftWeekRes.data && !draftWeekRes.error
    const canUseServerDrafts = hasServerDraftWeek && !draftRes.error

    if (draftWeekRes.error || draftRes.error) {
      setServerDraftsReady(false)
    } else {
      setServerDraftsReady(true)
    }

    if (canUseServerDrafts && isEditableWeek) {
      const serverDrafts = ((draftRes.data ?? []) as Array<ShiftDraft & { id?: string }>).map(draft => ({
        id: draft.id,
        employee_id: draft.employee_id,
        date: draft.date,
        start_time: draft.start_time,
        end_time: draft.end_time,
        is_off: draft.is_off ?? false,
      }))
      setDrafts(serverDrafts)
      setIsDirty(true)
      localStorage.setItem(key, JSON.stringify(serverDrafts))
    } else if (saved && isEditableWeek && published.length === 0) {
      setDrafts(JSON.parse(saved))
      setIsDirty(true)
    } else {
      setDrafts(published)
      setIsDirty(false)
      localStorage.removeItem(key)
    }
    setLoading(false)
  }, [days, isEditableWeek])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (loading || days.length === 0 || !isEditableWeek) return
    const key = draftKey(weekRef)
    localStorage.setItem(key, JSON.stringify(drafts))
  }, [drafts, loading, days, weekRef, isEditableWeek])

  useEffect(() => {
    if (loading || !isEditableWeek || days.length === 0 || !isDirty || !serverDraftsReady) return

    const weekStart = formatDate(days[0])
    const timeoutId = window.setTimeout(() => {
      void saveServerDrafts(weekStart, drafts).catch(error => {
        console.error('Failed to save schedule drafts to server', error)
      })
    }, 300)

    return () => window.clearTimeout(timeoutId)
  }, [days, drafts, isDirty, isEditableWeek, loading, serverDraftsReady])

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

  const handlePublish = async () => {
    if (days.length === 0 || !isEditableWeek) return
    setSaving(true)
    const startDate = formatDate(days[0])
    const endDate = formatDate(days[6])
    const key = `schedule_draft_${startDate}`

    await supabase.from('schedules').delete().gte('date', startDate).lte('date', endDate)

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

    // Send schedule emails to working employees
    fetch('/api/send-schedule-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week_start: startDate, week_end: endDate }),
    }).catch(() => {/* fire and forget */})

    await clearServerDrafts(startDate).catch(error => {
      console.error('Failed to clear schedule drafts after publish', error)
    })
    localStorage.removeItem(key)
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
            {saving ? 'Publishing…' : 'Publish Schedule'}
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
                    <div className="text-xs text-muted-foreground font-normal mt-0.5">
                      {formatHours(getDayTotal(formatDate(d)))} total
                    </div>
                  </th>
                ))}
                <th className="text-center p-3 font-semibold border-b w-24">Total</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
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
              {employees.length === 0 && (
                <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">No employees. Add staff in the Staffing tab first.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

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
                          {option}
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
                          {option}
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
