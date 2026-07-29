'use client'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ReportDepartment } from '@/lib/reporting'
import { useAppSettings } from '@/components/useAppSettings'
import { getDepartmentLabel } from '@/lib/organization'

interface DepartmentTabsProps {
  department: ReportDepartment
  onChange: (department: ReportDepartment) => void
}

export function DepartmentTabs({ department, onChange }: DepartmentTabsProps) {
  const { departmentDefinitions } = useAppSettings()
  const availableDepartments = departmentDefinitions.filter(definition => definition.is_active)

  return (
    <Tabs value={department} onValueChange={(value: string | null) => value && onChange(value as ReportDepartment)}>
      <TabsList className="mb-4">
        {availableDepartments.map(definition => (
          <TabsTrigger key={definition.key} value={definition.key}>
            {getDepartmentLabel(definition.key, departmentDefinitions)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
