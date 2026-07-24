'use client'

import { useCallback, useEffect, useState } from 'react'
import { DepartmentDefinition, RoleDefinition } from '@/lib/appSettings'
import { sortDefinitionsByOrder } from '@/lib/organization'

const DEFAULT_ROLE_DEFINITIONS: RoleDefinition[] = [
  { key: 'manager', label: 'Manager', description: 'Admin access and oversight', color: '#8b5cf6', is_active: true, display_order: 0 },
  { key: 'server', label: 'Server', description: 'Guest-facing service and table management', color: '#0ea5e9', is_active: true, display_order: 1 },
  { key: 'busser', label: 'Busser', description: 'Table reset and dining room support', color: '#10b981', is_active: true, display_order: 2 },
  { key: 'runner', label: 'Runner', description: 'Food running and service support', color: '#f59e0b', is_active: true, display_order: 3 },
  { key: 'kitchen_staff', label: 'Kitchen Staff', description: 'Back-of-house prep and line work', color: '#f43f5e', is_active: true, display_order: 4 },
]

const DEFAULT_DEPARTMENT_DEFINITIONS: DepartmentDefinition[] = [
  { key: 'manager', label: 'Manager', description: 'Management and schedule oversight', is_active: true, display_order: 0 },
  { key: 'server', label: 'Server', description: 'Dining room service', is_active: true, display_order: 1 },
  { key: 'cook', label: 'Cook', description: 'Cooking shifts', is_active: true, display_order: 2 },
  { key: 'kitchen', label: 'Kitchen', description: 'Kitchen support shifts', is_active: true, display_order: 3 },
]

export function useAppSettings() {
  const [roleDefinitions, setRoleDefinitions] = useState<RoleDefinition[]>(DEFAULT_ROLE_DEFINITIONS)
  const [departmentDefinitions, setDepartmentDefinitions] = useState<DepartmentDefinition[]>(DEFAULT_DEPARTMENT_DEFINITIONS)

  const loadSettings = useCallback(async () => {
    const res = await fetch('/api/org-settings', { cache: 'no-store' })
    const data = res.ok
      ? await res.json() as { role_definitions?: RoleDefinition[]; primary_department_definitions?: DepartmentDefinition[] }
      : {}
    if (data.role_definitions) {
      setRoleDefinitions(sortDefinitionsByOrder(data.role_definitions.filter(definition => definition.is_active)))
    }
    if (data.primary_department_definitions) {
      setDepartmentDefinitions(sortDefinitionsByOrder(data.primary_department_definitions.filter(definition => definition.is_active)))
    }
  }, [])

  useEffect(() => {
    let mounted = true

    const safeLoadSettings = async () => {
      const res = await fetch('/api/org-settings', { cache: 'no-store' })
      const data = res.ok
        ? await res.json() as { role_definitions?: RoleDefinition[]; primary_department_definitions?: DepartmentDefinition[] }
        : {}
      if (!mounted) return
      if (data.role_definitions) {
        setRoleDefinitions(sortDefinitionsByOrder(data.role_definitions.filter(definition => definition.is_active)))
      }
      if (data.primary_department_definitions) {
        setDepartmentDefinitions(sortDefinitionsByOrder(data.primary_department_definitions.filter(definition => definition.is_active)))
      }
    }

    void safeLoadSettings()

    const handleFocus = () => {
      void safeLoadSettings()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void safeLoadSettings()
      }
    }

    window.addEventListener('focus', handleFocus)
    window.addEventListener('app-settings-updated', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      mounted = false
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('app-settings-updated', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [loadSettings])

  return {
    roleDefinitions,
    departmentDefinitions,
    reloadAppSettings: loadSettings,
  }
}
