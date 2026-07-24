'use client'

import { useMemo, useState } from 'react'
import { WeeklyScheduleGrid } from '@/components/schedule/WeeklyScheduleGrid'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScheduleDepartment } from '@/lib/types'
import { useAppSettings } from '@/components/useAppSettings'
import { getDepartmentLabel } from '@/lib/organization'

export default function SchedulePage() {
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
    <div className="schedule-page p-6">
      <WeeklyScheduleGrid
        department={selectedDepartment}
        rightSlot={(
          <Tabs value={selectedDepartment} onValueChange={value => setDepartment(value as ScheduleDepartment)}>
            <TabsList className="h-8 rounded-lg bg-slate-100">
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
