'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Employee, EodReport, PayrollRun, PayrollRunItem, ShiftClock, Task, TaskCategory, TaskCompletion, TipDistribution } from '@/lib/types'
import { EMPLOYEE_PUBLIC_SELECT, EMPLOYEE_PUBLIC_SELECT_FALLBACK, EMPLOYEE_PUBLIC_SELECT_WITHOUT_MEAL_BREAK_THRESHOLD, isMissingAddressColumn, isMissingMealBreakThresholdColumn, isMissingPaymentMethodColumn, isMissingTipPoolRateColumn, withMealBreakThresholdHours, withPaymentMethod, withStaffingProfileFields, withTipPoolHourlyRate } from '@/lib/employeeSelect'

const REPORTING_REFRESH_EVENT = 'reporting-data-refresh'

export function notifyReportingDataChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(REPORTING_REFRESH_EVENT))
}

export function useEmployees({ includeArchived = false }: { includeArchived?: boolean } = {}) {
  const [employees, setEmployees] = useState<Employee[]>([])

  useEffect(() => {
    let mounted = true
    void (async () => {
      let query = supabase.from('employees').select(EMPLOYEE_PUBLIC_SELECT).order('name')
      if (!includeArchived) query = query.eq('is_active', true)
      let res = await query as { data: object[] | null; error: { message?: string; code?: string } | null }
      if (res.error && isMissingMealBreakThresholdColumn(res.error)) {
        res = await (() => {
          let fallbackQuery = supabase.from('employees').select(EMPLOYEE_PUBLIC_SELECT_WITHOUT_MEAL_BREAK_THRESHOLD).order('name')
          if (!includeArchived) fallbackQuery = fallbackQuery.eq('is_active', true)
          return fallbackQuery
        })() as { data: object[] | null; error: { message?: string; code?: string } | null }
      }
      if (res.error && (isMissingTipPoolRateColumn(res.error) || isMissingPaymentMethodColumn(res.error) || isMissingAddressColumn(res.error))) {
        res = await (() => {
          let fallbackQuery = supabase.from('employees').select(EMPLOYEE_PUBLIC_SELECT_FALLBACK).order('name')
          if (!includeArchived) fallbackQuery = fallbackQuery.eq('is_active', true)
          return fallbackQuery
        })() as { data: object[] | null; error: { message?: string; code?: string } | null }
      }
      const legacyRes = res.error && isMissingMealBreakThresholdColumn(res.error)
        ? await (() => {
            let fallbackQuery = supabase.from('employees').select(EMPLOYEE_PUBLIC_SELECT_FALLBACK).order('name')
            if (!includeArchived) fallbackQuery = fallbackQuery.eq('is_active', true)
            return fallbackQuery
          })() as { data: object[] | null; error: { message?: string; code?: string } | null }
        : res
      if (!mounted) return
      setEmployees(withMealBreakThresholdHours(withStaffingProfileFields(withPaymentMethod(withTipPoolHourlyRate(legacyRes.data ?? [])))) as Employee[])
    })()
    return () => {
      mounted = false
    }
  }, [includeArchived])

  return employees
}

export function useTaskCompletions() {
  const [completions, setCompletions] = useState<TaskCompletion[]>([])

  useEffect(() => {
    let mounted = true

    const load = async () => {
      const res = await supabase.from('task_completions').select('*')
      if (!mounted) return
      setCompletions(res.data ?? [])
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

  return { completions, setCompletions }
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

export function useScheduledDepartmentIds(startDate: string, endDate: string) {
  const [deptMap, setDeptMap] = useState<Map<string, Set<string>>>(new Map())

  useEffect(() => {
    if (!startDate || !endDate) return
    let mounted = true
    void (async () => {
      const res = await supabase
        .from('schedules')
        .select('employee_id, department')
        .gte('date', startDate)
        .lte('date', endDate)
      if (!mounted) return
      const map = new Map<string, Set<string>>()
      for (const row of (res.data ?? []) as { employee_id: string; department: string }[]) {
        if (!map.has(row.department)) map.set(row.department, new Set())
        map.get(row.department)!.add(row.employee_id)
      }
      setDeptMap(map)
    })()
    return () => { mounted = false }
  }, [startDate, endDate])

  return deptMap
}

export function useClockRecords({
  sessionDate,
  startDate,
  endDate,
}: {
  sessionDate?: string
  startDate?: string
  endDate?: string
} = {}) {
  const [clockRecords, setClockRecords] = useState<ShiftClock[]>([])

  useEffect(() => {
    let mounted = true

    const load = async () => {
      const params = new URLSearchParams()
      if (sessionDate) params.set('session_date', sessionDate)
      if (startDate) params.set('start_date', startDate)
      if (endDate) params.set('end_date', endDate)
      const query = params.toString()
      const res = await fetch(`/api/clock-events${query ? `?${query}` : ''}`, { cache: 'no-store' })
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
  }, [endDate, sessionDate, startDate])

  return { clockRecords, setClockRecords }
}

export function usePayrollRuns() {
  const [payrollRuns, setPayrollRuns] = useState<(PayrollRun & { payroll_run_items?: PayrollRunItem[] })[]>([])

  useEffect(() => {
    let mounted = true

    const load = async () => {
      const res = await supabase
        .from('payroll_runs')
        .select('*, payroll_run_items(*)')
        .order('pay_date', { ascending: false })
      if (!mounted) return
      setPayrollRuns((res.data ?? []) as (PayrollRun & { payroll_run_items?: PayrollRunItem[] })[])
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

  return { payrollRuns, setPayrollRuns }
}
