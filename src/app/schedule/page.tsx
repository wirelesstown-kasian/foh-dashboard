'use client'

import { useState } from 'react'
import { WeeklyScheduleGrid } from '@/components/schedule/WeeklyScheduleGrid'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScheduleDepartment } from '@/lib/types'

export default function SchedulePage() {
  const [department, setDepartment] = useState<ScheduleDepartment>('foh')

  return (
    <div className="p-6">
      <WeeklyScheduleGrid
        department={department}
        rightSlot={(
          <Tabs value={department} onValueChange={value => setDepartment(value as ScheduleDepartment)}>
            <TabsList className="h-8 rounded-lg bg-slate-100">
              <TabsTrigger value="foh" className="px-3 text-xs font-semibold">FOH</TabsTrigger>
              <TabsTrigger value="boh" className="px-3 text-xs font-semibold">BOH</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      />
    </div>
  )
}
