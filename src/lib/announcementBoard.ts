import type { AnnouncementEvent } from '@/lib/appSettings'

export type AnnouncementBoardItem = {
  id: string
  type: 'manager' | 'event' | 'birthday'
  title: string
  detail?: string
}

function parseDateKey(value: string) {
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function getEventOccurrenceDate(event: AnnouncementEvent, today: string) {
  const recurrence = event.recurrence ?? 'none'
  if (recurrence === 'none') return event.date === today ? event.date : null
  if (today < event.date) return null
  if (event.recurrence_end_date && today > event.recurrence_end_date) return null

  const eventDate = parseDateKey(event.date)
  const todayDate = parseDateKey(today)
  if (!eventDate || !todayDate) return null

  if (recurrence === 'daily') return today
  if (recurrence === 'weekly') return eventDate.getDay() === todayDate.getDay() ? today : null
  if (recurrence === 'monthly') return eventDate.getDate() === todayDate.getDate() ? today : null
  if (recurrence === 'annually') {
    return eventDate.getMonth() === todayDate.getMonth() && eventDate.getDate() === todayDate.getDate() ? today : null
  }
  return null
}

function isEventActive(event: AnnouncementEvent, today: string, now: Date) {
  if (event.is_active === false) return false
  const eventDate = parseDateKey(event.date)
  const todayDate = parseDateKey(today)
  if (!eventDate || !todayDate) return false
  const occurrenceDate = getEventOccurrenceDate(event, today)
  const recurrence = event.recurrence ?? 'none'

  if (occurrenceDate && event.day_start_time && event.day_end_time) {
    const startAt = new Date(`${today}T${event.day_start_time}`)
    const endAt = new Date(`${today}T${event.day_end_time}`)
    if (!Number.isNaN(startAt.getTime()) && !Number.isNaN(endAt.getTime())) {
      return now >= startAt && now <= endAt
    }
  }

  if (recurrence !== 'none') return !!occurrenceDate

  if (event.duration === 'month') {
    return today >= dateKey(addDays(eventDate, -30)) && today <= event.date
  }
  if (event.duration === '7days') {
    return today >= dateKey(addDays(eventDate, -7)) && today <= event.date
  }

  if (today > event.date) return false
  if (today < event.date) return true
  if (!event.time) return true
  const closeAt = new Date(`${event.date}T${event.time}`)
  if (Number.isNaN(closeAt.getTime())) return true
  closeAt.setHours(closeAt.getHours() + 2)
  return now <= closeAt
}

function formatEventDetail(event: AnnouncementEvent) {
  const dayWindow = event.day_start_time && event.day_end_time
    ? `${event.day_start_time.slice(0, 5)}-${event.day_end_time.slice(0, 5)}`
    : null
  return [
    event.date,
    event.time ? event.time.slice(0, 5) : null,
    dayWindow,
    event.place ? `at ${event.place}` : null,
  ].filter(Boolean).join(' ')
}

function isBirthdayOnDate(birthDate: string | null | undefined, today: string) {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return false
  return birthDate.slice(5) === today.slice(5)
}

export function buildAnnouncementItems({
  announcement,
  events,
  employees,
  today,
  now = new Date(),
}: {
  announcement: string
  events: AnnouncementEvent[]
  employees: Array<{ id: string; name: string; birth_date?: string | null }>
  today: string
  now?: Date
}) {
  const items: AnnouncementBoardItem[] = []
  const trimmedAnnouncement = announcement.trim()
  if (trimmedAnnouncement) {
    items.push({ id: 'manager-announcement', type: 'manager', title: trimmedAnnouncement })
  }

  for (const event of events) {
    if (!isEventActive(event, today, now)) continue
    items.push({
      id: `event-${event.id}`,
      type: 'event',
      title: event.title,
      detail: formatEventDetail(event),
    })
  }

  for (const employee of employees) {
    if (!isBirthdayOnDate(employee.birth_date, today)) continue
    items.push({
      id: `birthday-${employee.id}`,
      type: 'birthday',
      title: `Happy birthday, ${employee.name}!`,
      detail: 'Today',
    })
  }

  return items
}

export function formatAnnouncementBoardText(items: AnnouncementBoardItem[]) {
  return items.map(item => item.detail ? `${item.title} - ${item.detail}` : item.title).join('\n')
}
