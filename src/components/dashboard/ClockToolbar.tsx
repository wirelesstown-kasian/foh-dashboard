'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ShiftClock, Schedule } from '@/lib/types'
import { formatTime, getBusinessDateTime } from '@/lib/dateUtils'
import { isClockOnMealBreak } from '@/lib/clockUtils'
import { Camera, Clock3, Coffee, LogIn, LogOut } from 'lucide-react'

interface Props {
  schedules: Schedule[]
  clockRecords: ShiftClock[]
  today: string
  onRefresh: () => void
}

const CLOCK_IN_TITLE = 'Clock In'
const CLOCK_OUT_TITLE = 'Clock Out'
const MEAL_BREAK_TITLE = 'Break'
type ClockAction = 'clock_in' | 'clock_out' | 'toggle_break'

export function ClockToolbar({ schedules, clockRecords, today, onRefresh }: Props) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [target, setTarget] = useState<ClockAction | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
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
    setPin('')
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

    if (!panelOpen) {
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
  }, [panelOpen])

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

  const handleSubmit = async (nextTarget: ClockAction, skipPhoto = false) => {
    setTarget(nextTarget)
    setError(null)

    if (!/^\d{4}$/.test(pin)) {
      setError('Enter a valid 4-digit PIN')
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

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white px-2.5 py-2 shadow-sm">
        <Button
          size="sm"
          className="h-9 bg-slate-950 px-4 text-sm font-semibold hover:bg-slate-800"
          onClick={() => {
            setPanelOpen(true)
            setTarget(null)
            setError(null)
          }}
        >
          <Clock3 className="mr-2 h-4 w-4" />
          Time Clock
        </Button>
        <div className="flex items-center gap-2 pr-1">
          {openClockCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
              {openClockCount} clocked in
            </span>
          )}
          {activeBreakCount > 0 && (
            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">
              {activeBreakCount} on break
            </span>
          )}
        </div>
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Time Clock</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="mx-auto w-[180px] overflow-hidden rounded-2xl border border-slate-300 bg-slate-900 shadow-sm">
              <div className="flex h-[220px] items-center justify-center">
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  autoPlay
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex items-center justify-center gap-1.5 border-t border-slate-700 bg-slate-950 px-3 py-2 text-center text-xs text-slate-200">
                <Camera className="h-3.5 w-3.5" />
                {cameraReady ? 'Front camera ready' : 'Starting camera...'}
              </div>
            </div>
            <div className="space-y-3">
              <div className="rounded-xl border bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <div>First shift starts at {firstShift ? formatTime(firstShift.schedule.start_time) : '-'}</div>
                <div>Final shift ends at {lastShift ? formatTime(lastShift.schedule.end_time) : '-'}</div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={pin}
                  onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                  className="w-full rounded-md border border-input px-3 py-2 text-center font-mono tracking-[0.35em]"
                  placeholder="****"
                />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                className="h-11 bg-emerald-600 font-semibold hover:bg-emerald-700"
                onClick={() => void handleSubmit('clock_in')}
                disabled={submitting || !cameraReady}
              >
                <LogIn className="mr-2 h-4 w-4" />
                {submitting && target === 'clock_in' ? 'Saving...' : CLOCK_IN_TITLE}
              </Button>
              <Button
                variant="outline"
                className="h-11 font-semibold"
                onClick={() => void handleSubmit('clock_out')}
                disabled={submitting || !cameraReady}
              >
                <LogOut className="mr-2 h-4 w-4" />
                {submitting && target === 'clock_out' ? 'Saving...' : CLOCK_OUT_TITLE}
              </Button>
            </div>
            <Button
              variant="outline"
              className="h-11 w-full font-semibold"
              onClick={() => void handleSubmit('toggle_break', true)}
              disabled={submitting}
            >
              <Coffee className="mr-2 h-4 w-4" />
              {submitting && target === 'toggle_break' ? 'Saving...' : MEAL_BREAK_TITLE}
            </Button>
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <Button
              variant="ghost"
              className="w-full text-slate-600"
              onClick={() => void handleSubmit('clock_in', true)}
              disabled={submitting}
            >
              {submitting && target === 'clock_in' ? 'Saving...' : 'Manager Clock In Without Photo'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
