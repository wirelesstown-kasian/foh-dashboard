'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ShiftClock, Schedule } from '@/lib/types'
import { formatTime, getBusinessDateTime } from '@/lib/dateUtils'

interface Props {
  schedules: Schedule[]
  clockRecords: ShiftClock[]
  today: string
  onRefresh: () => void
}

const CLOCK_IN_TITLE = 'Clock In'
const CLOCK_OUT_TITLE = 'Clock Out'

export function ClockToolbar({ schedules, clockRecords, today, onRefresh }: Props) {
  const [target, setTarget] = useState<'clock_in' | 'clock_out' | null>(null)
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

    if (!target) {
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
  }, [target])

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

  const handleSubmit = async (skipPhoto = false) => {
    if (!target) return
    setError(null)

    if (!/^\d{4}$/.test(pin)) {
      setError('Enter a valid 4-digit PIN')
      return
    }

    const photo = skipPhoto ? null : captureFrame()
    if (!skipPhoto && !photo) {
      setError('Camera preview is not ready yet')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/clock-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: target,
          pin,
          session_date: today,
          photo_data_url: photo,
          skip_photo: skipPhoto,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to save clock event')

      setTarget(null)
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
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-9 bg-emerald-600 px-4 text-sm font-semibold hover:bg-emerald-700"
          onClick={() => {
            setTarget('clock_in')
            setError(null)
            setPin('')
          }}
        >
          {CLOCK_IN_TITLE}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-9 px-4 text-sm font-semibold"
          onClick={() => {
            setTarget('clock_out')
            setError(null)
            setPin('')
          }}
        >
          {CLOCK_OUT_TITLE}
        </Button>
        {openClockCount > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
            {openClockCount} clocked in
          </span>
        )}
      </div>

      <Dialog
        open={!!target}
        onOpenChange={open => {
          if (!open) {
            setTarget(null)
            setError(null)
            setPin('')
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{target === 'clock_out' ? 'Clock Out With Photo' : 'Clock In With Photo'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {target === 'clock_in'
                ? `First shift starts at ${firstShift ? formatTime(firstShift.schedule.start_time) : '—'}`
                : `Final shift ends at ${lastShift ? formatTime(lastShift.schedule.end_time) : '—'}`}
            </div>
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
              <div className="border-t border-slate-700 bg-slate-950 px-3 py-2 text-center text-xs text-slate-200">
                {cameraReady ? 'Front camera ready' : 'Starting camera…'}
              </div>
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
                placeholder="••••"
              />
            </div>
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <Button className="w-full" onClick={() => void handleSubmit(false)} disabled={submitting || !cameraReady}>
              {submitting ? 'Saving…' : target === 'clock_out' ? CLOCK_OUT_TITLE : CLOCK_IN_TITLE}
            </Button>
            {target === 'clock_in' && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => void handleSubmit(true)}
                disabled={submitting}
              >
                {submitting ? 'Saving…' : 'Manager Clock In Without Photo'}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
