'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Employee, Schedule, TaskCategory, Task, TaskCompletion, DailySession } from '@/lib/types'
import { getBusinessDate, getBusinessDateString } from '@/lib/dateUtils'
import { ensureDefaultClockTasks } from '@/lib/defaultTasks'
import { StaffSidebar } from '@/components/dashboard/StaffSidebar'
import { TaskFlow } from '@/components/dashboard/TaskFlow'
import { PerformanceBar } from '@/components/dashboard/PerformanceBar'
import { TaskRoadmap } from '@/components/dashboard/TaskRoadmap'
import { Textarea } from '@/components/ui/textarea'
import { format } from 'date-fns'

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
  const [notes, setNotes] = useState('')
  const [notesSaved, setNotesSaved] = useState(false)
  const isResolvedCompletion = (completion: TaskCompletion) => completion.status === 'incomplete' || completion.status === 'complete' || !completion.status
  const isCompletedCompletion = (completion: TaskCompletion) => completion.status !== 'incomplete'

  const load = useCallback(async () => {
    const [empRes, schRes, catRes, taskRes, compRes, sessRes] = await Promise.all([
      supabase.from('employees').select('*').eq('is_active', true),
      supabase.from('schedules').select('*').eq('date', today),
      supabase.from('task_categories').select('*').eq('is_active', true).order('display_order'),
      supabase.from('tasks').select('*').eq('is_active', true).order('display_order'),
      supabase.from('task_completions').select('*, employee:employees(*)').eq('session_date', today),
      supabase.from('daily_sessions').select('*').eq('session_date', today).maybeSingle(),
    ])

    const loadedCategories = catRes.data ?? []
    let loadedTasks = taskRes.data ?? []

    try {
      const insertedDefaults = await ensureDefaultClockTasks(supabase, loadedCategories, loadedTasks)
      if (insertedDefaults) {
        const refreshedTasks = await supabase.from('tasks').select('*').eq('is_active', true).order('display_order')
        loadedTasks = refreshedTasks.data ?? loadedTasks
      }
    } catch (error) {
      console.error('Failed to ensure default clock tasks', error)
    }

    setEmployees(empRes.data ?? [])
    setSchedules(schRes.data ?? [])
    setCategories(loadedCategories)
    setTasks(loadedTasks)
    setCompletions(compRes.data ?? [])
    const loadedSession = sessRes.data ?? null
    setSession(loadedSession)
    setNotes(loadedSession?.notes ?? '')
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
    const cat = categories.find(c => c.type === phase)
    if (!cat) return [0, 0]
    const phaseTasks = tasks.filter(t => t.category_id === cat.id && t.is_active)
    const done = phaseTasks.filter(t => completions.some(c => c.task_id === t.id && isResolvedCompletion(c))).length
    return [done, phaseTasks.length]
  }

  const totalTasks = tasks.filter(t => t.is_active).length
  const doneTasks = new Set(completions.filter(isResolvedCompletion).map(c => c.task_id)).size
  const completedTasks = new Set(completions.filter(isCompletedCompletion).map(c => c.task_id)).size
  const progressPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b px-4 py-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">
              {format(businessDate, 'EEEE, MMMM d, yyyy')}
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
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

        <div className="flex items-start gap-4">
          <TaskRoadmap
            session={session}
            taskCounts={{
              pre_shift: getTaskCounts('pre_shift'),
              operation: getTaskCounts('operation'),
              closing: getTaskCounts('closing'),
            }}
          />
          <div className="flex-1 flex gap-2">
            <Textarea
              placeholder="Notes / events for today…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="text-sm h-10 min-h-0 resize-none py-2"
              onBlur={saveNotes}
            />
            {notesSaved && <span className="text-xs text-green-600 self-center shrink-0">Saved</span>}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        <StaffSidebar schedules={schedules} employees={employees} />
        <TaskFlow
          key={today}
          categories={categories}
          tasks={tasks}
          schedules={schedules}
          completions={completions}
          session={session}
          employees={employees}
          today={today}
          now={now}
          onRefresh={load}
        />
      </div>
    </div>
  )
}
