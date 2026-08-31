'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Employee, ShiftClock, Schedule } from '@/lib/types'
import { formatTime, getBusinessDateTime } from '@/lib/dateUtils'
import { isClockOnMealBreak, isClockOnUnpaidBreak } from '@/lib/clockUtils'
import { getEmployeeScheduleDepartments, normalizeScheduleDepartment } from '@/lib/employeeSelect'
import { cn } from '@/lib/utils'
import { ArrowLeft, Bell, Camera, CheckCircle2, Clock3, Coffee, LogIn, LogOut, Sparkles, Utensils } from 'lucide-react'

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
  work_department?: string | null
}
type EmployeeClockLookup = {
  employee: Pick<Employee, 'id' | 'name' | 'role' | 'primary_department' | 'schedule_departments'>
  status: ClockStatus
}
type ClockInStep = 'actions' | 'choose_department' | 'confirmed'
type ClockInConfirmation = {
  employeeName: string
  workDepartment: string
  clockInAt: string
}
const getAnnouncementLines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean)

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

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values
    .map(value => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean)))
}

function getScheduledDepartments(employeeId: string, schedules: Schedule[]) {
  return uniqueStrings(
    schedules
      .filter(schedule => schedule.employee_id === employeeId)
      .sort((left, right) => left.start_time.localeCompare(right.start_time))
      .map(schedule => typeof schedule.department === 'string' ? normalizeScheduleDepartment(schedule.department) : schedule.department)
  )
}

function getWorkDepartmentOptions(
  employee: EmployeeClockLookup['employee'],
  schedules: Schedule[]
) {
  return uniqueStrings([
    ...getScheduledDepartments(employee.id, schedules),
    ...getEmployeeScheduleDepartments(employee),
    typeof employee.primary_department === 'string' ? normalizeScheduleDepartment(employee.primary_department) : employee.primary_department,
  ])
}

