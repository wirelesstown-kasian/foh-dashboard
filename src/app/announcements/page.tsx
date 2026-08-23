'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bell, CalendarPlus, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { AnnouncementDuration, AnnouncementEvent, AnnouncementRecurrence } from '@/lib/appSettings'

type AnnouncementPayload = {
  announcement?: string
  events?: AnnouncementEvent[]
  boardText?: string
  error?: string
}

const EMPTY_EVENT: AnnouncementEvent = {
  id: '',
  title: '',
  date: '',
  time: '',
  day_start_time: '',
  day_end_time: '',
  place: '',
  duration: '7days',
  recurrence: 'none',
  recurrence_end_date: '',
  is_active: true,
}

function durationLabel(duration: AnnouncementDuration) {
  if (duration === 'month') return '1 month before'
  if (duration === 'until_close') return 'Now until close'
  return '7 days before'
}

function recurrenceLabel(recurrence: AnnouncementRecurrence | undefined) {
  if (recurrence === 'daily') return 'Daily'
  if (recurrence === 'weekly') return 'Weekly'
  if (recurrence === 'monthly') return 'Monthly'
  if (recurrence === 'annually') return 'Annually'
  return 'No repeat'
}

function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getMonthDays(monthDate: Date) {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
}

function eventOccursOnDate(event: AnnouncementEvent, dateKey: string) {
  if (!event.is_active) return false
  if (!event.date) return false
  const recurrence = event.recurrence ?? 'none'
  if (recurrence === 'none') return event.date === dateKey
  if (dateKey < event.date) return false
  if (event.recurrence_end_date && dateKey > event.recurrence_end_date) return false

  const eventDate = new Date(`${event.date}T12:00:00`)
  const targetDate = new Date(`${dateKey}T12:00:00`)
  if (Number.isNaN(eventDate.getTime()) || Number.isNaN(targetDate.getTime())) return false
  if (recurrence === 'daily') return true
  if (recurrence === 'weekly') return eventDate.getDay() === targetDate.getDay()
  if (recurrence === 'monthly') return eventDate.getDate() === targetDate.getDate()
  if (recurrence === 'annually') return eventDate.getMonth() === targetDate.getMonth() && eventDate.getDate() === targetDate.getDate()
  return false
}

function getCalendarEvents(events: AnnouncementEvent[], dateKey: string) {
  return events.filter(event => eventOccursOnDate(event, dateKey))
}

function getNextOccurrenceKey(event: AnnouncementEvent, fromDateKey: string) {
  if (!event.is_active || !event.date) return null
  if ((event.recurrence ?? 'none') === 'none') return event.date >= fromDateKey ? event.date : null

  const fromDate = new Date(`${fromDateKey}T12:00:00`)
  if (Number.isNaN(fromDate.getTime())) return null
  for (let index = 0; index < 370; index += 1) {
    const date = new Date(fromDate)
    date.setDate(fromDate.getDate() + index)
    const dateKey = formatDateKey(date)
    if (eventOccursOnDate(event, dateKey)) return dateKey
  }
  return null
}

function getEventSortKey(event: AnnouncementEvent, fromDateKey: string) {
  const occurrenceKey = getNextOccurrenceKey(event, fromDateKey)
  return occurrenceKey ? `${occurrenceKey} ${event.time ?? '99:99'} ${event.title}` : null
}

function getEventDetailLine(event: AnnouncementEvent) {
  const dayWindow = event.day_start_time && event.day_end_time
    ? `${event.day_start_time}-${event.day_end_time}`
    : null
  return [
    event.date || 'No date',
    event.time || null,
    dayWindow ? `day-of ${dayWindow}` : null,
    event.place ? `at ${event.place}` : null,
    recurrenceLabel(event.recurrence),
  ].filter(Boolean).join(' | ')
}

function getCalendarChipText(event: AnnouncementEvent) {
  return [event.time ? event.time.slice(0, 5) : null, event.title].filter(Boolean).join(' ')
}

