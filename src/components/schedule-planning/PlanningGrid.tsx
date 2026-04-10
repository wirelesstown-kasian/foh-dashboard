'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Employee, Schedule, ScheduleDepartment } from '@/lib/types'
import { employeeMatchesScheduleDepartment } from '@/lib/organization'
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
import { ChevronLeft, ChevronRight, Plus, Trash2, Send, CloudOff, Copy, ChevronUp, ChevronDown, Download } from 'lucide-react'
import { useAppSettings } from '@/components/useAppSettings'
import { getRoleColorTheme, getRoleLabel } from '@/lib/organization'

type ShiftDraft = {
  id?: string
  employee_id: string
  date: string
  start_time: string
  end_time: string
  is_off?: boolean
  display_order?: number
}

type PublishMode = 'immediate' | 'queued'

const QUEUED_SEND_HOUR = 9
const QUEUED_SEND_MINUTE = 0

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

function getDefaultTimes(dateStr: string): { start: string; end: string; isOff: boolean } {
  const day = new Date(dateStr + 'T12:00:00').getDay() // 0=Sun,1=Mon,...,6=Sat
  if (day === 1) return { start: '15:30', end: '01:00', isOff: true }   // Mon
  if (day === 5 || day === 6) return { start: '15:30', end: '02:00', isOff: false }  // Fri-Sat
  if (day === 0) return { start: '15:30', end: '00:00', isOff: false }               // Sun
  return { start: '15:30', end: '01:00', isOff: false }                               // Tue-Thu
}

function isMondayDate(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').getDay() === 1
}

function normalizePublishedShifts(drafts: ShiftDraft[]) {
  return drafts
    .filter(draft => !draft.is_off)
    .map(draft => `${draft.employee_id}|${draft.date}|${draft.start_time}|${draft.end_time}`)
    .sort()
}

function matchesPublishedSchedule(drafts: ShiftDraft[], published: ShiftDraft[]) {
  const left = normalizePublishedShifts(drafts)
  const right = normalizePublishedShifts(published)
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function draftKey(weekRef: Date) {
  const days = getWeekDays(weekRef)
  return `schedule_draft_${formatDate(days[0])}`
}

async function saveServerDrafts(
  weekStart: string,
  department: ScheduleDepartment,
  nextDrafts: ShiftDraft[],
  displayedEmployeeIds: string[]
) {
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

  const displayOrderByEmployeeId = new Map(displayedEmployeeIds.map((employeeId, index) => [employeeId, index]))

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
      display_order: displayOrderByEmployeeId.get(draft.employee_id) ?? 0,
      updated_at: new Date().toISOString(),
    })))

  if (insertDrafts.error) throw insertDrafts.error
}

interface PlanningGridProps {
  department: ScheduleDepartment
  rightSlot?: React.ReactNode
}

