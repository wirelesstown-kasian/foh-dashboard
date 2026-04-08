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
  { key: 'foh', label: 'FOH', description: 'Front-of-house staff and service floor', is_active: true, display_order: 0 },
  { key: 'boh', label: 'BOH', description: 'Back-of-house kitchen operations', is_active: true, display_order: 1 },
  { key: 'hybrid', label: 'Hybrid', description: 'Floats across both FOH and BOH', is_active: true, display_order: 2 },
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
