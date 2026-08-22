'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ShiftClock, Schedule } from '@/lib/types'
import { formatTime, getBusinessDateTime } from '@/lib/dateUtils'
import { isClockOnMealBreak } from '@/lib/clockUtils'
import { cn } from '@/lib/utils'
import { ArrowLeft, Camera, Clock3, Coffee, LogIn, LogOut, Utensils } from 'lucide-react'

interface Props {
  schedules: Schedule[]
  clockRecords: ShiftClock[]
  today: string
  onRefresh: () => void
  variant?: 'panel' | 'nav'
}

const CLOCK_IN_TITLE = 'Clock In'
const CLOCK_OUT_TITLE = 'Clock Out'
type ClockAction = 'clock_in' | 'clock_out' | 'toggle_break'
type ClockStatus = {
  state: 'clocked_out' | 'clocked_in' | 'on_break'
  break_type?: 'meal' | 'unpaid' | null
  can_clock_in: boolean
  can_clock_out: boolean
  can_start_break: boolean
  can_end_break: boolean
  can_start_unpaid_break?: boolean
  can_end_unpaid_break?: boolean
  break_used: boolean
  unpaid_break_used?: boolean
  clock_in_at?: string
  break_started_at?: string | null
  break_ended_at?: string | null
  break_minutes?: number
  unpaid_break_started_at?: string | null
  unpaid_break_ended_at?: string | null
  unpaid_break_minutes?: number
}
type EmployeeClockLookup = {
  employee: { id: string; name: string; role: string }
  status: ClockStatus
}

