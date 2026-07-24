'use client'

import { useMemo, useState } from 'react'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { PlanningGrid } from '@/components/schedule-planning/PlanningGrid'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { ScheduleDepartment } from '@/lib/types'
import { useAppSettings } from '@/components/useAppSettings'
import { getDepartmentLabel } from '@/lib/organization'

export default function SchedulePlanningPage() {
  const [department, setDepartment] = useState<ScheduleDepartment>('server')
  const { departmentDefinitions } = useAppSettings()
  const scheduleDepartments = useMemo(() => (
    departmentDefinitions.length > 0
      ? departmentDefinitions
      : [{ key: 'server', label: 'Server' }, { key: 'cook', label: 'Cook' }]
  ), [departmentDefinitions])

  const selectedDepartment = scheduleDepartments.some(definition => definition.key === department)
    ? department
    : scheduleDepartments[0]?.key ?? 'server'
  const selectedDepartmentLabel = getDepartmentLabel(selectedDepartment, departmentDefinitions)

  return (
    <div className="p-6">
      <AdminSubpageHeader title="Schedule Planning" subtitle="Build, adjust, and publish the weekly schedule." />
      <PlanningGrid
        department={selectedDepartment}
        rightSlot={(
          <Select value={selectedDepartment} onValueChange={value => value && setDepartment(value as ScheduleDepartment)}>
            <SelectTrigger size="sm" className="w-40 bg-white">
              <span>{selectedDepartmentLabel}</span>
            </SelectTrigger>
            <SelectContent>
              {scheduleDepartments.map(definition => (
                <SelectItem key={definition.key} value={definition.key}>
                  {getDepartmentLabel(definition.key, departmentDefinitions)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </div>
  )
}
