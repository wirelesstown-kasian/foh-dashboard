'use client'

import { useMemo, useState } from 'react'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { PlanningGrid } from '@/components/schedule-planning/PlanningGrid'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScheduleDepartment } from '@/lib/types'
import { useAppSettings } from '@/components/useAppSettings'
import { getDepartmentLabel } from '@/lib/organization'

export default function SchedulePlanningPage() {
  const [department, setDepartment] = useState<ScheduleDepartment>('foh')
  const { departmentDefinitions } = useAppSettings()
  const scheduleDepartments = useMemo(() => (
    departmentDefinitions.length > 0
      ? departmentDefinitions
      : [{ key: 'foh', label: 'FOH' }, { key: 'boh', label: 'BOH' }]
  ), [departmentDefinitions])

  const selectedDepartment = scheduleDepartments.some(definition => definition.key === department)
    ? department
    : scheduleDepartments[0]?.key ?? 'foh'

  return (
    <div className="p-6">
      <AdminSubpageHeader title="Schedule Planning" subtitle="Build, adjust, and publish the weekly schedule." />
      <PlanningGrid
        department={selectedDepartment}
        rightSlot={(
          <Tabs value={selectedDepartment} onValueChange={value => setDepartment(value as ScheduleDepartment)}>
            <TabsList className="h-9 rounded-lg bg-slate-100 p-1">
              {scheduleDepartments.map(definition => (
                <TabsTrigger key={definition.key} value={definition.key} className="px-3 text-xs font-semibold">
                  {getDepartmentLabel(definition.key, departmentDefinitions)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      />
    </div>
  )
}
