import { BUSINESS_DAY_CUTOFF_HOUR } from '@/lib/dateUtils'
import { ShiftClock } from '@/lib/types'

export const CLOCK_PHOTO_BUCKET = 'clock-photos'

export function getSessionCutoffIso(sessionDate: string) {
  const cutoff = new Date(`${sessionDate}T00:00:00`)
  cutoff.setDate(cutoff.getDate() + 1)
  cutoff.setHours(BUSINESS_DAY_CUTOFF_HOUR, 0, 0, 0)
  return cutoff.toISOString()
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