function formatStatusTime(value: string | null | undefined) {
  if (!value) return '-'
  return new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatStatusDateTime(value: string | null | undefined) {
  if (!value) return '-'
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function ClockToolbar({ schedules, clockRecords, today, onRefresh, variant = 'panel' }: Props) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [target, setTarget] = useState<ClockAction | 'toggle_unpaid_break' | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lookup, setLookup] = useState<EmployeeClockLookup | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const firstShift = useMemo(() => {
    return schedules
      .map(schedule => ({ schedule, at: getBusinessDateTime(today, schedule.start_time) }))
      .sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null
  }, [schedules, today])

  const lastShift = useMemo(() => {
    return schedules
      .map(schedule => ({ schedule, at: getBusinessDateTime(today, schedule.end_time) }))
      .sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null
  }, [schedules, today])

  const openClockCount = clockRecords.filter(record => !record.clock_out_at).length
  const activeBreakCount = clockRecords.filter(record => !record.clock_out_at && isClockOnMealBreak(record)).length

  const resetPanel = () => {
    setPanelOpen(false)
    setTarget(null)
    setError(null)
    setLookup(null)
    setLookupLoading(false)
    setPin('')
  }

  const clearLookup = (nextPin: string) => {
    setPin(nextPin)
    setLookup(null)
    setError(null)
  }

  useEffect(() => {
    let cancelled = false

    const stopCamera = () => {
      streamRef.current?.getTracks().forEach(track => track.stop())
      streamRef.current = null
      if (videoRef.current) {
        videoRef.current.srcObject = null
      }
      setCameraReady(false)
    }

    if (!panelOpen || !lookup) {
      stopCamera()
      return
    }

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 320 },
            height: { ideal: 240 },
          },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }
        setCameraReady(true)
      } catch {
        setError('Camera access is required for clock in and clock out')
      }
    })()

    return () => {
      cancelled = true
      stopCamera()
    }
  }, [panelOpen, lookup])

  const captureFrame = () => {
    const video = videoRef.current
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return null
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.9)
  }

  const lookupClockStatus = async () => {
    setError(null)

    if (!/^\d{4}$/.test(pin)) {
      setError('Enter a valid 4-digit PIN')
      return null
    }

    setLookupLoading(true)
    try {
      const res = await fetch('/api/clock-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'lookup_status',
          pin,
          session_date: today,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string } & Partial<EmployeeClockLookup>
      if (!res.ok || !data.employee || !data.status) {
        throw new Error(data.error ?? 'Failed to load clock status')
      }
      const nextLookup = { employee: data.employee, status: data.status }
      setLookup(nextLookup)
      return nextLookup
    } catch (err) {
      setLookup(null)
      setError(err instanceof Error ? err.message : 'Failed to load clock status')
      return null
    } finally {
      setLookupLoading(false)
    }
  }

  const handleSubmit = async (nextTarget: ClockAction | 'toggle_unpaid_break', skipPhoto = false) => {
    setTarget(nextTarget)
    setError(null)

    const currentLookup = lookup ?? await lookupClockStatus()
    if (!currentLookup) return

    if (nextTarget === 'clock_in' && !currentLookup.status.can_clock_in) {
      setError(`${currentLookup.employee.name} is already clocked in.`)
      return
    }
    if (nextTarget === 'clock_out' && !currentLookup.status.can_clock_out) {
      setError(currentLookup.status.state === 'on_break' ? 'End break before clocking out.' : `${currentLookup.employee.name} is not clocked in.`)
      return
    }
    if (nextTarget === 'toggle_break' && !currentLookup.status.can_start_break && !currentLookup.status.can_end_break) {
      setError(currentLookup.status.break_used ? 'Break has already been used for this shift.' : `${currentLookup.employee.name} is not clocked in.`)
      return
    }
    if (nextTarget === 'toggle_unpaid_break' && !currentLookup.status.can_start_unpaid_break && !currentLookup.status.can_end_unpaid_break) {
      setError(currentLookup.status.unpaid_break_used ? 'Regular break has already been used for this shift.' : `${currentLookup.employee.name} is not clocked in.`)
      return
    }

    const needsPhoto = nextTarget === 'clock_in' || nextTarget === 'clock_out'
    const photo = skipPhoto || !needsPhoto ? null : captureFrame()
    if (!skipPhoto && needsPhoto && !photo) {
      setError('Camera preview is not ready yet')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/clock-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: nextTarget,
          pin,
          session_date: today,
          photo_data_url: photo,
          skip_photo: skipPhoto,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; available_at?: string }
      if (!res.ok) {
        if (data.available_at) {
          const available = new Date(data.available_at)
          throw new Error(`${data.error ?? 'Meal break is not complete yet'} You can clock back in at ${available.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`)
        }
        throw new Error(data.error ?? 'Failed to save clock event')
      }

      resetPanel()
      setPin('')
      await onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save clock event')
    } finally {
      setSubmitting(false)
    }
  }

  const statusLabel = lookup
    ? lookup.status.state === 'on_break'
      ? lookup.status.break_type === 'unpaid' ? 'On Regular Break' : 'On Meal Break'
      : lookup.status.state === 'clocked_in'
        ? 'Clocked In'
        : 'Ready to Clock In'
    : 'Enter PIN'
  const mealBreakActionLabel = lookup?.status.can_end_break ? 'End Meal Break' : 'Meal Break'
  const unpaidBreakActionLabel = lookup?.status.can_end_unpaid_break ? 'End Break' : 'Break'
  const isNav = variant === 'nav'

  return (
    <>
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5',
          isNav ? 'relative' : 'rounded-lg border bg-white px-2 py-1.5 shadow-sm'
        )}
      >
        <Button
          size="sm"
          className={cn(
            isNav
              ? 'h-10 rounded-md bg-amber-500 px-3 text-sm font-bold text-white shadow-sm hover:bg-amber-400'
              : 'h-8 bg-slate-950 px-3 text-sm font-semibold hover:bg-slate-800'
          )}
          onClick={() => {
            setPanelOpen(true)
            setTarget(null)
            setLookup(null)
            setError(null)
          }}
          aria-label="Open time clock"
          title="Time Clock"
        >
          <Clock3 className={cn('h-4 w-4', !isNav && 'mr-2', isNav && 'mr-1.5')} />
          {(isNav || !isNav) && 'Time Clock'}
        </Button>
        <div className={cn('flex items-center gap-1.5 pr-0.5', isNav && 'hidden')}>
          {openClockCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              {openClockCount} clocked in
            </span>
          )}
          {activeBreakCount > 0 && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              {activeBreakCount} on break
            </span>
          )}
        </div>
        {isNav && (openClockCount > 0 || activeBreakCount > 0) && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
            {activeBreakCount > 0 ? activeBreakCount : openClockCount}
          </span>
        )}
      </div>

      <Dialog
        open={panelOpen}
        onOpenChange={open => {
          if (!open) {
            resetPanel()
          } else {
            setPanelOpen(true)
          }
        }}
      >
        <DialogContent className="left-0 top-0 h-dvh max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none bg-slate-950 p-0 text-slate-950 sm:max-w-none">
          <DialogTitle className="sr-only">Time Clock</DialogTitle>
          {!lookup ? (
            <div className="flex h-full flex-col bg-slate-950 text-white">
              <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
                <div className="flex items-center gap-2 font-semibold">
                  <Clock3 className="h-5 w-5 text-amber-400" />
                  Time Clock
                </div>
                <Button variant="ghost" className="text-white hover:bg-white/10" onClick={resetPanel}>
                  Cancel
                </Button>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center p-4">
                <div className="w-full max-w-sm">
                  <div className="mb-6 text-center">
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">Staff PIN</p>
                    <p className="mt-2 text-3xl font-bold">Enter 4 digits</p>
                  </div>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoFocus
                    maxLength={4}
                    value={pin}
                    onChange={event => clearLookup(event.target.value.replace(/\D/g, '').slice(0, 4))}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void lookupClockStatus()
                      }
                    }}
                    className="mb-5 h-16 w-full rounded-lg border border-white/20 bg-white px-4 text-center font-mono text-3xl tracking-[0.55em] text-slate-950 shadow-sm"
                    placeholder="••••"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(value => (
                      <Button
                        key={value}
                        className="h-14 bg-white text-2xl font-bold text-slate-950 hover:bg-amber-100"
                        onClick={() => clearLookup(`${pin}${value}`.replace(/\D/g, '').slice(0, 4))}
                      >
                        {value}
                      </Button>
                    ))}
                    <Button variant="outline" className="h-14 border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={() => clearLookup(pin.slice(0, -1))}>
                      Delete
                    </Button>
                    <Button className="h-14 bg-white text-2xl font-bold text-slate-950 hover:bg-amber-100" onClick={() => clearLookup(`${pin}0`.slice(0, 4))}>
                      0
                    </Button>
                    <Button
                      className="h-14 bg-amber-500 font-bold text-white hover:bg-amber-400"
                      onClick={() => void lookupClockStatus()}
                      disabled={lookupLoading || pin.length !== 4}
                    >
                      {lookupLoading ? 'Checking' : 'Next'}
                    </Button>
                  </div>
                  {error && (
                    <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {error}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col bg-slate-100">
              <div className="flex h-14 items-center justify-between border-b bg-slate-950 px-4 text-white">
                <div>
                  <div className="text-sm font-semibold text-amber-300">Announcement</div>
                  <div className="max-w-[56vw] truncate text-sm text-slate-100">No announcement posted.</div>
                </div>
                <Button variant="ghost" className="text-white hover:bg-white/10" onClick={resetPanel}>
                  Cancel
                </Button>
              </div>
              <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[1fr_1fr_340px]">
                <div className="flex min-h-[240px] flex-col overflow-hidden rounded-lg border bg-slate-900 shadow-sm">
                  <div className="flex min-h-0 flex-1 items-center justify-center">
                    <video
                      ref={videoRef}
                      muted
                      playsInline
                      autoPlay
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="flex items-center justify-center gap-1.5 border-t border-slate-700 bg-slate-950 px-2.5 py-2 text-center text-xs text-slate-200">
                    <Camera className="h-3.5 w-3.5" />
                    {cameraReady ? 'Front camera ready' : 'Starting camera...'}
                  </div>
                </div>

                <div className="flex min-h-0 flex-col justify-center gap-3">
                  <Button
                    className="h-16 bg-emerald-600 text-lg font-bold hover:bg-emerald-700"
                    onClick={() => void handleSubmit('clock_in')}
                    disabled={submitting || !cameraReady || !lookup.status.can_clock_in}
                  >
                    <LogIn className="mr-2 h-5 w-5" />
                    {submitting && target === 'clock_in' ? 'Saving...' : CLOCK_IN_TITLE}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-16 border-slate-300 bg-white text-lg font-bold"
                    onClick={() => void handleSubmit('clock_out')}
                    disabled={submitting || !cameraReady || !lookup.status.can_clock_out}
                  >
                    <LogOut className="mr-2 h-5 w-5" />
                    {submitting && target === 'clock_out' ? 'Saving...' : CLOCK_OUT_TITLE}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-16 border-blue-200 bg-blue-50 text-lg font-bold text-blue-800 hover:bg-blue-100"
                    onClick={() => void handleSubmit('toggle_break', true)}
                    disabled={submitting || (!lookup.status.can_start_break && !lookup.status.can_end_break)}
                  >
                    <Utensils className="mr-2 h-5 w-5" />
                    {submitting && target === 'toggle_break' ? 'Saving...' : mealBreakActionLabel}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-16 border-amber-200 bg-amber-50 text-lg font-bold text-amber-900 hover:bg-amber-100"
                    onClick={() => void handleSubmit('toggle_unpaid_break', true)}
                    disabled={submitting || (!lookup.status.can_start_unpaid_break && !lookup.status.can_end_unpaid_break)}
                  >
                    <Coffee className="mr-2 h-5 w-5" />
                    {submitting && target === 'toggle_unpaid_break' ? 'Saving...' : unpaidBreakActionLabel}
                  </Button>
                  <Button variant="ghost" className="h-11 text-slate-600" onClick={() => { setLookup(null); setError(null); setPin('') }}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to PIN
                  </Button>
                </div>

                <div className="min-h-0 overflow-auto rounded-lg border bg-white p-4 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Current Status</div>
                  <div className="mt-2 text-2xl font-bold text-slate-950">{lookup.employee.name}</div>
                  <div className="mt-1 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{statusLabel}</div>
                  <div className="mt-4 grid gap-2 text-sm">
                    <div className="rounded-md border bg-slate-50 px-3 py-2">
                      <div className="text-xs uppercase text-slate-400">Clock In</div>
                      <div className="font-semibold">{formatStatusDateTime(lookup.status.clock_in_at)}</div>
                    </div>
                    <div className="rounded-md border bg-slate-50 px-3 py-2">
                      <div className="text-xs uppercase text-slate-400">Meal Break</div>
                      <div className="font-semibold">{formatStatusTime(lookup.status.break_started_at)} - {formatStatusTime(lookup.status.break_ended_at)}</div>
                      <div className="text-xs text-slate-500">{lookup.status.break_minutes ? `${lookup.status.break_minutes} min` : 'No meal break recorded'}</div>
                    </div>
                    <div className="rounded-md border bg-slate-50 px-3 py-2">
                      <div className="text-xs uppercase text-slate-400">Break</div>
                      <div className="font-semibold">{formatStatusTime(lookup.status.unpaid_break_started_at)} - {formatStatusTime(lookup.status.unpaid_break_ended_at)}</div>
                      <div className="text-xs text-slate-500">{lookup.status.unpaid_break_minutes ? `${lookup.status.unpaid_break_minutes} min` : 'No regular break recorded'}</div>
                    </div>
                    <div className="rounded-md border bg-slate-50 px-3 py-2">
                      <div className="text-xs uppercase text-slate-400">Today</div>
                      <div className="font-semibold">First shift {firstShift ? formatTime(firstShift.schedule.start_time) : '-'}</div>
                      <div className="text-xs text-slate-500">Final shift {lastShift ? formatTime(lastShift.schedule.end_time) : '-'}</div>
                    </div>
                  </div>
                  {error && (
                    <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {error}
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    className="mt-3 w-full text-slate-600"
                    onClick={() => void handleSubmit('clock_in', true)}
                    disabled={submitting}
                  >
                    {submitting && target === 'clock_in' ? 'Saving...' : 'Manager Clock In Without Photo'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
