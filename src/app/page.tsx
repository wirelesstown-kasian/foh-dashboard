'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Employee, Schedule, TaskCategory, Task, TaskCompletion, DailySession, ShiftClock } from '@/lib/types'
import { getBusinessDate, getBusinessDateString } from '@/lib/dateUtils'
import { StaffSidebar } from '@/components/dashboard/StaffSidebar'
import { TaskFlow } from '@/components/dashboard/TaskFlow'
import { ClockToolbar } from '@/components/dashboard/ClockToolbar'
import { PerformanceBar } from '@/components/dashboard/PerformanceBar'
import { TaskRoadmap } from '@/components/dashboard/TaskRoadmap'
import { Textarea } from '@/components/ui/textarea'
import { format } from 'date-fns'

const isSystemClockTask = (task: Task) => {
  const title = task.title.trim().toLowerCase()
  return title === 'clock in' || title === 'clock out'
}

export default function DashboardPage() {
  const [now, setNow] = useState(() => new Date())
  const businessDate = getBusinessDate(now)
  const today = getBusinessDateString(now)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [categories, setCategories] = useState<TaskCategory[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [completions, setCompletions] = useState<TaskCompletion[]>([])
  const [session, setSession] = useState<DailySession | null>(null)
  const [clockRecords, setClockRecords] = useState<ShiftClock[]>([])
  const [notes, setNotes] = useState('')
  const [notesSaved, setNotesSaved] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const isResolvedCompletion = (completion: TaskCompletion) =>
    completion.status === 'incomplete' || completion.status === 'complete' || !completion.status

  const isCompletedCompletion = (completion: TaskCompletion) => completion.status !== 'incomplete'

  const load = useCallback(async () => {
    try {
      setLoadError(null)

      const [empRes, schRes, catRes, taskRes, compRes, sessRes, clockRes] = await Promise.all([
        supabase.from('employees').select('*').eq('is_active', true),
        supabase.from('schedules').select('*').eq('date', today),
        supabase.from('task_categories').select('*').eq('is_active', true).order('display_order'),
        supabase.from('tasks').select('*').eq('is_active', true).order('display_order'),
        supabase.from('task_completions').select('*, employee:employees(*)').eq('session_date', today),
        supabase.from('daily_sessions').select('*').eq('session_date', today).maybeSingle(),
        fetch(`/api/clock-events?session_date=${today}`, { cache: 'no-store' }).then(async res => {
          const payload = (await res.json().catch(() => ({}))) as { error?: string; records?: ShiftClock[] }
          if (!res.ok) throw new Error(payload.error ?? 'Failed to load clock records')
          return payload
        }),
      ])

      const loadedTasks = (taskRes.data ?? []).filter(task => !isSystemClockTask(task))
      const loadedSession = sessRes.data ?? null

      setEmployees(empRes.data ?? [])
      setSchedules(schRes.data ?? [])
      setCategories(catRes.data ?? [])
      setTasks(loadedTasks)
      setCompletions(compRes.data ?? [])
      setClockRecords(clockRes.records ?? [])
      setSession(loadedSession)
      setNotes(loadedSession?.notes ?? '')
    } catch (error) {
      console.error('Failed to load dashboard data', error)
      setLoadError(error instanceof Error ? error.message : 'Failed to load dashboard data')
      setEmployees([])
      setSchedules([])
      setCategories([])
      setTasks([])
      setCompletions([])
      setClockRecords([])
      setSession(null)
      setNotes('')
    }
  }, [today, setNotes])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(new Date())
    }, 60_000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    let mounted = true

    void (async () => {
      if (!mounted) return
      await load()
    })()

    return () => {
      mounted = false
    }
  }, [load])

  const saveNotes = async () => {
    if (session) {
      await supabase.from('daily_sessions').update({ notes }).eq('id', session.id)
    } else {
      await supabase.from('daily_sessions').insert({ session_date: today, notes, current_phase: 'pre_shift' })
    }
    setNotesSaved(true)
    setTimeout(() => setNotesSaved(false), 2000)
    await load()
  }

  const getTaskCounts = (phase: 'pre_shift' | 'operation' | 'closing'): [number, number] => {
    const category = categories.find(item => item.type === phase)
    if (!category) return [0, 0]
    const phaseTasks = tasks.filter(task => task.category_id === category.id && task.is_active)
    const done = phaseTasks.filter(task => completions.some(completion => completion.task_id === task.id && isResolvedCompletion(completion))).length
    return [done, phaseTasks.length]
  }

  const totalTasks = tasks.filter(task => task.is_active).length
  const visibleTaskIds = new Set(tasks.filter(task => task.is_active).map(task => task.id))
  const doneTasks = new Set(completions.filter(completion => isResolvedCompletion(completion) && visibleTaskIds.has(completion.task_id)).map(completion => completion.task_id)).size
  const completedTasks = new Set(completions.filter(completion => isCompletedCompletion(completion) && visibleTaskIds.has(completion.task_id)).map(completion => completion.task_id)).size
  const progressPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2.5 border-b bg-white px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">{format(businessDate, 'EEEE, MMMM d, yyyy')}</h1>
          </div>
          <div className="flex items-center gap-4">
            <ClockToolbar schedules={schedules} clockRecords={clockRecords} today={today} onRefresh={load} />
            <div className="flex items-center gap-2">
              <div className="h-2 w-32 overflow-hidden rounded-full bg-gray-200">
                <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="text-sm font-medium">{doneTasks}/{totalTasks} resolved</span>
            </div>
          </div>
        </div>

        <PerformanceBar employees={employees} completions={completions} today={today} />
        {doneTasks !== completedTasks && (
          <p className="text-xs text-muted-foreground">
            {completedTasks} completed, {doneTasks - completedTasks} marked incomplete
          </p>
        )}
        {loadError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {loadError}
          </div>
        )}

        <div className="flex items-start gap-4">
          <TaskRoadmap
            session={session}
            taskCounts={{
              pre_shift: getTaskCounts('pre_shift'),
              operation: getTaskCounts('operation'),
              closing: getTaskCounts('closing'),
            }}
          />
          <div className="flex flex-1 gap-2">
            <Textarea
              placeholder="Notes / events for today…"
              value={notes}
              onChange={event => setNotes(event.target.value)}
              className="h-10 min-h-0 resize-none py-2 text-sm"
              onBlur={saveNotes}
            />
            {notesSaved && <span className="shrink-0 self-center text-xs text-green-600">Saved</span>}
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <StaffSidebar schedules={schedules} employees={employees} clockRecords={clockRecords} />
        <TaskFlow
          key={today}
          categories={categories}
          tasks={tasks}
          completions={completions}
          session={session}
          employees={employees}
          today={today}
          onRefresh={load}
        />
      </div>
    </div>
  )
}