export function PlanningGrid({ department, rightSlot }: PlanningGridProps) {
  const { roleDefinitions } = useAppSettings()
  const [weekRef, setWeekRef] = useState(new Date())
  const [days, setDays] = useState<Date[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [displayedEmployeeIds, setDisplayedEmployeeIds] = useState<string[]>([])
  const [drafts, setDrafts] = useState<ShiftDraft[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [addDialog, setAddDialog] = useState<{ date: string; employee_id: string; draftIndex?: number } | null>(null)
  const [addStaffInlineOpen, setAddStaffInlineOpen] = useState(false)
  const [publishDialogOpen, setPublishDialogOpen] = useState(false)
  const [publishMode, setPublishMode] = useState<PublishMode>('immediate')
  const [staffToAdd, setStaffToAdd] = useState<string[]>([])
  const [addForm, setAddForm] = useState({ start_time: '15:30', end_time: '01:00', is_off: false })
  const [employeeNamesById, setEmployeeNamesById] = useState<Map<string, string>>(new Map())
  const [serverDraftsReady, setServerDraftsReady] = useState(true)
  const [shiftActionTarget, setShiftActionTarget] = useState<{ draftIndex: number; employeeId: string; date: string } | null>(null)
  const [staffRemovalTarget, setStaffRemovalTarget] = useState<Employee | null>(null)
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [publishFeedback, setPublishFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
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
  const mondayDate = days[0] ? formatDate(days[0]) : null

  const getQueuedSendAt = useCallback((weekStartDate: Date) => {
    const queued = new Date(weekStartDate)
    queued.setDate(queued.getDate() - 1)
    queued.setHours(QUEUED_SEND_HOUR, QUEUED_SEND_MINUTE, 0, 0)
    return queued
  }, [])

  const ensureMondayOffDrafts = useCallback((baseDrafts: ShiftDraft[], employeeIds: string[]) => {
    if (!mondayDate) return baseDrafts

    const nextDrafts = [...baseDrafts]
    for (const employeeId of employeeIds) {
      const hasMondayEntry = nextDrafts.some(draft => draft.employee_id === employeeId && draft.date === mondayDate)
      if (hasMondayEntry) continue
      nextDrafts.push({
        employee_id: employeeId,
        date: mondayDate,
        start_time: '00:00:00',
        end_time: '00:00:00',
        is_off: true,
      })
    }

    return nextDrafts.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      if (a.employee_id !== b.employee_id) return a.employee_id.localeCompare(b.employee_id)
      return a.start_time.localeCompare(b.start_time)
    })
  }, [mondayDate])

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
    setIsDirty(true)
  }, [currentRowsKey])

  const loadData = useCallback(async () => {
    if (days.length === 0) return
    setLoading(true)
    const startDate = formatDate(days[0])
    const endDate = formatDate(days[6])
    const key = `${draftKey(days[0])}_${department}`

    const [empRes, schRes, draftWeekRes, draftRes] = await Promise.all([
      supabase.from('employees').select('id, name, phone, email, role, primary_department, hourly_wage, guaranteed_hourly, birth_date, login_enabled, is_active, created_at').eq('is_active', true).order('name'),
      supabase.from('schedules').select('*, employee:employees(id, name, role, primary_department, is_active, pin_hash, phone, email, birth_date, created_at)').gte('date', startDate).lte('date', endDate).eq('department', department),
      supabase.from('schedule_draft_weeks').select('week_start').eq('week_start', startDate).maybeSingle(),
      supabase.from('schedule_drafts').select('*').eq('week_start', startDate).eq('department', department).order('display_order').order('date'),
    ])
    const activeEmployees = (empRes.data ?? []).filter(employee => employeeMatchesScheduleDepartment(employee, department))
    // schedules query is already filtered by department — no role-based filtering needed
    const departmentSchedules = (schRes.data ?? []) as Array<Schedule & { employee?: Employee | null }>
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
              role: 'server',
              primary_department: department,
              phone: null,
              email: null,
              hourly_wage: null,
              guaranteed_hourly: null,
              pin_hash: '',
              birth_date: null,
              login_enabled: false,
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
    if (published.length > 0) {
      nextDrafts = published
      setDrafts(published)
      setIsDirty(false)
      localStorage.setItem(key, JSON.stringify(published))
    } else if (canUseServerDrafts && isEditableWeek) {
      const serverDrafts = ((draftRes.data ?? []) as Array<ShiftDraft & { id?: string }>).map(draft => ({
        id: draft.id,
        employee_id: draft.employee_id,
        date: draft.date,
        start_time: draft.start_time,
        end_time: draft.end_time,
        is_off: draft.is_off ?? false,
        display_order: draft.display_order ?? 0,
      }))
      nextDrafts = serverDrafts
      setDrafts(serverDrafts)
      setIsDirty(!matchesPublishedSchedule(serverDrafts, published))
      localStorage.setItem(key, JSON.stringify(serverDrafts))
    } else if (saved && isEditableWeek) {
      nextDrafts = JSON.parse(saved) as ShiftDraft[]
      setDrafts(nextDrafts)
      setIsDirty(!matchesPublishedSchedule(nextDrafts, published))
    } else {
      nextDrafts = published
      setDrafts(published)
      setIsDirty(false)
    }

    const autoShownIds = Array.from(new Set(nextDrafts.map(draft => draft.employee_id)))
    const serverOrderedRowIds = Array.from(
      new Set(
        ((draftRes.data ?? []) as Array<ShiftDraft>)
          .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
          .map(draft => draft.employee_id)
      )
    )
    const restoredRowIds = serverOrderedRowIds.length > 0
      ? serverOrderedRowIds
      : savedRows
        ? (JSON.parse(savedRows) as string[])
        : []

    // When published schedules exist, show ONLY published employees to avoid
    // stale draft rows (employees who were drafted but not published) bleeding through.
    // In draft mode, include restored row order so previously added staff stays visible.
    const candidateIds = published.length > 0
      ? autoShownIds
      : Array.from(new Set([...restoredRowIds, ...autoShownIds]))

    // Sort candidates by saved draft order where available
    const draftOrderMap = new Map(serverOrderedRowIds.map((id, i) => [id, i]))
    const validRowIds = candidateIds
      .filter(employeeId =>
        [...activeEmployees, ...scheduledOnlyEmployees].some(employee => employee.id === employeeId)
      )
      .sort((a, b) => (draftOrderMap.get(a) ?? Infinity) - (draftOrderMap.get(b) ?? Infinity))
    const normalizedRowIds = Array.from(new Set(validRowIds))
    const draftsWithMondayDefaults = ensureMondayOffDrafts(nextDrafts, normalizedRowIds)
    setDrafts(draftsWithMondayDefaults)
    setDisplayedEmployeeIds(normalizedRowIds)
    setLoading(false)
  }, [days, department, ensureMondayOffDrafts, isEditableWeek])

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
    setAutoSaveStatus('idle')
    const timeoutId = window.setTimeout(() => {
      setAutoSaveStatus('saving')
      void saveServerDrafts(weekStart, department, drafts, displayedEmployeeIds)
        .then(() => {
          setAutoSaveStatus('saved')
          window.setTimeout(() => setAutoSaveStatus('idle'), 2000)
        })
        .catch(error => {
          console.error('Failed to save schedule drafts to server', error)
          setAutoSaveStatus('idle')
        })
    }, 800)

    return () => window.clearTimeout(timeoutId)
  }, [days, department, displayedEmployeeIds, drafts, isDirty, isEditableWeek, loading, serverDraftsReady])

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

  useEffect(() => {
    if (!addDialog) return
    if (typeof addDialog.draftIndex === 'number') {
      const draft = drafts[addDialog.draftIndex]
      if (draft) {
        setAddForm({
          start_time: draft.start_time.slice(0, 5),
          end_time: draft.end_time.slice(0, 5),
          is_off: !!draft.is_off,
        })
        return
      }
    }

    const defaults = getDefaultTimes(addDialog.date)
    setAddForm({ start_time: defaults.start, end_time: defaults.end, is_off: defaults.isOff })
  }, [addDialog, drafts])

  const openAddDialog = (date: string, employee_id: string, draftIndex?: number) => {
    if (!isEditableWeek) return
    setAddDialog({ date, employee_id, draftIndex })
  }

  const getShifts = (employeeId: string, date: string) =>
    drafts.filter(d => d.employee_id === employeeId && d.date === date)

  const displayedEmployees = displayedEmployeeIds
    .map(employeeId => employees.find(employee => employee.id === employeeId))
    .filter((employee): employee is Employee => !!employee)

  const availableEmployeesToAdd = employees.filter(employee => !displayedEmployeeIds.includes(employee.id))

  const addShift = () => {
    if (!addDialog || !isEditableWeek) return
    const nextEntry = {
      employee_id: addDialog.employee_id,
      date: addDialog.date,
      start_time: addForm.is_off ? '00:00:00' : addForm.start_time + ':00',
      end_time: addForm.is_off ? '00:00:00' : addForm.end_time + ':00',
      is_off: addForm.is_off,
      display_order: displayedEmployeeIds.indexOf(addDialog.employee_id),
    } satisfies ShiftDraft

    const nextDrafts = typeof addDialog.draftIndex === 'number'
      ? drafts.map((draft, index) => index === addDialog.draftIndex ? { ...draft, ...nextEntry } : draft)
      : [...drafts, nextEntry]

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

  const exportPlannerPdf = () => {
    if (days.length === 0) return

    const title = `${department.toUpperCase()} Planner`
    const weekLabel = formatWeekRange(weekRef)
    const tableRows = displayedEmployees.map(employee => {
      const roleTheme = getRoleColorTheme(employee.role, roleDefinitions)
      const dayCells = days.map(day => {
        const shifts = getShifts(employee.id, formatDate(day))
        return `
          <td>
            ${shifts.length === 0 ? '<div class="muted">Off</div>' : shifts.map(shift => `
              <div class="shift" style="background:${roleTheme.pdfShiftBackground};border-color:${roleTheme.pdfShiftBorder};">
                <div class="time">${shift.is_off ? 'Off' : `${formatTime(shift.start_time)} - ${formatTime(shift.end_time)}`}</div>
                ${shift.is_off ? '' : `<div class="muted">${formatHours(calcHours(shift.start_time, shift.end_time))}</div>`}
              </div>
            `).join('')}
          </td>
        `
      }).join('')

      return `
        <tr>
          <td style="border-left: 4px solid ${roleTheme.pdfShiftBorder};">
            <div class="employee-name">${employeeNamesById.get(employee.id) ?? employee.name}</div>
            <div class="role-badge" style="background:${roleTheme.pdfBadgeBackground};color:${roleTheme.pdfBadgeText};">
              ${getRoleLabel(employee.role, roleDefinitions)}
            </div>
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
            body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif; margin: 0; padding: 16px; color: #111827; }
            h1 { margin: 0 0 4px 0; font-size: 24px; }
            .sub { margin-bottom: 10px; color: #475569; font-size: 13px; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            th, td { border: 1.5px solid #475569; vertical-align: top; padding: 8px; font-size: 14px; }
            th { background: #edf1f5; font-weight: 700; }
            .employee-name { font-weight: 800; font-size: 15px; margin-bottom: 2px; }
            .muted { color: #475569; font-size: 12px; }
            .role-badge { display: inline-block; margin-top: 6px; padding: 3px 8px; border-radius: 9999px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
            .shift { background: #f7f7f5; border: 1.5px solid #64748b; border-radius: 8px; padding: 6px; margin-bottom: 5px; }
            .time { font-weight: 700; font-size: 14px; }
            .weekly-total { text-align: center; font-weight: 700; }
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
                <th style="width: 85px;">Total</th>
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
                <td class="weekly-total">
                  ${formatHours(displayedEmployees.reduce((sum, employee) => sum + getWeeklyHours(employee.id), 0))}
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

  const addStaffRow = () => {
    if (staffToAdd.length === 0) return
    const nextDisplayedIds = [...displayedEmployeeIds, ...staffToAdd]
    persistDisplayedEmployeeIds(nextDisplayedIds)
    persistDrafts(ensureMondayOffDrafts(drafts, nextDisplayedIds))
    setStaffToAdd([])
    setAddStaffInlineOpen(false)
  }

  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false)
  const [deleteAllPin, setDeleteAllPin] = useState('')
  const [deleteAllError, setDeleteAllError] = useState<string | null>(null)
  const [deletingAll, setDeletingAll] = useState(false)

  const handleDeleteAll = async () => {
    if (!isEditableWeek || days.length === 0) return
    setDeletingAll(true)
    setDeleteAllError(null)
    try {
      const res = await fetch('/api/manager-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: deleteAllPin }),
      })
      if (!res.ok) {
        setDeleteAllError('Incorrect manager PIN')
        setDeletingAll(false)
        return
      }
    } catch {
      setDeleteAllError('Failed to verify PIN')
      setDeletingAll(false)
      return
    }
    const weekStart = formatDate(days[0])
    localStorage.removeItem(currentDraftKey)
    localStorage.removeItem(currentRowsKey)
    await supabase.from('schedule_drafts').delete().eq('week_start', weekStart).eq('department', department)
    await supabase.from('schedule_draft_weeks').delete().eq('week_start', weekStart)
    setDrafts([])
    setDisplayedEmployeeIds([])
    setIsDirty(false)
    setDeleteAllPin('')
    setDeleteAllDialogOpen(false)
    setDeletingAll(false)
  }

  const removeStaffRow = (employeeId: string) => {
    if (!isEditableWeek) return
    const nextDisplayedIds = displayedEmployeeIds.filter(id => id !== employeeId)
    const nextDrafts = drafts.filter(draft => draft.employee_id !== employeeId)
    persistDisplayedEmployeeIds(nextDisplayedIds)
    persistDrafts(nextDrafts)
  }

  const moveStaffRow = (employeeId: string, direction: 'up' | 'down') => {
    if (!isEditableWeek) return
    const currentIndex = displayedEmployeeIds.indexOf(employeeId)
    if (currentIndex === -1) return
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (targetIndex < 0 || targetIndex >= displayedEmployeeIds.length) return

    const nextDisplayedIds = [...displayedEmployeeIds]
    const [movedId] = nextDisplayedIds.splice(currentIndex, 1)
    nextDisplayedIds.splice(targetIndex, 0, movedId)
    persistDisplayedEmployeeIds(nextDisplayedIds)
  }

  const copyPreviousWeekForAll = async () => {
    if (days.length === 0 || !isEditableWeek) return

    const currentWeekStartDate = days[0]
    const previousWeekDays = getWeekDays(getPrevWeek(currentWeekStartDate))
    const previousWeekStart = formatDate(previousWeekDays[0])
    const previousWeekEnd = formatDate(previousWeekDays[6])

    // Fetch both the previous week's draft order AND published schedules in parallel
    const [prevDraftsRes, prevSchedulesRes] = await Promise.all([
      supabase
        .from('schedule_drafts')
        .select('employee_id, display_order')
        .eq('week_start', previousWeekStart)
        .eq('department', department)
        .order('display_order'),
      supabase
        .from('schedules')
        .select('*')
        .gte('date', previousWeekStart)
        .lte('date', previousWeekEnd)
        .eq('department', department)
        .order('employee_id')
        .order('date'),
    ])

    if (prevSchedulesRes.error) {
      console.error('Failed to load previous week schedules', prevSchedulesRes.error)
      return
    }

    const previousSchedules = prevSchedulesRes.data ?? []
    const previousDraftRows = (prevDraftsRes.data ?? []) as Array<{ employee_id: string; display_order: number | null }>

    // Build ordered employee list from previous week's saved display_order
    const prevDraftOrderedIds = Array.from(
      new Set(
        previousDraftRows
          .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
          .map(d => d.employee_id)
      )
    )

    // Fall back to schedule order for anyone not in drafts
    const prevScheduleEmployeeIds = Array.from(new Set(previousSchedules.map(s => s.employee_id)))

    // Combined ordered list: draft order first, then extras from published schedules
    const allPrevEmployeeIds = Array.from(
      new Set([...prevDraftOrderedIds, ...prevScheduleEmployeeIds])
    ).filter(id => employees.some(emp => emp.id === id)) // must exist in current dept

    if (allPrevEmployeeIds.length === 0 && previousSchedules.length === 0) return

    // Shift previous week's published shifts forward by 7 days
    const shiftedDrafts = previousSchedules
      .filter(s => allPrevEmployeeIds.includes(s.employee_id))
      .map(schedule => {
        const previousDate = new Date(schedule.date + 'T12:00:00')
        const nextDate = new Date(previousDate)
        nextDate.setDate(nextDate.getDate() + 7)
        return {
          employee_id: schedule.employee_id,
          date: formatDate(nextDate),
          start_time: schedule.start_time,
          end_time: schedule.end_time,
          is_off: false,
        } satisfies ShiftDraft
      })

    // New row order: previous week's order first, then any current-week-only employees appended
    const nextDisplayedIds = Array.from(
      new Set([
        ...allPrevEmployeeIds,
        ...displayedEmployeeIds.filter(id => !allPrevEmployeeIds.includes(id)),
      ])
    )

    const replacedIds = new Set(allPrevEmployeeIds)
    const keptDrafts = drafts.filter(draft => !replacedIds.has(draft.employee_id))
    persistDisplayedEmployeeIds(nextDisplayedIds)
    persistDrafts([...keptDrafts, ...shiftedDrafts].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      if (a.employee_id !== b.employee_id) return a.employee_id.localeCompare(b.employee_id)
      return a.start_time.localeCompare(b.start_time)
    }))
  }


  const handlePublish = async () => {
    if (days.length === 0 || !isEditableWeek) return
    setSaving(true)
    setPublishFeedback(null)

    try {
      const startDate = formatDate(days[0])
      const endDate = formatDate(days[6])
      const key = `${draftKey(days[0])}_${department}`

      // Delete by department so FOH and BOH schedules don't interfere with each other.
      // Managers can have independent shifts in each department.
      const deleteResult = await supabase
        .from('schedules')
        .delete()
        .gte('date', startDate)
        .lte('date', endDate)
        .eq('department', department)
      if (deleteResult.error) throw deleteResult.error

      const shiftsToPublish = drafts.filter(d => !d.is_off)
      if (shiftsToPublish.length > 0) {
        const insertResult = await supabase.from('schedules').insert(
          shiftsToPublish.map(d => ({
            employee_id: d.employee_id,
            date: d.date,
            start_time: d.start_time,
            end_time: d.end_time,
            department,
          }))
        )
        if (insertResult.error) throw insertResult.error
      }

      const scheduledSendAt = getQueuedSendAt(days[0])
      const scheduledSendDateStr = formatDate(scheduledSendAt)
      const sendImmediately = publishMode === 'immediate'

      const publicationResult = await supabase
        .from('schedule_publications')
        .upsert({
          week_start: startDate,
          week_end: endDate,
          scheduled_send_date: scheduledSendDateStr,
          scheduled_send_at: scheduledSendAt.toISOString(),
          published_at: new Date().toISOString(),
          email_sent_at: null,
        }, { onConflict: 'week_start' })
      if (publicationResult.error) throw publicationResult.error

      if (sendImmediately) {
        const response = await fetch('/api/send-schedule-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ week_start: startDate, week_end: endDate }),
        })
        const payload = (await response.json().catch(() => ({}))) as { success?: boolean; sent?: number; error?: string; errors?: string[]; message?: string }
        if (!response.ok || payload.success === false) {
          throw new Error(payload.errors?.join(' ') || payload.error || payload.message || 'Failed to send schedule emails')
        }

        const markSentResult = await supabase
          .from('schedule_publications')
          .update({ email_sent_at: new Date().toISOString() })
          .eq('week_start', startDate)
        if (markSentResult.error) throw markSentResult.error

        setPublishFeedback({
          tone: 'success',
          message: `Schedule published and emails sent${typeof payload.sent === 'number' ? ` (${payload.sent} sent)` : ''}.`,
        })
      } else {
        const queuedLabel = scheduledSendAt.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
        setPublishFeedback({
          tone: 'success',
          message: `Schedule published. Email is queued for ${queuedLabel}. Any previous queued send for this week was replaced.`,
        })
      }

      await saveServerDrafts(startDate, department, drafts, displayedEmployeeIds).catch(error => {
        console.error('Failed to persist planner snapshot after publish', error)
      })
      localStorage.setItem(key, JSON.stringify(drafts))
      localStorage.setItem(currentRowsKey, JSON.stringify(displayedEmployeeIds))
      await loadData()
      setIsDirty(false)
      setPublishDialogOpen(false)
      setPublishMode('immediate')
    } catch (error) {
      setPublishFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Failed to publish schedule.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-4 overflow-x-auto rounded-[18px] border border-slate-300 bg-white px-3.5 py-2 shadow-[0_8px_18px_rgba(15,23,42,0.04)]">
        <div className="flex min-w-max items-center gap-3 whitespace-nowrap">
          {/* 1. FOH / BOH */}
          {rightSlot}
          {/* 2. Today's Week */}
          <Button variant="outline" size="sm" className="h-8 rounded-lg px-3" onClick={() => setWeekRef(new Date())}>
            Today&apos;s Week
          </Button>
          {/* 3. Date navigation */}
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-8 w-8 rounded-lg" onClick={() => setWeekRef(getPrevWeek(weekRef))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="min-w-48 text-center text-base font-semibold tracking-tight text-slate-900">
              {formatWeekRange(weekRef)}
            </span>
            <Button variant="outline" size="sm" className="h-8 w-8 rounded-lg" onClick={() => setWeekRef(getNextWeek(weekRef))}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          {/* 4. Status badges */}
          {isDirty && (
            <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
              <CloudOff className="w-3 h-3" /> Unpublished Draft
            </span>
          )}
          {autoSaveStatus === 'saving' && (
            <span className="text-xs text-slate-500">Saving…</span>
          )}
          {autoSaveStatus === 'saved' && (
            <span className="text-xs text-emerald-600">Draft saved</span>
          )}
          {!isEditableWeek && (
            <span className="text-xs text-gray-600 bg-gray-100 border border-gray-300 rounded-full px-2 py-0.5">
              Archived Week
            </span>
          )}
          {/* 5. Action buttons */}
          <Button variant="outline" size="sm" className="h-8 rounded-lg px-3" onClick={() => void copyPreviousWeekForAll()} disabled={!isEditableWeek}>
            <Copy className="w-4 h-4 mr-1.5" />
            Copy Previous Week
          </Button>
          <Button variant="outline" size="sm" className="h-8 rounded-lg px-3" onClick={exportPlannerPdf}>
            <Download className="w-4 h-4 mr-1.5" />
            Export PDF
          </Button>
          <Button size="sm" className="h-8 rounded-lg px-3" onClick={() => setPublishDialogOpen(true)} disabled={saving || !isDirty || !isEditableWeek}>
            <Send className="w-4 h-4 mr-1.5" />
            Publish {department.toUpperCase()}
          </Button>
        </div>
      </div>

      {publishFeedback && (
        <div className={`mb-4 rounded-xl border px-3 py-2 text-sm ${publishFeedback.tone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {publishFeedback.message}
        </div>
      )}

      <div className="mb-5 rounded-2xl border bg-slate-50/80 p-4 md:p-5">
        <h2 className="text-lg font-semibold">{department === 'boh' ? 'BOH Staff Lines' : 'FOH Staff Lines'}</h2>
        <p className="text-sm text-muted-foreground">
          Add only the staff you want to schedule for this week, then build shifts row by row.
        </p>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-300 bg-white shadow-sm">
          <table className="min-w-[1020px] w-full text-[16px]">
            <thead className="bg-slate-100">
              <tr>
                <th className="text-left p-3.5 font-semibold w-44 border-b border-slate-300">Employee</th>
                {days.map(d => (
                  <th key={d.toISOString()} className="text-center p-3.5 font-semibold border-b border-slate-300 min-w-32">
                    <div>{getDayName(d)}</div>
                    <div className="text-[12px] text-muted-foreground font-normal">{formatDisplayDate(d)}</div>
                  </th>
                ))}
                <th className="text-center p-3.5 font-semibold border-b border-slate-300 w-24">Total</th>
              </tr>
            </thead>
            <tbody>
              {displayedEmployees.map((emp, rowIndex) => {
                const roleTheme = getRoleColorTheme(emp.role, roleDefinitions)
                return (
                <tr key={emp.id} className="border-b border-slate-200 hover:bg-slate-50/70">
                  <td className="border-l-4 p-3.5 align-top" style={roleTheme.rowAccentStyle}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="flex flex-col gap-2">
                          <button
                            className="rounded-lg border border-slate-300 p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:text-gray-300"
                            disabled={!isEditableWeek || rowIndex === 0}
                            onClick={() => moveStaffRow(emp.id, 'up')}
                          >
                            <ChevronUp className="w-5 h-5" />
                          </button>
                          <button
                            className="rounded-lg border border-slate-300 p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:text-gray-300"
                            disabled={!isEditableWeek || rowIndex === displayedEmployees.length - 1}
                            onClick={() => moveStaffRow(emp.id, 'down')}
                          >
                            <ChevronDown className="w-5 h-5" />
                          </button>
                        </div>
                        <div>
                          <div className="font-semibold text-[15px]">{employeeNamesById.get(emp.id) ?? emp.name}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]" style={roleTheme.badgeStyle}>
                              {getRoleLabel(emp.role, roleDefinitions)}
                            </span>
                            {!emp.is_active && (
                              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                                Archived
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 pt-1">
                        <button
                          className="rounded-md border border-red-200 p-1.5 text-red-500 hover:bg-red-50 hover:text-red-700 disabled:text-gray-300"
                          disabled={!isEditableWeek}
                          onClick={() => setStaffRemovalTarget(emp)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </td>
                  {days.map(d => {
                    const dateStr = formatDate(d)
                    const shifts = getShifts(emp.id, dateStr)
                    return (
                      <td key={d.toISOString()} className="p-2.5 align-top">
                        {shifts.map((sh, idx) => {
                          const globalIdx = drafts.indexOf(sh)
                          return sh.is_off ? (
                            <button
                              key={idx}
                              type="button"
                              className="mb-2 block w-full rounded-xl border p-2 text-center text-[15px] font-semibold text-slate-700 transition-colors hover:brightness-[0.98]"
                              style={roleTheme.shiftCardStyle}
                              disabled={!isEditableWeek}
                              onClick={() => setShiftActionTarget({ draftIndex: globalIdx, employeeId: emp.id, date: dateStr })}
                            >
                              <div>Off</div>
                              {isEditableWeek && (
                                <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                                  Tap to edit
                                </div>
                              )}
                            </button>
                          ) : (
                            <button
                              key={idx}
                              type="button"
                              className="mb-2 block w-full rounded-xl border p-2 text-left text-sm shadow-sm transition-colors hover:brightness-[0.98]"
                              style={roleTheme.shiftCardStyle}
                              disabled={!isEditableWeek}
                              onClick={() => setShiftActionTarget({ draftIndex: globalIdx, employeeId: emp.id, date: dateStr })}
                            >
                              <div className="font-semibold text-[16px] text-slate-900">
                                {formatTime(sh.start_time)} – {formatTime(sh.end_time)}
                              </div>
                              <div className="mt-1 text-[13px] text-slate-600">{formatHours(calcHours(sh.start_time, sh.end_time))}</div>
                              {isEditableWeek && (
                                <div className="mt-2 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                                  Tap to edit
                                </div>
                              )}
                            </button>
                          )
                        })}
                        {shifts.length === 0 && (
                          <button
                            className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-slate-400 p-2 text-[14px] text-slate-500 transition-colors hover:border-slate-700 hover:text-slate-800 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300 disabled:hover:border-gray-200 disabled:hover:text-gray-300"
                            disabled={!isEditableWeek}
                            onClick={() => openAddDialog(dateStr, emp.id)}
                          >
                            <Plus className="w-3 h-3" /> Add
                          </button>
                        )}
                      </td>
                    )
                  })}
                  <td className="p-3.5 text-center font-semibold text-[15px]">
                    {formatHours(getWeeklyHours(emp.id))}
                  </td>
                </tr>
              )})}
              {displayedEmployees.length === 0 && !addStaffInlineOpen && (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-muted-foreground text-sm">
                    No staff lines yet. Click <strong>+ Add staff</strong> below to start building this week&apos;s schedule.
                  </td>
                </tr>
              )}

              {/* ── Inline Add Staff row ── */}
              {isEditableWeek && (
                addStaffInlineOpen ? (
                  <tr className="border-t border-slate-200 bg-slate-50/60">
                    <td colSpan={days.length + 2} className="p-4">
                      {availableEmployeesToAdd.length === 0 ? (
                        <p className="text-sm text-muted-foreground">All available staff are already on this planner.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2 mb-3">
                          {availableEmployeesToAdd.map(employee => {
                            const checked = staffToAdd.includes(employee.id)
                            const roleTheme = getRoleColorTheme(employee.role, roleDefinitions)
                            return (
                              <label
                                key={employee.id}
                                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${checked ? 'border-slate-700 bg-slate-100 font-medium' : 'border-slate-300 bg-white hover:border-slate-500'}`}
                              >
                                <input
                                  type="checkbox"
                                  className="sr-only"
                                  checked={checked}
                                  onChange={e => setStaffToAdd(cur => e.target.checked ? [...cur, employee.id] : cur.filter(id => id !== employee.id))}
                                />
                                <span>{employee.name}</span>
                                <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]" style={roleTheme.badgeStyle}>
                                  {getRoleLabel(employee.role, roleDefinitions)}
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" onClick={addStaffRow} disabled={staffToAdd.length === 0}>
                          Add{staffToAdd.length > 0 ? ` ${staffToAdd.length} staff` : ''}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setAddStaffInlineOpen(false); setStaffToAdd([]) }}>
                          Cancel
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr className="border-t border-dashed border-slate-300">
                    <td colSpan={days.length + 2} className="p-0">
                      <button
                        className="flex w-full items-center gap-2 px-4 py-3 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:text-slate-300"
                        disabled={availableEmployeesToAdd.length === 0}
                        onClick={() => setAddStaffInlineOpen(true)}
                      >
                        <Plus className="w-4 h-4" />
                        Add staff
                        {availableEmployeesToAdd.length > 0 && (
                          <span className="text-xs text-slate-400">({availableEmployeesToAdd.length} available)</span>
                        )}
                      </button>
                    </td>
                  </tr>
                )
              )}

              {/* ── Delete All row ── */}
              {isEditableWeek && displayedEmployees.length > 0 && (
                <tr className="border-t border-dashed border-red-200">
                  <td colSpan={days.length + 2} className="p-0">
                    <button
                      className="flex w-full items-center gap-2 px-4 py-3 text-sm text-red-400 hover:bg-red-50 hover:text-red-600"
                      onClick={() => { setDeleteAllDialogOpen(true); setDeleteAllPin(''); setDeleteAllError(null) }}
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete all staff lines
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
            {displayedEmployees.length > 0 && (
              <tfoot className="bg-slate-100">
                <tr>
                  <td className="p-3.5 text-[15px] font-semibold border-t">Daily Total Hours</td>
                  {days.map(d => (
                    <td key={`total-${d.toISOString()}`} className="border-t p-3.5 text-center">
                      <div className="text-[18px] font-semibold text-slate-900">{formatHours(getDayTotal(formatDate(d)))}</div>
                      <div className="text-[11px] text-muted-foreground mt-1">{formatDisplayDate(d)}</div>
                    </td>
                  ))}
                  <td className="border-t p-3.5 text-center">
                    <div className="text-[18px] font-semibold text-slate-900">
                      {formatHours(displayedEmployees.reduce((sum, employee) => sum + getWeeklyHours(employee.id), 0))}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">Week Total</div>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <Dialog open={deleteAllDialogOpen} onOpenChange={open => { setDeleteAllDialogOpen(open); if (!open) { setDeleteAllPin(''); setDeleteAllError(null) } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete All Staff Lines</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will remove all staff rows and draft shifts for this week&apos;s {department.toUpperCase()} schedule. Enter a manager PIN to confirm.
            </p>
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              This action cannot be undone.
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Manager PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                className="w-full rounded-lg border px-3 py-2 text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="••••"
                value={deleteAllPin}
                onChange={e => { setDeleteAllPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setDeleteAllError(null) }}
              />
              {deleteAllError && <p className="mt-1.5 text-sm text-red-600">{deleteAllError}</p>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDeleteAllDialogOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" className="flex-1" onClick={() => void handleDeleteAll()} disabled={deleteAllPin.length !== 4 || deletingAll}>
                {deletingAll ? 'Deleting…' : 'Delete All'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={publishDialogOpen} onOpenChange={(open) => {
        setPublishDialogOpen(open)
        if (!open) setPublishMode('immediate')
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Publish</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              You are about to publish the {department.toUpperCase()} schedule for {formatWeekRange(weekRef)}.
            </p>
            <div className="rounded-lg border bg-slate-50 p-3 text-sm">
              <div className="flex justify-between">
                <span>Staff lines</span>
                <span className="font-medium">{displayedEmployees.length}</span>
              </div>
              <div className="mt-2 flex justify-between">
                <span>Scheduled shifts</span>
                <span className="font-medium">{drafts.filter(draft => !draft.is_off).length}</span>
              </div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Review once more before confirming. This will replace the published schedule for this department and week.
            </div>
            <div className="rounded-lg border bg-white p-3 text-sm">
              <p className="font-medium text-slate-900">Email Delivery</p>
              <div className="mt-3 grid gap-2">
                <button
                  type="button"
                  onClick={() => setPublishMode('immediate')}
                  className={`rounded-xl border px-3 py-3 text-left transition-colors ${publishMode === 'immediate' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                >
                  <div className="font-medium text-slate-900">Send Immediately</div>
                  <div className="mt-1 text-muted-foreground">
                    Publish the schedule and send the email right now.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setPublishMode('queued')}
                  className={`rounded-xl border px-3 py-3 text-left transition-colors ${publishMode === 'queued' ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                >
                  <div className="font-medium text-slate-900">Schedule Queued</div>
                  <div className="mt-1 text-muted-foreground">
                    Queue one email send for {getQueuedSendAt(days[0] ?? new Date()).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}.
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    If this week already had a queued email, the latest publish replaces it so duplicate emails do not go out.
                  </div>
                </button>
              </div>
            </div>
            <div className="rounded-lg border bg-white p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">Current action</p>
                  <p className="mt-1 text-muted-foreground">
                    {publishMode === 'immediate'
                      ? 'This publish will send the schedule email immediately.'
                      : `This publish will queue the email for ${getQueuedSendAt(days[0] ?? new Date()).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}.`}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${publishMode === 'immediate' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>
                  {publishMode === 'immediate' ? 'Immediate' : 'Queued'}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setPublishDialogOpen(false); setPublishMode('immediate') }}>
                Back
              </Button>
              <Button className="flex-1" onClick={handlePublish} disabled={saving}>
                {saving ? 'Publishing…' : 'Confirm Publish'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!addDialog} onOpenChange={v => !v && setAddDialog(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>{addDialog && typeof addDialog.draftIndex === 'number' ? 'Modify Shift' : 'Add Shift'}</DialogTitle>
          </DialogHeader>
          {addDialog && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {employeeNamesById.get(addDialog.employee_id) ?? employees.find(e => e.id === addDialog.employee_id)?.name} — {addDialog.date}
              </p>

              {!isMondayDate(addDialog.date) && (
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
              )}

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

              {addForm.is_off && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm text-slate-700">
                  This day will be saved as <span className="font-semibold">Off</span>.
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setAddDialog(null)}>Cancel</Button>
                <Button className="flex-1" onClick={addShift}>
                  {addForm.is_off ? 'Save Off Day' : 'Add Shift'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!shiftActionTarget} onOpenChange={open => !open && setShiftActionTarget(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Shift Actions</DialogTitle>
          </DialogHeader>
          {shiftActionTarget && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {employeeNamesById.get(shiftActionTarget.employeeId) ?? employees.find(employee => employee.id === shiftActionTarget.employeeId)?.name} — {shiftActionTarget.date}
              </p>
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  className="h-11 justify-start"
                  onClick={() => {
                    openAddDialog(shiftActionTarget.date, shiftActionTarget.employeeId, shiftActionTarget.draftIndex)
                    setShiftActionTarget(null)
                  }}
                >
                  Modify Shift
                </Button>
                <Button
                  variant="outline"
                  className="h-11 justify-start"
                  onClick={() => {
                    openAddDialog(shiftActionTarget.date, shiftActionTarget.employeeId)
                    setShiftActionTarget(null)
                  }}
                >
                  Add Another Shift
                </Button>
                <Button
                  variant="outline"
                  className="h-11 justify-start text-red-600"
                  onClick={() => {
                    removeShift(shiftActionTarget.draftIndex)
                    setShiftActionTarget(null)
                  }}
                >
                  Remove Shift
                </Button>
                <Button variant="ghost" className="h-10" onClick={() => setShiftActionTarget(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!staffRemovalTarget} onOpenChange={open => !open && setStaffRemovalTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove Staff Line</DialogTitle>
          </DialogHeader>
          {staffRemovalTarget && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Remove <span className="font-semibold text-slate-900">{staffRemovalTarget.name}</span> from this weekly planner?
                This will also remove all unpublished shifts for this staff line in the current week.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setStaffRemovalTarget(null)}>
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  variant="destructive"
                  onClick={() => {
                    removeStaffRow(staffRemovalTarget.id)
                    setStaffRemovalTarget(null)
                  }}
                >
                  Remove Line
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
