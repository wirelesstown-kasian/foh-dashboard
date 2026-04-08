'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Employee, EodReport, ShiftClock, Task, TaskCategory, TaskCompletion, TipDistribution } from '@/lib/types'

const REPORTING_REFRESH_EVENT = 'reporting-data-refresh'

export function notifyReportingDataChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(REPORTING_REFRESH_EVENT))
}

export function useEmployees() {
  const [employees, setEmployees] = useState<Employee[]>([])

  useEffect(() => {
    let mounted = true
    void (async () => {
      const res = await supabase.from('employees').select('id, name, phone, email, role, primary_department, hourly_wage, guaranteed_hourly, birth_date, login_enabled, is_active, created_at').eq('is_active', true).order('name')
      if (!mounted) return
      setEmployees(res.data ?? [])
    })()
    return () => {
      mounted = false
    }
  }, [])

  return employees
}

export function useTaskCompletions() {
  const [completions, setCompletions] = useState<TaskCompletion[]>([])

  useEffect(() => {
    let mounted = true
    void (async () => {
      const res = await supabase.from('task_completions').select('*')
      if (!mounted) return
      setCompletions(res.data ?? [])
    })()
    return () => {
      mounted = false
    }
  }, [])

  return completions
}

export function useTasks() {
  const [tasks, setTasks] = useState<(Task & { category?: TaskCategory })[]>([])

  useEffect(() => {
    let mounted = true
    void (async () => {
      const res = await supabase
        .from('tasks')
        .select('*, category:task_categories(*)')
        .eq('is_active', true)
        .order('display_order')
      if (!mounted) return
      setTasks(res.data ?? [])
    })()
    return () => {
      mounted = false
    }
  }, [])

  return tasks
}

export function useEodReports() {
  const [eodReports, setEodReports] = useState<(EodReport & { tip_distributions: (TipDistribution & { employee: Employee })[] })[]>([])

  useEffect(() => {
    let mounted = true

    const load = async () => {
      const res = await supabase
        .from('eod_reports')
        .select('*, tip_distributions(*, employee:employees(*))')
        .order('session_date', { ascending: false })
      if (!mounted) return
      setEodReports(res.data ?? [])
    }

    void load()
    const handleRefresh = () => {
      void load()
    }
    window.addEventListener(REPORTING_REFRESH_EVENT, handleRefresh)
    return () => {
      mounted = false
      window.removeEventListener(REPORTING_REFRESH_EVENT, handleRefresh)
    }
  }, [])

  return { eodReports, setEodReports }
}

export function useClockRecords() {
  const [clockRecords, setClockRecords] = useState<ShiftClock[]>([])

  useEffect(() => {
    let mounted = true

    const load = async () => {
      const res = await fetch('/api/clock-events', { cache: 'no-store' })
      const json = (await res.json().catch(() => ({}))) as { records?: ShiftClock[] }
      if (!mounted) return
      setClockRecords(json.records ?? [])
    }

    void load()
    const handleRefresh = () => {
      void load()
    }
    window.addEventListener(REPORTING_REFRESH_EVENT, handleRefresh)
    return () => {
      mounted = false
      window.removeEventListener(REPORTING_REFRESH_EVENT, handleRefresh)
    }
  }, [])

  return { clockRecords, setClockRecords }
}
