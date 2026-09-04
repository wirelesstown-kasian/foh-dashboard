import { BUSINESS_DAY_CUTOFF_HOUR } from '@/lib/dateUtils'
import { getEmployeeScheduleDepartments, normalizeScheduleDepartment } from '@/lib/employeeSelect'
import { Employee, Schedule, ShiftClock } from '@/lib/types'

export const CLOCK_PHOTO_BUCKET = 'clock-photos'
export const BUSINESS_TIMEZONE = 'America/Chicago'
export const DEFAULT_MEAL_BREAK_THRESHOLD_HOURS = 7.5
export const MINIMUM_MEAL_BREAK_MINUTES = 30
const MEAL_BREAK_TOKEN_PATTERN = /\s*\[meal_break_(?:started_at|ended_at|minutes)=[^\]]*\]/g
const UNPAID_BREAK_TOKEN_PATTERN = /\s*\[unpaid_break_(?:started_at|ended_at|minutes)=[^\]]*\]/g
const WORK_DEPARTMENT_TOKEN_PATTERN = /\s*\[work_department=[^\]]*\]/g
const FALLBACK_WORK_DEPARTMENT_PRIORITY = ['server']

function getTimeZoneOffsetMinutes(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  })
  const zonePart = formatter.formatToParts(date).find(part => part.type === 'timeZoneName')?.value ?? 'GMT+0'
  const match = zonePart.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/)

  if (!match) return 0

  const [, sign, hours, minutes = '0'] = match
  const total = Number(hours) * 60 + Number(minutes)
  return sign === '-' ? -total : total
}

function getZonedDateIso(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
) {
  let utcGuess = Date.UTC(year, monthIndex, day, hour, minute, second, 0)

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const offsetMinutes = getTimeZoneOffsetMinutes(new Date(utcGuess), timeZone)
    const adjusted = Date.UTC(year, monthIndex, day, hour, minute, second, 0) - offsetMinutes * 60_000
    if (adjusted === utcGuess) break
    utcGuess = adjusted
  }

  return new Date(utcGuess).toISOString()
}

export function getSessionCutoffIso(sessionDate: string) {
  const [year, month, day] = sessionDate.split('-').map(Number)
  return getZonedDateIso(
    year,
    month - 1,
    day + 1,
    BUSINESS_DAY_CUTOFF_HOUR,
    0,
    0,
    BUSINESS_TIMEZONE
  )
}

export function calculateClockHours(clockInAt: string, clockOutAt: string) {
  const diffMs = new Date(clockOutAt).getTime() - new Date(clockInAt).getTime()
  return Math.max(0, Math.round((diffMs / 36e5) * 100) / 100)
}

export function calculateClockHoursAfterBreak(clockInAt: string, clockOutAt: string, breakMinutes = 0) {
  const rawHours = calculateClockHours(clockInAt, clockOutAt)
  const breakHours = Math.max(0, breakMinutes) / 60
  return Math.max(0, Math.round((rawHours - breakHours) * 100) / 100)
}

function calculateBreakMinutes(startedAt: string | null | undefined, endedAt: string | null | undefined) {
  if (!startedAt || !endedAt) return 0
  const minutes = Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60_000)
  return Number.isFinite(minutes) ? Math.max(0, minutes) : 0
}

export function getMealBreakState(record: Pick<ShiftClock, 'manager_note' | 'break_started_at' | 'break_ended_at' | 'break_minutes'>) {
  const note = record.manager_note ?? ''
  const getToken = (key: string) => {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return note.match(new RegExp(`\\[meal_break_${escapedKey}=([^\\]]*)\\]`))?.[1] ?? null
  }
  const parsedMinutes = Number(getToken('minutes') ?? NaN)
  const startedAt = record.break_started_at ?? getToken('started_at')
  const endedAt = record.break_ended_at ?? getToken('ended_at')
  const columnMinutes = typeof record.break_minutes === 'number' ? record.break_minutes : null
  const tokenMinutes = Number.isFinite(parsedMinutes) ? parsedMinutes : null
  const derivedMinutes = calculateBreakMinutes(startedAt, endedAt)
  return {
    startedAt,
    endedAt,
    minutes: columnMinutes && columnMinutes > 0
      ? columnMinutes
      : tokenMinutes && tokenMinutes > 0
        ? tokenMinutes
        : derivedMinutes,
  }
}

