'use client'

import { useCallback, useEffect, useState } from 'react'
import { ClockToolbar } from '@/components/dashboard/ClockToolbar'
import { supabase } from '@/lib/supabase'
import { getBusinessDateString } from '@/lib/dateUtils'
import { Schedule, ShiftClock } from '@/lib/types'

export const CLOCK_RECORDS_CHANGED_EVENT = 'foh-clock-records-changed'

function notifyClockRecordsChanged() {
  window.dispatchEvent(new Event(CLOCK_RECORDS_CHANGED_EVENT))
  window.dispatchEvent(new Event('reporting-data-refresh'))
}

export function GlobalTimeClock() {
  const [now, setNow] = useState(() => new Date())
  const today = getBusinessDateString(now)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [clockRecords, setClockRecords] = useState<ShiftClock[]>([])

  const load = useCallback(async () => {
    const [scheduleRes, clockRes] = await Promise.all([
      supabase
        .from('schedules')
        .select('*, employee:employees(id, name, phone, email, role, primary_department, schedule_departments, hourly_wage, guaranteed_hourly, tip_pool_hourly_rate, birth_date, is_active, created_at)')
        .eq('date', today)
        .order('department')
        .order('start_time'),
      fetch(`/api/clock-events?session_date=${today}`, { cache: 'no-store' }).then(async res => (
        (await res.json().catch(() => ({}))) as { records?: ShiftClock[] }
      )),
    ])

    setSchedules((scheduleRes.data ?? []) as Schedule[])
    setClockRecords(clockRes.records ?? [])
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
      await load()
      if (!mounted) return
    })()

    const handleRefresh = () => {
      void load()
    }
    window.addEventListener(CLOCK_RECORDS_CHANGED_EVENT, handleRefresh)

    return () => {
      mounted = false
      window.removeEventListener(CLOCK_RECORDS_CHANGED_EVENT, handleRefresh)
    }
  }, [load])

  return (
    <ClockToolbar
      schedules={schedules}
      clockRecords={clockRecords}
      today={today}
      variant="nav"
      onRefresh={async () => {
        await load()
        notifyClockRecordsChanged()
      }}
    />
  )
}