function formatDisplayDate(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00`)
  return Number.isNaN(date.getTime())
    ? dateKey
    : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

const getAnnouncementLines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean)

export default function AnnouncementsPage() {
  const [announcement, setAnnouncement] = useState('')
  const [events, setEvents] = useState<AnnouncementEvent[]>([])
  const [preview, setPreview] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => new Date())
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [selectedDateKey, setSelectedDateKey] = useState(() => formatDateKey(new Date()))
  const [draftEvent, setDraftEvent] = useState<AnnouncementEvent>(() => ({
    ...EMPTY_EVENT,
    id: 'draft-event',
    date: formatDateKey(new Date()),
  }))
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    void (async () => {
      const res = await fetch('/api/announcements', { cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as AnnouncementPayload
      if (!mounted) return
      if (!res.ok) {
        setError(data.error ?? 'Failed to load announcements')
      } else {
        setAnnouncement(data.announcement ?? '')
        setEvents(data.events ?? [])
        setPreview(data.boardText ?? '')
      }
      setLoading(false)
    })()
    return () => {
      mounted = false
    }
  }, [])

  const updateEvent = (id: string, patch: Partial<AnnouncementEvent>) => {
    setEvents(current => current.map(event => event.id === id ? { ...event, ...patch } : event))
  }

  const updateDraftEvent = (patch: Partial<AnnouncementEvent>) => {
    setDraftEvent(current => ({ ...current, ...patch }))
  }

  const updateCreatorEvent = (patch: Partial<AnnouncementEvent>) => {
    if (selectedEventId && events.some(event => event.id === selectedEventId)) {
      updateEvent(selectedEventId, patch)
      return
    }
    updateDraftEvent(patch)
  }

  const updateCreatorRecurrence = (recurrence: AnnouncementRecurrence) => {
    updateCreatorEvent(recurrence === 'none' ? { recurrence, recurrence_end_date: '' } : { recurrence })
  }

  const resetDraftEvent = (dateKey = selectedDateKey) => {
    setSelectedEventId(null)
    setDraftEvent({
      ...EMPTY_EVENT,
      id: 'draft-event',
      date: dateKey,
    })
  }

  const addDraftEvent = () => {
    if (!draftEvent.title.trim() || !draftEvent.date) {
      setError('Event title and date are required.')
      return
    }
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `event-${Date.now()}`
    const nextEvent = {
      ...draftEvent,
      id,
      title: draftEvent.title.trim(),
      is_active: true,
    }
    setEvents(current => [...current, nextEvent])
    setSelectedEventId(id)
    setSelectedDateKey(nextEvent.date)
    setDraftEvent({ ...EMPTY_EVENT, id: 'draft-event', date: nextEvent.date })
    setError(null)
  }

  const selectCalendarDate = (dateKey: string, matchingEvents: AnnouncementEvent[]) => {
    setSelectedDateKey(dateKey)
    setCalendarMonth(new Date(`${dateKey}T12:00:00`))
    if (matchingEvents.length > 0) {
      setSelectedEventId(matchingEvents[0].id)
      return
    }
    resetDraftEvent(dateKey)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch('/api/announcements', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ announcement, events }),
      })
      const data = (await res.json().catch(() => ({}))) as AnnouncementPayload
      if (!res.ok) {
        setError(data.error ?? 'Failed to save announcements')
        return
      }
      setAnnouncement(data.announcement ?? '')
      setEvents(data.events ?? [])
      const previewRes = await fetch('/api/announcements', { cache: 'no-store' })
      const previewData = (await previewRes.json().catch(() => ({}))) as AnnouncementPayload
      setPreview(previewData.boardText ?? '')
      window.dispatchEvent(new Event('announcements-updated'))
      setMessage('Announcement board saved')
    } finally {
      setSaving(false)
    }
  }

  const calendarDays = useMemo(() => getMonthDays(calendarMonth), [calendarMonth])
  const calendarTitle = calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const previewLines = getAnnouncementLines(preview || announcement)
  const todayKey = formatDateKey(new Date())
  const nextUpcomingEvent = useMemo(() => {
    return events
      .map(event => ({ event, sortKey: getEventSortKey(event, todayKey) }))
      .filter((entry): entry is { event: AnnouncementEvent; sortKey: string } => Boolean(entry.sortKey))
      .sort((left, right) => left.sortKey.localeCompare(right.sortKey))[0]?.event ?? null
  }, [events, todayKey])
  const selectedExistingEvent = events.find(event => event.id === selectedEventId) ?? null
  const selectedCalendarEvents = getCalendarEvents(events, selectedDateKey)
  const creatorEvent = selectedExistingEvent ?? draftEvent
  const isEditingExistingEvent = selectedExistingEvent !== null

  return (
    <div className="p-4 sm:p-6">
      <AdminSubpageHeader
        title="Announcement Board"
        subtitle="Manage announcements, simple event reminders, and automatic birthday notices."
      />

      {loading ? (
        <p className="text-muted-foreground">Loading announcements...</p>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <section className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                  <Bell className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-semibold">Announcement</h2>
                  <p className="text-sm text-muted-foreground">Appears on the clock-in screen and dashboard announcement board.</p>
                </div>
              </div>
              <Label>Announcement</Label>
              <Textarea
                value={announcement}
                onChange={event => setAnnouncement(event.target.value)}
                className="mt-1 min-h-28 text-base"
                placeholder="Example: Patio section open tonight. Check with manager before breaks."
              />
            </section>

            <section className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Calendar</h2>
                  <p className="text-sm text-muted-foreground">Click a date to load it into Event Creator.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setCalendarMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                    aria-label="Previous month"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-36 text-center text-sm font-semibold">{calendarTitle}</div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setCalendarMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                    aria-label="Next month"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-slate-400">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <div key={day}>{day}</div>)}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {calendarDays.map(date => {
                  const dateKey = formatDateKey(date)
                  const matchingEvents = getCalendarEvents(events, dateKey)
                  const dayEvents = matchingEvents.slice(0, 2)
                  const inMonth = date.getMonth() === calendarMonth.getMonth()
                  const isSelectedDate = dateKey === selectedDateKey
                  return (
                    <button
                      key={dateKey}
                      type="button"
                      className={`min-h-20 rounded-lg border p-1.5 text-left transition ${
                        isSelectedDate
                          ? 'border-blue-600 bg-blue-50 text-blue-950 ring-2 ring-blue-200'
                          : inMonth
                            ? 'bg-white hover:border-blue-300 hover:bg-blue-50/40'
                            : 'bg-slate-50 text-slate-400 hover:border-blue-200'
                      }`}
                      onClick={() => selectCalendarDate(dateKey, matchingEvents)}
                    >
                      <div className="text-xs font-semibold">{date.getDate()}</div>
                      <div className="mt-1 space-y-1">
                        {dayEvents.map(event => (
                          <span
                            key={`${dateKey}-${event.id}`}
                            className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-semibold ${
                              selectedExistingEvent?.id === event.id
                                ? 'bg-blue-700 text-white'
                                : 'bg-blue-50 text-blue-800 hover:bg-blue-100'
                            }`}
                          >
                            {getCalendarChipText(event)}
                          </span>
                        ))}
                        {matchingEvents.length > 2 && (
                          <div className="text-[10px] font-semibold text-slate-500">More...</div>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
              <div className="mt-4 rounded-lg border bg-slate-50 p-3">
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                  {formatDisplayDate(selectedDateKey)}
                </div>
                {selectedCalendarEvents.length > 0 ? (
                  <div className="mt-2 grid gap-2">
                    {selectedCalendarEvents.map(event => (
                      <button
                        key={event.id}
                        type="button"
                        className={`rounded-md border px-3 py-2 text-left text-sm ${
                          selectedExistingEvent?.id === event.id
                            ? 'border-blue-300 bg-blue-50 text-blue-950'
                            : 'bg-white hover:border-blue-200 hover:bg-blue-50/40'
                        }`}
                        onClick={() => setSelectedEventId(event.id)}
                      >
                        <div className="font-semibold">{event.title}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{getEventDetailLine(event)}</div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-muted-foreground">No event on this date. Event Creator is preloaded with this date.</div>
                )}
              </div>
            </section>

            <section className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                    <CalendarPlus className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold">Next Event Detail</h2>
                    <p className="text-sm text-muted-foreground">The next active event based on today&apos;s date.</p>
                  </div>
                </div>
                <Button type="button" variant="outline" onClick={() => resetDraftEvent(selectedDateKey)}>
                  <Plus className="h-4 w-4" /> New Event
                </Button>
              </div>
              {nextUpcomingEvent ? (
                <button
                  type="button"
                  className="w-full rounded-lg border bg-slate-50 p-3 text-left hover:border-blue-200 hover:bg-blue-50/40"
                  onClick={() => {
                    setSelectedEventId(nextUpcomingEvent.id)
                    setSelectedDateKey(getNextOccurrenceKey(nextUpcomingEvent, todayKey) ?? nextUpcomingEvent.date)
                  }}
                >
                  <div className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">Next Upcoming Event</div>
                  <div className="mt-1 text-base font-semibold text-slate-950">{nextUpcomingEvent.title || 'Untitled event'}</div>
                  <div className="text-xs text-muted-foreground">{getEventDetailLine(nextUpcomingEvent)}</div>
                </button>
              ) : (
                <div className="rounded-lg border border-dashed bg-slate-50 p-5 text-center text-sm text-muted-foreground">
                  No upcoming event yet.
                </div>
              )}
            </section>

            <section className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                    <CalendarPlus className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold">Event Creator</h2>
                    <p className="text-sm text-muted-foreground">{isEditingExistingEvent ? 'Editing selected calendar event.' : `New event date: ${formatDisplayDate(creatorEvent.date || selectedDateKey)}`}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div key={creatorEvent.id} className="rounded-lg border bg-slate-50 p-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <Label>Event</Label>
                      <Input value={creatorEvent.title} onChange={input => updateCreatorEvent({ title: input.target.value })} className="mt-1" placeholder="Staff meeting" />
                    </div>
                    <div>
                      <Label>Date</Label>
                      <Input
                        type="date"
                        value={creatorEvent.date}
                        onChange={input => {
                          updateCreatorEvent({ date: input.target.value })
                          setSelectedDateKey(input.target.value)
                        }}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label>Time</Label>
                      <Input type="time" value={creatorEvent.time ?? ''} onChange={input => updateCreatorEvent({ time: input.target.value })} className="mt-1" />
                    </div>
                    <div>
                      <Label>Day-of Start</Label>
                      <Input type="time" value={creatorEvent.day_start_time ?? ''} onChange={input => updateCreatorEvent({ day_start_time: input.target.value })} className="mt-1" />
                    </div>
                    <div>
                      <Label>Day-of End</Label>
                      <Input type="time" value={creatorEvent.day_end_time ?? ''} onChange={input => updateCreatorEvent({ day_end_time: input.target.value })} className="mt-1" />
                    </div>
                    <div>
                      <Label>Place</Label>
                      <Input value={creatorEvent.place ?? ''} onChange={input => updateCreatorEvent({ place: input.target.value })} className="mt-1" placeholder="Dining room" />
                    </div>
                    <div>
                      <Label>Announcement Duration</Label>
                      <Select value={creatorEvent.duration} onValueChange={(value: string | null) => value && updateCreatorEvent({ duration: value as AnnouncementDuration })}>
                        <SelectTrigger className="mt-1">
                          <span>{durationLabel(creatorEvent.duration)}</span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="7days">7 days before</SelectItem>
                          <SelectItem value="month">1 month before</SelectItem>
                          <SelectItem value="until_close">Now until event close</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Recurring</Label>
                      <Select value={creatorEvent.recurrence ?? 'none'} onValueChange={(value: string | null) => value && updateCreatorRecurrence(value as AnnouncementRecurrence)}>
                        <SelectTrigger className="mt-1">
                          <span>{recurrenceLabel(creatorEvent.recurrence)}</span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No repeat</SelectItem>
                          <SelectItem value="daily">Daily</SelectItem>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="monthly">Monthly</SelectItem>
                          <SelectItem value="annually">Annually</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Repeat Until</Label>
                      <Input
                        type="date"
                        value={creatorEvent.recurrence_end_date ?? ''}
                        onChange={input => updateCreatorEvent({ recurrence_end_date: input.target.value })}
                        className="mt-1"
                        disabled={(creatorEvent.recurrence ?? 'none') === 'none'}
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" checked={creatorEvent.is_active} onChange={input => updateCreatorEvent({ is_active: input.target.checked })} />
                      Active
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {isEditingExistingEvent ? (
                        <Button
                          type="button"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => {
                            setEvents(current => current.filter(item => item.id !== creatorEvent.id))
                            resetDraftEvent(selectedDateKey)
                          }}
                        >
                          <Trash2 className="h-4 w-4" /> Remove
                        </Button>
                      ) : (
                        <Button type="button" onClick={addDraftEvent}>
                          <Plus className="h-4 w-4" /> Add Event
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <aside className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm xl:sticky xl:top-4 xl:self-start">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Live Preview</div>
            <div className="mt-2 rounded-lg border border-amber-200 bg-white p-3 text-base font-semibold text-amber-950">
              {previewLines.length > 0 ? (
                <div className="space-y-1">
                  {previewLines.map((line, index) => (
                    <div key={`${line}-${index}`} className="flex items-start gap-2">
                      <span className="text-amber-600">-</span>
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
              ) : (
                'No active announcement today.'
              )}
            </div>
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
              Birthdays from Staffing appear automatically on the employee birthday date.
            </div>
            {(error || message) && (
              <div className={`mt-4 rounded-lg border px-3 py-2 text-sm ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                {error ?? message}
              </div>
            )}
            <Button className="mt-4 h-11 w-full font-semibold" onClick={save} disabled={saving}>
              {saving ? 'Saving...' : 'Save Announcement Board'}
            </Button>
          </aside>
        </div>
      )}
    </div>
  )
}