export function getUnpaidBreakState(record: Pick<ShiftClock, 'manager_note' | 'unpaid_break_started_at' | 'unpaid_break_ended_at' | 'unpaid_break_minutes'>) {
  const note = record.manager_note ?? ''
  const getToken = (key: string) => {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return note.match(new RegExp(`\\[unpaid_break_${escapedKey}=([^\\]]*)\\]`))?.[1] ?? null
  }
  const parsedMinutes = Number(getToken('minutes') ?? NaN)
  const startedAt = record.unpaid_break_started_at ?? getToken('started_at')
  const endedAt = record.unpaid_break_ended_at ?? getToken('ended_at')
  const columnMinutes = typeof record.unpaid_break_minutes === 'number' ? record.unpaid_break_minutes : null
  const tokenMinutes = Number.isFinite(parsedMinutes) ? parsedMinutes : null
  const derivedMinutes = calculateBreakMinutes(startedAt, endedAt)
  return {
    startedAt,
    endedAt,
    minutes: columnMinutes && columnMinutes > 0
      ? columnMinutes
      : tokenMinutes && tokenMinutes > 0
        ? tokenMinutes
        : derivedMinutes,
  }
}

export function isClockOnMealBreak(record: Pick<ShiftClock, 'manager_note' | 'break_started_at' | 'break_ended_at' | 'break_minutes'>) {
  const breakState = getMealBreakState(record)
  return Boolean(breakState.startedAt && !breakState.endedAt)
}

export function isClockOnUnpaidBreak(record: Pick<ShiftClock, 'manager_note' | 'unpaid_break_started_at' | 'unpaid_break_ended_at' | 'unpaid_break_minutes'>) {
  const breakState = getUnpaidBreakState(record)
  return Boolean(breakState.startedAt && !breakState.endedAt)
}

export function getClockBreakMinutes(record: Pick<ShiftClock, 'manager_note' | 'break_started_at' | 'break_ended_at' | 'break_minutes' | 'unpaid_break_started_at' | 'unpaid_break_ended_at' | 'unpaid_break_minutes'>) {
  return getMealBreakState(record).minutes + getUnpaidBreakState(record).minutes
}

export function getMealBreakThresholdHours(employee: Pick<Employee, 'meal_break_threshold_hours'> | null | undefined) {
  if (employee && employee.meal_break_threshold_hours === null) return null
  const value = Number(employee?.meal_break_threshold_hours ?? DEFAULT_MEAL_BREAK_THRESHOLD_HOURS)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MEAL_BREAK_THRESHOLD_HOURS
}

export function hasCompletedMealBreak(record: Pick<ShiftClock, 'manager_note' | 'break_started_at' | 'break_ended_at' | 'break_minutes'>) {
  const breakState = getMealBreakState(record)
  return Boolean(breakState.startedAt && breakState.endedAt && breakState.minutes >= MINIMUM_MEAL_BREAK_MINUTES)
}

export function shouldWarnMissingMealBreak(record: ShiftClock, employee: Pick<Employee, 'meal_break_threshold_hours'> | null | undefined) {
  if (!record.clock_out_at || isClockPending(record)) return false
  const thresholdHours = getMealBreakThresholdHours(employee)
  if (thresholdHours === null) return false
  const workedHours = getEffectiveClockHours(record)
  return workedHours >= thresholdHours && !hasCompletedMealBreak(record)
}

export function setMealBreakManagerNote(
  note: string | null | undefined,
  state: { startedAt?: string | null; endedAt?: string | null; minutes?: number | null }
) {
  const baseNote = (note ?? '').replace(MEAL_BREAK_TOKEN_PATTERN, '').trim()
  const tokens = [
    state.startedAt ? `[meal_break_started_at=${state.startedAt}]` : '',
    state.endedAt ? `[meal_break_ended_at=${state.endedAt}]` : '',
    typeof state.minutes === 'number' ? `[meal_break_minutes=${Math.max(0, Math.floor(state.minutes))}]` : '',
  ].filter(Boolean)
  return [baseNote, ...tokens].filter(Boolean).join(' ')
}

export function setUnpaidBreakManagerNote(
  note: string | null | undefined,
  state: { startedAt?: string | null; endedAt?: string | null; minutes?: number | null }
) {
  const baseNote = (note ?? '').replace(UNPAID_BREAK_TOKEN_PATTERN, '').trim()
  const tokens = [
    state.startedAt ? `[unpaid_break_started_at=${state.startedAt}]` : '',
    state.endedAt ? `[unpaid_break_ended_at=${state.endedAt}]` : '',
    typeof state.minutes === 'number' ? `[unpaid_break_minutes=${Math.max(0, Math.floor(state.minutes))}]` : '',
  ].filter(Boolean)
  return [baseNote, ...tokens].filter(Boolean).join(' ')
}

