'use client'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ReportDepartment } from '@/lib/reporting'

interface DepartmentTabsProps {
  department: ReportDepartment
  onChange: (department: ReportDepartment) => void
}

export function DepartmentTabs({ department, onChange }: DepartmentTabsProps) {
  return (
    <Tabs value={department} onValueChange={(value: string | null) => value && onChange(value as ReportDepartment)}>
      <TabsList className="mb-4">
        <TabsTrigger value="foh">FOH</TabsTrigger>
        <TabsTrigger value="boh">BOH</TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
