import { BUSINESS_DAY_CUTOFF_HOUR } from '@/lib/dateUtils'
import { ShiftClock } from '@/lib/types'

export const CLOCK_PHOTO_BUCKET = 'clock-photos'
export const BUSINESS_TIMEZONE = 'America/Chicago'

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

export function getEffectiveClockHours(record: ShiftClock) {
  if (record.approval_status === 'approved' || record.approval_status === 'adjusted') {
    return Number(record.approved_hours ?? 0)
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