export function getVisibleManagerNote(note: string | null | undefined) {
  return (note ?? '')
    .replace(MEAL_BREAK_TOKEN_PATTERN, '')
    .replace(UNPAID_BREAK_TOKEN_PATTERN, '')
    .replace(WORK_DEPARTMENT_TOKEN_PATTERN, '')
    .trim()
}

export function getClockWorkDepartmentFromNote(note: string | null | undefined) {
  return (note ?? '').match(/\[work_department=([^\]]*)\]/)?.[1]?.trim() || null
}

export function setClockWorkDepartmentManagerNote(note: string | null | undefined, department: string | null | undefined) {
  const baseNote = (note ?? '').replace(WORK_DEPARTMENT_TOKEN_PATTERN, '').trim()
  const normalizedDepartment = typeof department === 'string' && department.trim() ? normalizeScheduleDepartment(department) : ''
  return [baseNote, normalizedDepartment ? `[work_department=${normalizedDepartment}]` : ''].filter(Boolean).join(' ')
}

function getPreferredAmbiguousWorkDepartment(departments: string[]) {
  for (const preferredDepartment of FALLBACK_WORK_DEPARTMENT_PRIORITY) {
    const match = departments.find(department => department.toLowerCase() === preferredDepartment)
    if (match) return match
  }
  return departments.find(department => department.toLowerCase() !== 'manager') ?? departments[0] ?? null
}

export function getClockWorkDepartment(
  record: ShiftClock,
  employee?: Pick<Employee, 'role' | 'primary_department' | 'schedule_departments'> | null,
  schedules: Array<Pick<Schedule, 'employee_id' | 'date' | 'department'>> = []
) {
  const directDepartment = (record as ShiftClock & { work_department?: unknown }).work_department
  if (typeof directDepartment === 'string' && directDepartment.trim()) return normalizeScheduleDepartment(directDepartment)

  const noteDepartment = getClockWorkDepartmentFromNote(record.manager_note)
  if (noteDepartment) return normalizeScheduleDepartment(noteDepartment)

  const scheduledDepartments = Array.from(new Set(
    schedules
      .filter(schedule => schedule.employee_id === record.employee_id && schedule.date === record.session_date && typeof schedule.department === 'string' && schedule.department.trim())
      .map(schedule => normalizeScheduleDepartment(String(schedule.department)))
  ))
  if (scheduledDepartments.length === 1) return scheduledDepartments[0]
  const preferredScheduledDepartment = getPreferredAmbiguousWorkDepartment(scheduledDepartments)
  if (preferredScheduledDepartment) return preferredScheduledDepartment

  const relatedEmployee = employee ?? (Array.isArray(record.employee) ? record.employee[0] : record.employee)
  if (relatedEmployee) {
    const employeeDepartments = getEmployeeScheduleDepartments(relatedEmployee)
    const fallbackDepartment = employeeDepartments.length > 1
      ? getPreferredAmbiguousWorkDepartment(employeeDepartments)
      : employeeDepartments[0]
    return fallbackDepartment ?? (relatedEmployee.primary_department ? normalizeScheduleDepartment(relatedEmployee.primary_department) : 'staff')
  }

  return 'staff'
}

export function clockMatchesWorkDepartment(
  record: ShiftClock,
  department: string,
  employee?: Pick<Employee, 'role' | 'primary_department' | 'schedule_departments'> | null,
  schedules: Array<Pick<Schedule, 'employee_id' | 'date' | 'department'>> = []
) {
  if (!department || department === 'all') return true
  return getClockWorkDepartment(record, employee, schedules).trim().toLowerCase() === department.trim().toLowerCase()
}

export function getEffectiveClockHours(record: ShiftClock) {
  if ((record.approval_status === 'approved' || record.approval_status === 'adjusted') && record.clock_out_at) {
    return calculateClockHoursAfterBreak(record.clock_in_at, record.clock_out_at, getClockBreakMinutes(record))
  }
  return 0
}

export function isClockPending(record: ShiftClock) {
  return record.approval_status === 'open' || record.approval_status === 'pending_review'
}

export async function dataUrlToArrayBuffer(dataUrl: string) {
  const [, base64 = ''] = dataUrl.split(',')
  return Uint8Array.from(Buffer.from(base64, 'base64'))
}
