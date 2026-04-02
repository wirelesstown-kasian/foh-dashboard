import {
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  format,
  eachDayOfInterval,
  differenceInMinutes,
  parse,
} from 'date-fns'

// Week starts Monday
export const WEEK_START = { weekStartsOn: 1 as const }
export const BUSINESS_DAY_CUTOFF_HOUR = 4

export function getBusinessDate(referenceDate: Date = new Date()): Date {
  const businessDate = new Date(referenceDate)
  if (businessDate.getHours() < BUSINESS_DAY_CUTOFF_HOUR) {
    businessDate.setDate(businessDate.getDate() - 1)
  }
  return businessDate
}

export function getBusinessDateString(referenceDate: Date = new Date()): string {
  return formatDate(getBusinessDate(referenceDate))
}

export function getBusinessDateTime(sessionDate: string, time: string): Date {
  const [hour = '0', minute = '0', second = '0'] = time.split(':')
  const date = new Date(`${sessionDate}T00:00:00`)
  date.setHours(Number(hour), Number(minute), Number(second), 0)

  if (Number(hour) < BUSINESS_DAY_CUTOFF_HOUR) {
    date.setDate(date.getDate() + 1)
  }

  return date
}

export function getWeekDays(referenceDate: Date): Date[] {
  const start = startOfWeek(referenceDate, WEEK_START)
  const end = endOfWeek(referenceDate, WEEK_START)
  return eachDayOfInterval({ start, end })
}

export function getPrevWeek(date: Date): Date {
  return subWeeks(date, 1)
}

export function getNextWeek(date: Date): Date {
  return addWeeks(date, 1)
}

export function formatDate(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function formatDisplayDate(date: Date): string {
  return format(date, 'MMM d')
}

export function formatWeekRange(date: Date): string {
  const start = startOfWeek(date, WEEK_START)
  const end = endOfWeek(date, WEEK_START)
  return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`
}

export function calcHours(startTime: string, endTime: string): number {
  const base = new Date('2000-01-01')
  const start = parse(startTime, 'HH:mm:ss', base)
  let end = parse(endTime, 'HH:mm:ss', base)
  // Handle overnight shifts
  if (end <= start) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000)
  }
  return Math.round((differenceInMinutes(end, start) / 60) * 100) / 100
}

export function formatHours(hours: number): string {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export function formatTime(time: string): string {
  if (!time) return ''
  const [h, m] = time.split(':')
  const hour = parseInt(h, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${m} ${ampm}`
}

export function isBirthdayToday(birthDate: string | null): boolean {
  if (!birthDate) return false
  const today = new Date()
  const bday = new Date(birthDate)
  return today.getMonth() === bday.getMonth() && today.getDate() === bday.getDate()
}

export function getDayName(date: Date): string {
  return format(date, 'EEE')
}
