'use client'

import { useMemo, useState } from 'react'
import { WeeklyScheduleGrid } from '@/components/schedule/WeeklyScheduleGrid'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { ScheduleDepartment } from '@/lib/types'
import { useAppSettings } from '@/components/useAppSettings'
import { getDepartmentLabel } from '@/lib/organization'

export default function SchedulePage() {
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
    <div className="schedule-page p-6">
      <WeeklyScheduleGrid
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
