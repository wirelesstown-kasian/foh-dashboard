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

  return (
    <Tabs value={department} onValueChange={(value: string | null) => value && onChange(value as ReportDepartment)}>
      <TabsList className="mb-4">
        <TabsTrigger value="foh">{getDepartmentLabel('foh', departmentDefinitions)}</TabsTrigger>
        <TabsTrigger value="boh">{getDepartmentLabel('boh', departmentDefinitions)}</TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
