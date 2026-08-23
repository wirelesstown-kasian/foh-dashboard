'use client'

import { useEffect, useState } from 'react'
import { Bell, CalendarPlus, Plus, Trash2 } from 'lucide-react'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { AnnouncementDuration, AnnouncementEvent } from '@/lib/appSettings'

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
  place: '',
  duration: '7days',
  is_active: true,
}

function durationLabel(duration: AnnouncementDuration) {
  if (duration === 'month') return '1 month before'
  if (duration === 'until_close') return 'Now until close'
  return '7 days before'
}

export default function AnnouncementsPage() {
  const [announcement, setAnnouncement] = useState('')
  const [events, setEvents] = useState<AnnouncementEvent[]>([])
  const [preview, setPreview] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
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

  const addEvent = () => {
    setEvents(current => [
      ...current,
      {
        ...EMPTY_EVENT,
        id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `event-${Date.now()}`,
      },
    ])
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

  return (
    <div className="p-4 sm:p-6">
      <AdminSubpageHeader
        title="Announcement Board"
        subtitle="Manage clock-in announcements, simple event reminders, and automatic birthday notices."
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
                  <h2 className="font-semibold">Clock-In Announcement</h2>
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
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                    <CalendarPlus className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold">Event Calendar</h2>
                    <p className="text-sm text-muted-foreground">Simple reminders with date, time, place, and display duration.</p>
                  </div>
                </div>
                <Button type="button" onClick={addEvent}>
                  <Plus className="h-4 w-4" /> Add Event
                </Button>
              </div>

              <div className="space-y-3">
                {events.map(event => (
                  <div key={event.id} className="rounded-lg border bg-slate-50 p-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="md:col-span-2">
                        <Label>Event</Label>
                        <Input value={event.title} onChange={input => updateEvent(event.id, { title: input.target.value })} className="mt-1" placeholder="Staff meeting" />
                      </div>
                      <div>
                        <Label>Date</Label>
                        <Input type="date" value={event.date} onChange={input => updateEvent(event.id, { date: input.target.value })} className="mt-1" />
                      </div>
                      <div>
                        <Label>Time</Label>
                        <Input type="time" value={event.time ?? ''} onChange={input => updateEvent(event.id, { time: input.target.value })} className="mt-1" />
                      </div>
                      <div>
                        <Label>Place</Label>
                        <Input value={event.place ?? ''} onChange={input => updateEvent(event.id, { place: input.target.value })} className="mt-1" placeholder="Dining room" />
                      </div>
                      <div>
                        <Label>Announcement Duration</Label>
                        <Select value={event.duration} onValueChange={(value: string | null) => value && updateEvent(event.id, { duration: value as AnnouncementDuration })}>
                          <SelectTrigger className="mt-1">
                            <span>{durationLabel(event.duration)}</span>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="7days">7 days before</SelectItem>
                            <SelectItem value="month">1 month before</SelectItem>
                            <SelectItem value="until_close">Now until event close</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <input type="checkbox" checked={event.is_active} onChange={input => updateEvent(event.id, { is_active: input.target.checked })} />
                        Active
                      </label>
                      <Button type="button" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => setEvents(current => current.filter(item => item.id !== event.id))}>
                        <Trash2 className="h-4 w-4" /> Remove
                      </Button>
                    </div>
                  </div>
                ))}
                {events.length === 0 && (
                  <div className="rounded-lg border border-dashed bg-slate-50 p-5 text-center text-sm text-muted-foreground">
                    No events yet. Add one for meetings, parties, holidays, or schedule reminders.
                  </div>
                )}
              </div>
            </section>
          </div>

          <aside className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm xl:sticky xl:top-4 xl:self-start">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Live Preview</div>
            <div className="mt-2 whitespace-pre-line rounded-lg border border-amber-200 bg-white p-3 text-base font-semibold text-amber-950">
              {preview || announcement || 'No active announcement today.'}
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
