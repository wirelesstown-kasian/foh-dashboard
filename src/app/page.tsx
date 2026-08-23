'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Employee, Schedule, TaskCategory, Task, TaskCompletion, DailySession, ShiftClock } from '@/lib/types'
import { getBusinessDate, getBusinessDateString } from '@/lib/dateUtils'
import { StaffSidebar } from '@/components/dashboard/StaffSidebar'
import { TaskFlow } from '@/components/dashboard/TaskFlow'
import { PerformanceBar } from '@/components/dashboard/PerformanceBar'
import { TaskRoadmap } from '@/components/dashboard/TaskRoadmap'
import { RegisterOpenPanel } from '@/components/dashboard/RegisterOpenPanel'
import { format, startOfMonth } from 'date-fns'
import { EMPLOYEE_PUBLIC_SELECT, EMPLOYEE_PUBLIC_SELECT_FALLBACK, EMPLOYEE_PUBLIC_SELECT_WITHOUT_TIP_ELIGIBLE, isMissingMealBreakThresholdColumn, isMissingPaymentMethodColumn, isMissingTipEligibleColumn, isMissingTipPoolRateColumn, withMealBreakThresholdHours, withPaymentMethod, withTipEligible, withTipPoolHourlyRate } from '@/lib/employeeSelect'
import { Bell, Sparkles } from 'lucide-react'

const isSystemClockTask = (task: Task) => {
  const title = task.title.trim().toLowerCase()
  return title === 'clock in' || title === 'clock out'
}

const getAnnouncementLines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean)

