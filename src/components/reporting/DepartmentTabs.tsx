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
  const tabs = [
    { key: 'all', label: 'All' },
    ...(departmentDefinitions.length > 0
      ? departmentDefinitions.map(definition => ({ key: definition.key, label: definition.label }))
      : [
          { key: 'manager', label: 'Manager' },
          { key: 'server', label: 'Server' },
          { key: 'cook', label: 'Cook' },
          { key: 'kitchen', label: 'Kitchen' },
        ]),
  ]

  return (
    <Tabs value={department} onValueChange={(value: string | null) => value && onChange(value as ReportDepartment)}>
      <TabsList className="mb-4 flex h-auto flex-wrap">
        {tabs.map(tab => (
          <TabsTrigger key={tab.key} value={tab.key}>
            {tab.key === 'all' ? 'All' : getDepartmentLabel(tab.key, departmentDefinitions)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