export function ClockToolbar({ schedules, clockRecords, today, onRefresh, variant = 'panel' }: Props) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [target, setTarget] = useState<ClockAction | 'toggle_unpaid_break' | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lookup, setLookup] = useState<EmployeeClockLookup | null>(null)
  const [selectedWorkDepartment, setSelectedWorkDepartment] = useState('')
  const [clockInStep, setClockInStep] = useState<ClockInStep>('actions')
  const [clockInSkipPhoto, setClockInSkipPhoto] = useState(false)
  const [clockInConfirmation, setClockInConfirmation] = useState<ClockInConfirmation | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [announcementText, setAnnouncementText] = useState('')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const announcementLines = getAnnouncementLines(announcementText)
  const hasAnnouncement = announcementText.trim().length > 0

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

  const openClockRecords = useMemo(
    () => clockRecords.filter(record => record.session_date === today && !record.clock_out_at),
    [clockRecords, today]
  )
  const openClockCount = openClockRecords.length
  const activeBreakCount = openClockRecords.filter(record => isClockOnMealBreak(record) || isClockOnUnpaidBreak(record)).length
  useEffect(() => {
    let mounted = true

    const loadAnnouncement = async () => {
      if (!panelOpen) return
      const res = await fetch('/api/announcements', { cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as { boardText?: string }
      if (!mounted) return
      setAnnouncementText(data.boardText ?? '')
    }

    void loadAnnouncement()
    window.addEventListener('app-settings-updated', loadAnnouncement)
    window.addEventListener('announcements-updated', loadAnnouncement)
    return () => {
      mounted = false
      window.removeEventListener('app-settings-updated', loadAnnouncement)
      window.removeEventListener('announcements-updated', loadAnnouncement)
    }
  }, [panelOpen])

  const resetPanel = () => {
    setPanelOpen(false)
    setTarget(null)
    setError(null)
    setLookup(null)
    setSelectedWorkDepartment('')
    setClockInStep('actions')
    setClockInSkipPhoto(false)
    setClockInConfirmation(null)
    setLookupLoading(false)
    setPin('')
  }

  const clearLookup = (nextPin: string) => {
    setPin(nextPin)
    setLookup(null)
    setSelectedWorkDepartment('')
    setClockInStep('actions')
    setClockInSkipPhoto(false)
    setClockInConfirmation(null)
    setError(null)
  }

  const handlePinInput = (nextPin: string) => {
    const sanitized = nextPin.replace(/\D/g, '').slice(0, 4)
    setPin(sanitized)
    setLookup(null)
    setSelectedWorkDepartment('')
    setClockInStep('actions')
    setClockInSkipPhoto(false)
    setClockInConfirmation(null)
    setError(null)
    if (sanitized.length === 4) {
      void lookupClockStatus(sanitized)
    }
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

  const lookupClockStatus = async (pinOverride = pin) => {
    setError(null)

    if (!/^\d{4}$/.test(pinOverride)) {
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
          pin: pinOverride,
          session_date: today,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string } & Partial<EmployeeClockLookup>
      if (!res.ok || !data.employee || !data.status) {
        throw new Error(data.error ?? 'Failed to load clock status')
      }
      setPin(pinOverride)
      const nextLookup = { employee: data.employee, status: data.status } as EmployeeClockLookup
      const departmentOptions = getWorkDepartmentOptions(nextLookup.employee, schedules)
      setSelectedWorkDepartment(nextLookup.status.work_department ?? departmentOptions[0] ?? '')
      setClockInStep('actions')
      setClockInSkipPhoto(false)
      setClockInConfirmation(null)
      setLookup(nextLookup)
      return nextLookup
    } catch (err) {
      setLookup(null)
      setSelectedWorkDepartment('')
      setError(err instanceof Error ? err.message : 'Failed to load clock status')
      return null
    } finally {
      setLookupLoading(false)
    }
  }

  const handleSubmit = async (
    nextTarget: ClockAction | 'toggle_unpaid_break',
    skipPhoto = false,
    workDepartmentOverride?: string
  ) => {
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

    const workDepartmentOptions = getWorkDepartmentOptions(currentLookup.employee, schedules)
    const hasMultipleWorkDepartments = workDepartmentOptions.length > 1
    if (nextTarget === 'clock_in' && hasMultipleWorkDepartments && !workDepartmentOverride) {
      setClockInSkipPhoto(skipPhoto)
      setClockInStep('choose_department')
      setSelectedWorkDepartment('')
      return
    }

    const resolvedWorkDepartment = workDepartmentOverride ||
      (!hasMultipleWorkDepartments ? selectedWorkDepartment || currentLookup.status.work_department || workDepartmentOptions[0] : '') ||
      ''
    if (nextTarget === 'clock_in' && workDepartmentOptions.length > 0 && !resolvedWorkDepartment) {
      setError('Choose what you are clocking in as.')
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
          work_department: nextTarget === 'clock_in' ? resolvedWorkDepartment : undefined,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        available_at?: string
        clock_in_at?: string
        work_department?: string | null
      }
      if (!res.ok) {
        if (data.available_at) {
          const available = new Date(data.available_at)
          throw new Error(`${data.error ?? 'Meal break is not complete yet'} You can clock back in at ${available.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`)
        }
        throw new Error(data.error ?? 'Failed to save clock event')
      }

      if (nextTarget === 'clock_in') {
        const clockInAt = data.clock_in_at ?? new Date().toISOString()
        const confirmedDepartment = data.work_department ?? resolvedWorkDepartment
        setSelectedWorkDepartment(confirmedDepartment)
        setClockInConfirmation({
          employeeName: currentLookup.employee.name,
          workDepartment: confirmedDepartment,
          clockInAt,
        })
        setClockInStep('confirmed')
        setClockInSkipPhoto(false)
        setLookup({
          employee: currentLookup.employee,
          status: {
            ...currentLookup.status,
            state: 'clocked_in',
            can_clock_in: false,
            can_clock_out: true,
            can_start_break: true,
            can_end_break: false,
            clock_in_at: clockInAt,
            work_department: confirmedDepartment,
          },
        })
        await onRefresh()
        return
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
  const workDepartmentOptions = lookup ? getWorkDepartmentOptions(lookup.employee, schedules) : []
  const displayedWorkDepartment = lookup?.status.work_department ?? selectedWorkDepartment

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
            setSelectedWorkDepartment('')
            setClockInStep('actions')
            setClockInConfirmation(null)
            setClockInSkipPhoto(false)
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
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
                <div className="w-full max-w-md">
                  <div className="mb-6 text-center">
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">Staff PIN</p>
                    <p className="mt-2 text-4xl font-bold">Enter 4 digits</p>
                  </div>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoFocus
                    maxLength={4}
                    value={pin}
                    onChange={event => handlePinInput(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void lookupClockStatus()
                      }
                    }}
                    className="mb-6 h-20 w-full rounded-lg border border-white/20 bg-white px-4 text-center font-mono text-4xl tracking-[0.6em] text-slate-950 shadow-sm"
                    placeholder="••••"
                  />
                  <div className="grid grid-cols-3 gap-3">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(value => (
                      <Button
                        key={value}
                        className="h-20 bg-white text-4xl font-bold text-slate-950 hover:bg-amber-100"
                        onClick={() => handlePinInput(`${pin}${value}`)}
                      >
                        {value}
                      </Button>
                    ))}
                    <Button variant="outline" className="h-20 border-white/20 bg-white/10 text-lg font-bold text-white hover:bg-white/20" onClick={() => clearLookup(pin.slice(0, -1))}>
                      Delete
                    </Button>
                    <Button className="h-20 bg-white text-4xl font-bold text-slate-950 hover:bg-amber-100" onClick={() => handlePinInput(`${pin}0`)}>
                      0
                    </Button>
                    <Button
                      variant="outline"
                      className="h-20 border-white/20 bg-white/10 text-lg font-bold text-white hover:bg-white/20"
                      onClick={() => clearLookup('')}
                      disabled={lookupLoading || pin.length === 0}
                    >
                      Clear
                    </Button>
                  </div>
                  {lookupLoading && <p className="mt-4 text-center text-sm font-semibold text-amber-300">Checking PIN...</p>}
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
                <div className="flex items-center gap-2 font-semibold">
                  <Clock3 className="h-5 w-5 text-amber-400" />
                  Time Clock
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
                  {clockInStep === 'choose_department' ? (
                    <div className="rounded-lg border bg-white p-5 shadow-sm">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Choose One</div>
                      <div className="mt-2 text-2xl font-bold text-slate-950">Clock in as</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {lookup.employee.name} can only clock in under one department for this shift.
                      </div>
                      <div className="mt-5 grid gap-3">
                        {workDepartmentOptions.map(department => (
                          <Button
                            key={department}
                            className="h-16 bg-emerald-600 text-lg font-bold capitalize hover:bg-emerald-700"
                            onClick={() => {
                              setSelectedWorkDepartment(department)
                              void handleSubmit('clock_in', clockInSkipPhoto, department)
                            }}
                            disabled={submitting || (!clockInSkipPhoto && !cameraReady)}
                          >
                            <LogIn className="mr-2 h-5 w-5" />
                            {submitting && target === 'clock_in' && selectedWorkDepartment === department
                              ? 'Saving...'
                              : `Clock In as ${department}`}
                          </Button>
                        ))}
                      </div>
                      <Button
                        variant="ghost"
                        className="mt-3 h-11 w-full text-slate-600"
                        onClick={() => {
                          setClockInStep('actions')
                          setClockInSkipPhoto(false)
                          setSelectedWorkDepartment(workDepartmentOptions[0] ?? '')
                          setError(null)
                        }}
                        disabled={submitting}
                      >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back
                      </Button>
                    </div>
                  ) : clockInStep === 'confirmed' && clockInConfirmation ? (
                    <div className="rounded-lg border border-emerald-200 bg-white p-5 text-center shadow-sm">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                        <CheckCircle2 className="h-8 w-8" />
                      </div>
                      <div className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Clocked In</div>
                      <div className="mt-2 text-3xl font-bold text-slate-950">{clockInConfirmation.employeeName}</div>
                      <div className="mt-5 grid gap-2 text-left text-sm">
                        <div className="rounded-md border bg-emerald-50 px-3 py-2">
                          <div className="text-xs uppercase text-emerald-700">Clocked In As</div>
                          <div className="font-semibold capitalize text-slate-950">{clockInConfirmation.workDepartment}</div>
                        </div>
                        <div className="rounded-md border bg-slate-50 px-3 py-2">
                          <div className="text-xs uppercase text-slate-400">Time Stamp</div>
                          <div className="font-semibold text-slate-950">{formatStatusDateTime(clockInConfirmation.clockInAt)}</div>
                        </div>
                      </div>
                      <Button className="mt-5 h-12 w-full bg-slate-950 font-bold hover:bg-slate-800" onClick={resetPanel}>
                        Done
                      </Button>
                      <Button
                        variant="ghost"
                        className="mt-2 h-11 w-full text-slate-600"
                        onClick={() => {
                          setLookup(null)
                          setSelectedWorkDepartment('')
                          setClockInStep('actions')
                          setClockInConfirmation(null)
                          setClockInSkipPhoto(false)
                          setError(null)
                          setPin('')
                        }}
                      >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to PIN
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div
                        className={cn(
                          'min-h-36 rounded-lg border-2 p-5 shadow-sm',
                          hasAnnouncement
                            ? 'border-amber-400 bg-amber-50 text-amber-950 shadow-amber-200'
                            : 'border-slate-200 bg-white text-slate-700',
                          hasAnnouncement && 'animate-pulse'
                        )}
                      >
                        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em]">
                          {hasAnnouncement ? <Sparkles className="h-4 w-4 text-amber-600" /> : <Bell className="h-4 w-4 text-slate-500" />}
                          Announcement
                        </div>
                        <div className="mt-3 max-h-48 overflow-y-auto pr-1 text-xl font-bold leading-snug">
                          {announcementLines.length > 0 ? (
                            <div className="space-y-2">
                              {announcementLines.map((line, index) => (
                                <div key={`${line}-${index}`} className="flex items-start gap-2">
                                  <span className="text-amber-600">-</span>
                                  <span>{line}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            'No announcement posted.'
                          )}
                        </div>
                      </div>
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
                      <Button variant="ghost" className="h-11 text-slate-600" onClick={() => { setLookup(null); setSelectedWorkDepartment(''); setClockInStep('actions'); setClockInConfirmation(null); setClockInSkipPhoto(false); setError(null); setPin('') }}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to PIN
                      </Button>
                    </>
                  )}
                </div>

                <div className="min-h-0 overflow-auto rounded-lg border bg-white p-4 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Current Status</div>
                  <div className="mt-2 text-2xl font-bold text-slate-950">{lookup.employee.name}</div>
                  <div className="mt-1 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{statusLabel}</div>
                  <div className="mt-4 grid gap-2 text-sm">
                    <div className="rounded-md border bg-slate-50 px-3 py-2">
                      <div className="text-xs uppercase text-slate-400">Worked Department</div>
                      <div className="font-semibold capitalize">{displayedWorkDepartment || '-'}</div>
                    </div>
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
                  {clockInStep === 'actions' && lookup.status.can_clock_in && lookup.employee.role === 'manager' && (
                    <Button
                      variant="ghost"
                      className="mt-3 w-full text-slate-600"
                      onClick={() => void handleSubmit('clock_in', true)}
                      disabled={submitting}
                    >
                      {submitting && target === 'clock_in' ? 'Saving...' : 'Manager Clock In Without Photo'}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