export default function DashboardPage() {
  const [now, setNow] = useState(() => new Date())
  const businessDate = getBusinessDate(now)
  const today = getBusinessDateString(now)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [categories, setCategories] = useState<TaskCategory[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [completions, setCompletions] = useState<TaskCompletion[]>([])
  const [monthCompletions, setMonthCompletions] = useState<TaskCompletion[]>([])
  const [session, setSession] = useState<DailySession | null>(null)
  const [clockRecords, setClockRecords] = useState<ShiftClock[]>([])
  const [announcementBoard, setAnnouncementBoard] = useState('')
  const [startingCash, setStartingCash] = useState<string>('')
  const [loadError, setLoadError] = useState<string | null>(null)

  const isResolvedCompletion = (completion: TaskCompletion) =>
    completion.status === 'incomplete' || completion.status === 'complete' || !completion.status

  const isCompletedCompletion = (completion: TaskCompletion) => completion.status !== 'incomplete'

  const load = useCallback(async () => {
    try {
      setLoadError(null)
      const monthStart = format(startOfMonth(new Date(`${today}T12:00:00`)), 'yyyy-MM-dd')
      const loadEmployees = async () => {
        const initial = await supabase.from('employees').select(EMPLOYEE_PUBLIC_SELECT).eq('is_active', true)
        const tipEligibleFallback = initial.error && isMissingTipEligibleColumn(initial.error)
          ? await supabase.from('employees').select(EMPLOYEE_PUBLIC_SELECT_WITHOUT_TIP_ELIGIBLE).eq('is_active', true)
          : initial
        const result = tipEligibleFallback.error && (isMissingTipPoolRateColumn(tipEligibleFallback.error) || isMissingPaymentMethodColumn(tipEligibleFallback.error) || isMissingMealBreakThresholdColumn(tipEligibleFallback.error))
          ? await supabase.from('employees').select(EMPLOYEE_PUBLIC_SELECT_FALLBACK).eq('is_active', true)
          : tipEligibleFallback
        return {
          ...result,
          data: withTipEligible(withMealBreakThresholdHours(withPaymentMethod(withTipPoolHourlyRate(result.data ?? [])))) as Employee[],
        }
      }

      const [empRes, schRes, catRes, taskRes, compRes, monthCompRes, sessRes, clockRes] = await Promise.all([
        loadEmployees(),
        supabase
          .from('schedules')
          .select('*, employee:employees(id, name, phone, email, role, primary_department, schedule_departments, hourly_wage, guaranteed_hourly, tip_pool_hourly_rate, birth_date, is_active, created_at)')
          .eq('date', today)
          .order('department')
          .order('start_time'),
        supabase.from('task_categories').select('*').eq('is_active', true).order('display_order'),
        supabase.from('tasks').select('*').eq('is_active', true).order('display_order'),
        supabase.from('task_completions').select('*, employee:employees(*)').eq('session_date', today),
        supabase.from('task_completions').select('*').gte('session_date', monthStart).lte('session_date', today),
        supabase.from('daily_sessions').select('*').eq('session_date', today).maybeSingle(),
        fetch(`/api/clock-events?session_date=${today}`, { cache: 'no-store' })
          .then(async res => {
            const payload = (await res.json().catch(() => ({}))) as { error?: string; records?: ShiftClock[] }
            return res.ok
              ? { records: payload.records ?? [], error: null }
              : { records: [] as ShiftClock[], error: payload.error ?? 'Failed to load clock records' }
          })
          .catch((error: unknown) => ({
            records: [] as ShiftClock[],
            error: error instanceof Error ? error.message : 'Failed to load clock records',
          })),
      ])

      const loadedTasks = (taskRes.data ?? []).filter(task => !isSystemClockTask(task))
      const loadedSession = sessRes.data ?? null
      const loadedEmployees = empRes.data ?? []
      const loadedClockRecords = clockRes.records ?? []
      const missingClockEmployeeIds = Array.from(new Set(
        loadedClockRecords
          .filter(record => !record.clock_out_at && !loadedEmployees.some(employee => employee.id === record.employee_id))
          .map(record => record.employee_id)
      ))
      if (missingClockEmployeeIds.length > 0) {
        const missingEmployeesRes = await supabase
          .from('employees')
          .select(EMPLOYEE_PUBLIC_SELECT)
          .in('id', missingClockEmployeeIds)
        if (!missingEmployeesRes.error) {
          loadedEmployees.push(...withTipEligible(withMealBreakThresholdHours(withPaymentMethod(withTipPoolHourlyRate(missingEmployeesRes.data ?? [])))) as Employee[])
        }
      }

      setEmployees(loadedEmployees)
      setSchedules(schRes.data ?? [])
      setCategories(catRes.data ?? [])
      setTasks(loadedTasks)
      setCompletions(compRes.data ?? [])
      setMonthCompletions(monthCompRes.data ?? [])
      setClockRecords(loadedClockRecords)
      setSession(loadedSession)
      setStartingCash(loadedSession?.starting_cash != null ? String(loadedSession.starting_cash) : '')
      if (clockRes.error) {
        setLoadError(`Clock system offline: ${clockRes.error}`)
      }
    } catch (error) {
      console.error('Failed to load dashboard data', error)
      setLoadError(error instanceof Error ? error.message : 'Failed to load dashboard data')
      setEmployees([])
      setSchedules([])
      setCategories([])
      setTasks([])
      setCompletions([])
      setMonthCompletions([])
      setClockRecords([])
      setSession(null)
    }
  }, [today])

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

  useEffect(() => {
    const handleClockRecordsChanged = () => {
      void load()
    }
    window.addEventListener('foh-clock-records-changed', handleClockRecordsChanged)
    return () => window.removeEventListener('foh-clock-records-changed', handleClockRecordsChanged)
  }, [load])

  useEffect(() => {
    let mounted = true
    const loadAnnouncements = async () => {
      const res = await fetch('/api/announcements', { cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as { boardText?: string }
      if (!mounted) return
      setAnnouncementBoard(data.boardText ?? '')
    }
    void loadAnnouncements()
    window.addEventListener('announcements-updated', loadAnnouncements)
    return () => {
      mounted = false
      window.removeEventListener('announcements-updated', loadAnnouncements)
    }
  }, [])

  const saveStartingCash = async () => {
    const value = parseFloat(startingCash) || 0
    if (session) {
      await supabase.from('daily_sessions').update({ starting_cash: value }).eq('id', session.id)
    } else {
      await supabase.from('daily_sessions').insert({ session_date: today, starting_cash: value, current_phase: 'pre_shift' })
    }
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
  const announcementLines = getAnnouncementLines(announcementBoard)

  // Show Register Open screen when session hasn't started yet or is in register_open phase
  if (!session || session.current_phase === 'register_open') {
    return (
      <div className="flex min-h-full flex-col">
        <RegisterOpenPanel
          session={session}
          employees={employees}
          clockRecords={clockRecords}
          today={today}
          businessDate={businessDate}
          onComplete={load}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="space-y-2.5 border-b bg-white px-4 py-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-4">
          <div>
            <h1 className="text-lg font-bold">{format(businessDate, 'EEEE, MMMM d, yyyy')}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3 md:gap-4 md:pt-1">
            <div className="flex items-center gap-2">
              <div className="h-2 w-28 overflow-hidden rounded-full bg-gray-200">
                <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="text-sm font-medium">{doneTasks}/{totalTasks} resolved</span>
            </div>
          </div>
        </div>

        <div className={`flex flex-col gap-2 rounded-lg border px-3 py-2 shadow-sm sm:flex-row sm:items-center ${announcementBoard ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
          <div className="flex shrink-0 items-center gap-2 text-xs font-bold uppercase tracking-[0.14em]">
            {announcementBoard ? <Sparkles className="h-4 w-4 text-amber-600" /> : <Bell className="h-4 w-4 text-slate-500" />}
            Announcement Board
          </div>
          <div className="text-sm font-semibold leading-snug sm:border-l sm:border-current/20 sm:pl-3">
            {announcementLines.length > 0 ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {announcementLines.map((line, index) => (
                  <div key={`${line}-${index}`} className="flex items-start gap-1.5">
                    <span className="text-amber-600">-</span>
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            ) : (
              'No active announcement today.'
            )}
          </div>
        </div>

        <PerformanceBar employees={employees} completions={monthCompletions} schedules={schedules} clockRecords={clockRecords} today={today} />
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

        <div className="hidden md:flex items-start gap-4">
          <TaskRoadmap
            session={session}
            taskCounts={{
              pre_shift: getTaskCounts('pre_shift'),
              operation: getTaskCounts('operation'),
              closing: getTaskCounts('closing'),
            }}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="hidden md:block shrink-0">
          <StaffSidebar schedules={schedules} employees={employees} clockRecords={clockRecords} />
        </div>
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
