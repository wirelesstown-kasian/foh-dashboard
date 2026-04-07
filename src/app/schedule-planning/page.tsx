'use client'

import { useState } from 'react'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { PlanningGrid } from '@/components/schedule-planning/PlanningGrid'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScheduleDepartment } from '@/lib/types'
import { useAppSettings } from '@/components/useAppSettings'
import { getDepartmentLabel } from '@/lib/organization'

export default function SchedulePlanningPage() {
  const [department, setDepartment] = useState<ScheduleDepartment>('foh')
  const { departmentDefinitions } = useAppSettings()

  return (
    <div className="p-6">
      <AdminSubpageHeader title="Schedule Planning" subtitle="Build, adjust, and publish the weekly schedule." />
      <PlanningGrid
        department={department}
        rightSlot={(
          <Tabs value={department} onValueChange={value => setDepartment(value as ScheduleDepartment)}>
            <TabsList className="h-9 rounded-lg bg-slate-100 p-1">
              <TabsTrigger value="foh" className="px-3 text-xs font-semibold">{getDepartmentLabel('foh', departmentDefinitions)}</TabsTrigger>
              <TabsTrigger value="boh" className="px-3 text-xs font-semibold">{getDepartmentLabel('boh', departmentDefinitions)}</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      />
    </div>
  )
}
