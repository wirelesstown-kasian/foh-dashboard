'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Task, TaskCategory, TaskCompletion, DailySession, Employee, Schedule, SessionPhase } from '@/lib/types'
import { PinModal } from '@/components/layout/PinModal'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CheckCircle2, Circle, ChevronRight, ArrowRight, RotateCcw, ChevronLeft } from 'lucide-react'
import { formatTime, getBusinessDate, getBusinessDateTime } from '@/lib/dateUtils'
import { useRouter } from 'next/navigation'

interface Props {
  categories: TaskCategory[]
  tasks: Task[]
  schedules: Schedule[]
  completions: TaskCompletion[]
  session: DailySession | null
  employees: Employee[]
  today: string
  now: Date
  onRefresh: () => void
}

const PHASE_ORDER: SessionPhase[] = ['pre_shift', 'operation', 'closing']
const PHASE_LABELS: Record<SessionPhase, string> = {
  pre_shift: 'Pre-Shift',
  operation: 'Operations',
  closing: 'Closing',
  complete: 'Complete',
}

const CLOCK_IN_TITLE = 'Clock In'
const CLOCK_OUT_TITLE = 'Clock Out'
const REMINDER_WINDOW_MINUTES = 30

export function TaskFlow({ categories, tasks, schedules, completions, session, employees, today, now, onRefresh }: Props) {
  const router = useRouter()
  const [taskActionTarget, setTaskActionTarget] = useState<Task | null>(null)
  const [pinTarget, setPinTarget] = useState<Task | null>(null)
  const [undoTarget, setUndoTarget] = useState<{ task: Task; completionId: string } | null>(null)
  const [transferTarget, setTransferTarget] = useState<{ task: Task; completionId: string } | null>(null)
  const [pinError, setPinError] = useState<string | null>(null)
  const [undoPinError, setUndoPinError] = useState<string | null>(null)
  const [transferPinError, setTransferPinError] = useState<string | null>(null)
  const [advancing, setAdvancing] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  const [showResetPin, setShowResetPin] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [showPhaseResetPin, setShowPhaseResetPin] = useState(false)
  const [phaseResetError, setPhaseResetError] = useState<string | null>(null)

  const todayDow = getBusinessDate().getDay() // 0=Sun, 1=Mon, ...
  const currentPhase: SessionPhase = session?.current_phase ?? 'pre_shift'

  const phaseCategory = (phase: SessionPhase) => {
    const typeMap: Record<SessionPhase, string> = {
      pre_shift: 'pre_shift',
      operation: 'operation',
      closing: 'closing',
      complete: 'closing',
    }
    return categories.find(c => c.type === typeMap[phase])
  }

  const filterByDay = (t: Task) =>
    t.days_of_week === null || t.days_of_week === undefined || t.days_of_week.includes(todayDow)

  const currentCategory = phaseCategory(currentPhase)
  const currentTasks = currentCategory
    ? tasks
        .filter(t => t.category_id === currentCategory.id && t.is_active && filterByDay(t))
        .sort((a, b) => a.display_order - b.display_order)
    : []

  const isCompleted = (taskId: string) =>
    completions.some(c => c.task_id === taskId && c.session_date === today)

  const allCurrentDone = currentTasks.length === 0 || currentTasks.every(t => isCompleted(t.id))
  const clockInTask = tasks.find(task => task.title.trim().toLowerCase() === CLOCK_IN_TITLE.toLowerCase())
  const clockOutTask = tasks.find(task => task.title.trim().toLowerCase() === CLOCK_OUT_TITLE.toLowerCase())

  const shiftStarts = schedules
    .map(schedule => ({ schedule, at: getBusinessDateTime(today, schedule.start_time) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
  const shiftEnds = schedules
    .map(schedule => ({ schedule, at: getBusinessDateTime(today, schedule.end_time) }))
    .sort((a, b) => b.at.getTime() - a.at.getTime())

  const firstShift = shiftStarts[0] ?? null
  const lastShift = shiftEnds[0] ?? null

  const getTaskHelperText = (task: Task) => {
    if (task.title.trim().toLowerCase() === CLOCK_IN_TITLE.toLowerCase() && firstShift) {
      return `First shift starts at ${formatTime(firstShift.schedule.start_time)}`
    }
    if (task.title.trim().toLowerCase() === CLOCK_OUT_TITLE.toLowerCase() && lastShift) {
      return `Last shift ends at ${formatTime(lastShift.schedule.end_time)}`
    }
    return task.deadline_time ? `by ${formatTime(task.deadline_time)}` : null
  }

  useEffect(() => {
    const reminderCandidates = [
      {
        phase: 'pre_shift' as SessionPhase,
        task: clockInTask,
        eventTime: firstShift?.at ?? null,
        eventLabel: firstShift ? `First shift at ${formatTime(firstShift.schedule.start_time)}` : null,
        storageKey: `clock-reminder:${today}:clock-in`,
      },
      {
        phase: 'closing' as SessionPhase,
        task: clockOutTask,
        eventTime: lastShift?.at ?? null,
        eventLabel: lastShift ? `Final clock-out at ${formatTime(lastShift.schedule.end_time)}` : null,
        storageKey: `clock-reminder:${today}:clock-out`,
      },
    ]

    const completedTaskIds = new Set(completions.map(completion => completion.task_id))
    const activeReminder = reminderCandidates.find(candidate => {
      if (candidate.phase !== currentPhase || !candidate.task || !candidate.eventTime || !candidate.eventLabel) {
        return false
      }
      if (completedTaskIds.has(candidate.task.id)) {
        return false
      }

      const minutesUntil = Math.round((candidate.eventTime.getTime() - now.getTime()) / 60000)
      return minutesUntil >= 0 && minutesUntil <= REMINDER_WINDOW_MINUTES
    })

    if (!activeReminder || typeof window === 'undefined') return
    if (window.localStorage.getItem(activeReminder.storageKey) === 'seen') return

    const reminderTask = activeReminder.task
    if (!reminderTask) return

    window.localStorage.setItem(activeReminder.storageKey, 'seen')
    window.alert(`${reminderTask.title} Reminder\n\n${activeReminder.eventLabel}. Please complete this task before the scheduled time.`)
  }, [clockInTask, clockOutTask, completions, currentPhase, firstShift, lastShift, now, today])

  const handlePinConfirm = async (pin: string) => {
    if (!pinTarget) return
    setPinError(null)

    const res = await fetch('/api/task-completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin,
        task_id: pinTarget.id,
        session_date: today,
      }),
    })

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setPinError(data.error ?? 'Incorrect PIN')
      throw new Error(data.error ?? 'Incorrect PIN')
    }

    setPinTarget(null)
    onRefresh()
  }

  const handleUndoPinConfirm = async (pin: string) => {
    if (!undoTarget) return
    setUndoPinError(null)

    const res = await fetch('/api/task-completions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin,
        completion_id: undoTarget.completionId,
      }),
    })

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setUndoPinError(data.error ?? 'Incorrect PIN')
      throw new Error(data.error ?? 'Incorrect PIN')
    }

    setUndoTarget(null)
    onRefresh()
  }

  const handleTransferPinConfirm = async (pin: string) => {
    if (!transferTarget) return
    setTransferPinError(null)

    const res = await fetch('/api/task-completions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin,
        completion_id: transferTarget.completionId,
      }),
    })

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setTransferPinError(data.error ?? 'Incorrect PIN')
      throw new Error(data.error ?? 'Incorrect PIN')
    }

    setTransferTarget(null)
    onRefresh()
  }

  const advancePhase = async () => {
    if (!allCurrentDone) return
    setAdvancing(true)

    const phaseIdx = PHASE_ORDER.indexOf(currentPhase as SessionPhase)
    const nextPhase = phaseIdx < PHASE_ORDER.length - 1 ? PHASE_ORDER[phaseIdx + 1] : 'complete'

    if (session) {
      await supabase.from('daily_sessions').update({ current_phase: nextPhase }).eq('id', session.id)
    } else {
      await supabase.from('daily_sessions').insert({ session_date: today, current_phase: nextPhase })
    }

    if (nextPhase === 'complete') {
      setShowSummary(true)
    }
    setAdvancing(false)
    onRefresh()
  }

  const handleBack = async () => {
    if (!session) return
    await supabase.from('daily_sessions').update({ current_phase: 'closing' }).eq('id', session.id)
    setShowSummary(false)
    onRefresh()
  }

  const handlePhaseBack = async () => {
    if (!session) return
    const phaseIdx = PHASE_ORDER.indexOf(currentPhase as SessionPhase)
    if (phaseIdx <= 0) return
    const prevPhase = PHASE_ORDER[phaseIdx - 1]
    await supabase.from('daily_sessions').update({ current_phase: prevPhase }).eq('id', session.id)
    onRefresh()
  }

  const handlePhaseResetConfirm = async (pin: string) => {
    setPhaseResetError(null)
    const res = await fetch('/api/manager-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    })

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setPhaseResetError(data.error ?? 'Manager PIN required')
      throw new Error(data.error ?? 'Manager PIN required')
    }

    if (currentCategory) {
      const taskIds = tasks.filter(t => t.category_id === currentCategory.id).map(t => t.id)
      if (taskIds.length > 0) {
        await supabase.from('task_completions').delete().eq('session_date', today).in('task_id', taskIds)
      }
    }
    setShowPhaseResetPin(false)
    onRefresh()
  }

  const handleResetConfirm = async (pin: string) => {
    setResetError(null)
    const res = await fetch('/api/manager-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    })

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      setResetError(data.error ?? 'Manager PIN required')
      throw new Error(data.error ?? 'Manager PIN required')
    }

    await supabase.from('task_completions').delete().eq('session_date', today)
    if (session) {
      await supabase.from('daily_sessions').update({ current_phase: 'pre_shift' }).eq('id', session.id)
    }
    setShowResetPin(false)
    setShowSummary(false)
    onRefresh()
  }

  const completedCount = completions.filter(c => c.session_date === today).length

  if (currentPhase === 'complete' || showSummary) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <CheckCircle2 className="w-16 h-16 text-green-500 mb-4" />
        <h2 className="text-2xl font-bold mb-2">All Tasks Complete!</h2>
        <p className="text-muted-foreground mb-6">{completedCount} tasks completed today</p>

        <div className="bg-white rounded-xl border p-6 w-full max-w-lg text-left mb-6">
          <h3 className="font-semibold mb-3">Today&apos;s Task Summary</h3>
          {PHASE_ORDER.map(phase => {
            const cat = phaseCategory(phase)
            const phaseTasks = cat
              ? tasks.filter(t => t.category_id === cat.id && t.is_active && filterByDay(t))
              : []
            return (
              <div key={phase} className="mb-3">
                <p className="text-sm font-medium text-muted-foreground mb-1">{PHASE_LABELS[phase]}</p>
                {phaseTasks.map(task => {
                  const done = isCompleted(task.id)
                  const comp = completions.find(c => c.task_id === task.id && c.session_date === today)
                  const emp = comp ? employees.find(e => e.id === comp.employee_id) : null
                  return (
                    <div key={task.id} className="flex items-center gap-2 text-sm py-0.5">
                      {done
                        ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                        : <Circle className="w-4 h-4 text-gray-300 shrink-0" />
                      }
                      <span className={done ? '' : 'text-muted-foreground'}>{task.title}</span>
                      {emp && <span className="text-xs text-muted-foreground ml-auto">by {emp.name}</span>}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        <div className="flex gap-3">
          <Button variant="outline" size="lg" onClick={handleBack}>
            ← Back
          </Button>
          <Button size="lg" onClick={() => router.push('/eod')}>
            Confirm & Move to EOD <ArrowRight className="ml-2 w-4 h-4" />
          </Button>
          <Button variant="destructive" size="lg" onClick={() => setShowResetPin(true)}>
            Reset Day
          </Button>
        </div>

        <PinModal
          open={showResetPin}
          title="Reset Day"
          description="Enter a manager PIN to reset all tasks"
          onConfirm={handleResetConfirm}
          onClose={() => { setShowResetPin(false); setResetError(null) }}
          error={resetError}
        />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col p-4">
      {/* Phase stepper */}
      <div className="flex items-center gap-2 mb-4">
        {PHASE_ORDER.map((phase, idx) => {
          const phaseIdx = PHASE_ORDER.indexOf(currentPhase as SessionPhase)
          const isActive = phase === currentPhase
          const isDone = idx < phaseIdx
          return (
            <div key={phase} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isActive ? 'bg-amber-500 text-white' : isDone ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
              }`}>
                {isDone && <CheckCircle2 className="w-4 h-4" />}
                {PHASE_LABELS[phase]}
              </div>
              {idx < PHASE_ORDER.length - 1 && <ChevronRight className="w-4 h-4 text-gray-300" />}
            </div>
          )
        })}
      </div>

      {/* Task list */}
      <div className="flex-1 bg-white rounded-xl border overflow-hidden">
        <div className="p-3 border-b bg-gray-50 flex items-center justify-between gap-2">
          <h2 className="font-semibold">{currentCategory?.name ?? PHASE_LABELS[currentPhase]}</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {currentTasks.filter(t => isCompleted(t.id)).length} / {currentTasks.length} done
            </span>
            {currentPhase !== 'pre_shift' && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-red-400 hover:text-red-600" onClick={() => setShowPhaseResetPin(true)}>
                <RotateCcw className="w-3 h-3 mr-1" /> Reset
              </Button>
            )}
          </div>
        </div>
        <div className="overflow-y-auto p-3" style={{ maxHeight: 'calc(100vh - 340px)' }}>
          {currentTasks.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">
              No tasks in this phase. Add tasks in Task Admin.
            </p>
          )}
          <div className="grid grid-cols-6 gap-3">
            {currentTasks.map(task => {
              const done = isCompleted(task.id)
              const comp = completions.find(c => c.task_id === task.id && c.session_date === today)
              const emp = comp ? employees.find(e => e.id === comp.employee_id) : null
              return (
                <button
                  key={task.id}
                  className={`aspect-square rounded-2xl border-2 p-3 text-center transition-all ${
                    done
                      ? 'bg-green-50 border-green-400 hover:bg-green-100'
                      : 'bg-white border-gray-200 hover:border-amber-400 hover:shadow-sm'
                  }`}
                  onClick={() => setTaskActionTarget(task)}
                >
                  <div className="flex h-full flex-col items-center justify-between">
                    <div className="flex w-full justify-center">
                      {done
                        ? <CheckCircle2 className="w-6 h-6 text-green-500 shrink-0" />
                        : <Circle className="w-6 h-6 text-gray-300 shrink-0" />
                      }
                    </div>
                    <div className="flex-1 flex flex-col items-center justify-center px-1">
                      <p className={`line-clamp-3 text-sm font-semibold leading-tight ${done ? 'text-green-800' : 'text-slate-900'}`}>
                        {task.title}
                      </p>
                    </div>
                    <div className="min-h-10 flex flex-col items-center justify-end">
                      {done && emp ? (
                        <span className="rounded-full bg-green-200 px-2 py-1 text-[11px] font-semibold text-green-700">
                          {emp.name}
                        </span>
                      ) : getTaskHelperText(task) ? (
                        <p className="text-[11px] text-muted-foreground leading-tight">
                          {getTaskHelperText(task)}
                        </p>
                      ) : (
                        <span />
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div>
          {currentPhase !== 'pre_shift' && (
            <Button variant="outline" onClick={handlePhaseBack}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          )}
        </div>
        {allCurrentDone && (
          <Button size="lg" onClick={advancePhase} disabled={advancing}>
            {currentPhase === 'closing' ? 'Save & Review' : 'Next Phase'}
            <ChevronRight className="ml-2 w-4 h-4" />
          </Button>
        )}
      </div>

      <PinModal
        open={!!pinTarget}
        title="Complete Task"
        description={pinTarget?.title}
        onConfirm={handlePinConfirm}
        onClose={() => { setPinTarget(null); setPinError(null) }}
        error={pinError}
      />

      <PinModal
        open={showPhaseResetPin}
        title="Reset Phase"
        description={`Clear all completed tasks in ${PHASE_LABELS[currentPhase]}? Manager PIN required.`}
        onConfirm={handlePhaseResetConfirm}
        onClose={() => { setShowPhaseResetPin(false); setPhaseResetError(null) }}
        error={phaseResetError}
      />

      <PinModal
        open={!!undoTarget}
        title="Mark Incomplete"
        description={undoTarget?.task.title}
        onConfirm={handleUndoPinConfirm}
        onClose={() => { setUndoTarget(null); setUndoPinError(null) }}
        error={undoPinError}
      />

      <PinModal
        open={!!transferTarget}
        title="Transfer Task"
        description={transferTarget?.task.title}
        onConfirm={handleTransferPinConfirm}
        onClose={() => { setTransferTarget(null); setTransferPinError(null) }}
        error={transferPinError}
      />

      <Dialog open={!!taskActionTarget} onOpenChange={open => !open && setTaskActionTarget(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>{taskActionTarget?.title}</DialogTitle>
          </DialogHeader>
          {taskActionTarget && (() => {
            const completion = completions.find(c => c.task_id === taskActionTarget.id && c.session_date === today)
            const assignedEmployee = completion ? employees.find(e => e.id === completion.employee_id) : null

            return completion ? (
              <div className="space-y-3">
                <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">
                  <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Assigned To</div>
                  <div className="mt-1 font-semibold">{assignedEmployee?.name ?? 'Unknown Staff'}</div>
                </div>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    setTaskActionTarget(null)
                    setTransferTarget({ task: taskActionTarget, completionId: completion.id })
                  }}
                >
                  Transfer
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    setTaskActionTarget(null)
                    setUndoTarget({ task: taskActionTarget, completionId: completion.id })
                  }}
                >
                  Mark Incomplete
                </Button>
                <Button variant="ghost" className="w-full" onClick={() => setTaskActionTarget(null)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Button
                  className="w-full justify-start"
                  onClick={() => {
                    setTaskActionTarget(null)
                    setPinTarget(taskActionTarget)
                  }}
                >
                  Complete
                </Button>
                <Button variant="ghost" className="w-full" onClick={() => setTaskActionTarget(null)}>
                  Cancel
                </Button>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}
