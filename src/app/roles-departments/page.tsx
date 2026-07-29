'use client'

import { useEffect, useState } from 'react'
import { Building2, BriefcaseBusiness, Plus, Trash2 } from 'lucide-react'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AppSettings, DepartmentDefinition, RoleDefinition } from '@/lib/appSettings'
import { sortDefinitionsByOrder, titleCaseWords } from '@/lib/organization'
import { Employee } from '@/lib/types'
import { getEmployeeScheduleDepartments } from '@/lib/employeeSelect'

const DEFAULT_ROLES: RoleDefinition[] = [
  { key: 'manager', label: 'Manager', description: 'Admin access and oversight', color: '#8b5cf6', is_active: true, display_order: 0 },
  { key: 'server', label: 'Server', description: 'Guest-facing service and table management', color: '#0ea5e9', is_active: true, display_order: 1 },
  { key: 'busser', label: 'Busser', description: 'Table reset and dining room support', color: '#10b981', is_active: true, display_order: 2 },
  { key: 'runner', label: 'Runner', description: 'Food running and service support', color: '#f59e0b', is_active: true, display_order: 3 },
  { key: 'kitchen_staff', label: 'Kitchen Staff', description: 'Back-of-house prep and line work', color: '#f43f5e', is_active: true, display_order: 4 },
]

const DEFAULT_DEPARTMENTS: DepartmentDefinition[] = [
  { key: 'manager', label: 'Manager', description: 'Management and schedule oversight', is_active: true, display_order: 0 },
  { key: 'server', label: 'Server', description: 'Dining room service', is_active: true, display_order: 1 },
  { key: 'cook', label: 'Cook', description: 'Cooking shifts', is_active: true, display_order: 2 },
  { key: 'kitchen', label: 'Kitchen', description: 'Kitchen support shifts', is_active: true, display_order: 3 },
]

function slugifyRoleKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export default function RolesDepartmentsPage() {
  const [roles, setRoles] = useState<RoleDefinition[]>(DEFAULT_ROLES)
  const [departments, setDepartments] = useState<DepartmentDefinition[]>(DEFAULT_DEPARTMENTS)
  const [newRole, setNewRole] = useState('')
  const [newDepartment, setNewDepartment] = useState('')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    void (async () => {
      const [settingsRes, employeesRes] = await Promise.all([
        fetch('/api/app-settings', { cache: 'no-store' }),
        fetch('/api/employees', { cache: 'no-store' }),
      ])
      const data = (await settingsRes.json().catch(() => ({}))) as { settings?: AppSettings; error?: string }
      const employeeData = (await employeesRes.json().catch(() => ({}))) as { employees?: Employee[] }
      if (!mounted) return
      if (!settingsRes.ok || !data.settings) {
        setError(data.error ?? 'Failed to load roles and departments')
        setLoading(false)
        return
      }
      setRoles(sortDefinitionsByOrder(data.settings.role_definitions))
      setDepartments(sortDefinitionsByOrder(data.settings.primary_department_definitions))
      setEmployees(employeeData.employees ?? [])
      setLoading(false)
    })()

    return () => {
      mounted = false
    }
  }, [])

  const updateRole = (key: string, label: string) => {
    setRoles(currentRoles => currentRoles.map(role => (
      role.key === key ? { ...role, label } : role
    )))
  }

  const updateRoleDescription = (key: string, description: string) => {
    setRoles(currentRoles => currentRoles.map(role => (
      role.key === key ? { ...role, description } : role
    )))
  }

  const removeRole = (key: string) => {
    if (key === 'manager') return
    if (employees.some(employee => employee.role === key)) {
      setError('Move employees off this role before removing it')
      return
    }
    setRoles(currentRoles => currentRoles.filter(role => role.key !== key))
  }

  const addRole = () => {
    if (!newRole.trim()) return
    const key = slugifyRoleKey(newRole)
    if (!key || roles.some(role => role.key === key)) {
      setError('Role key already exists or is invalid')
      return
    }
    setRoles(currentRoles => [
      ...currentRoles,
      {
        key,
        label: titleCaseWords(newRole),
        description: '',
        color: '#64748b',
        is_active: true,
        display_order: currentRoles.length,
      },
    ])
    setNewRole('')
    setError(null)
  }

  const updateDepartment = (key: string, label: string) => {
    setDepartments(currentDepartments => currentDepartments.map(department => (
      department.key === key ? { ...department, label } : department
    )))
  }

  const updateDepartmentDescription = (key: string, description: string) => {
    setDepartments(currentDepartments => currentDepartments.map(department => (
      department.key === key ? { ...department, description } : department
    )))
  }

  const addDepartment = () => {
    if (!newDepartment.trim()) return
    const key = slugifyRoleKey(newDepartment)
    if (!key || departments.some(department => department.key === key)) {
      setError('Department key already exists or is invalid')
      return
    }
    setDepartments(currentDepartments => [
      ...currentDepartments,
      {
        key,
        label: titleCaseWords(newDepartment),
        description: '',
        is_active: true,
        display_order: currentDepartments.length,
      },
    ])
    setNewDepartment('')
    setError(null)
  }

  const removeDepartment = (key: string) => {
    if (employees.some(employee => getEmployeeScheduleDepartments(employee).includes(key))) {
      setError('Move employees off this department before removing it')
      return
    }
    setDepartments(currentDepartments => currentDepartments.filter(department => department.key !== key))
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(null)
    try {
      const res = await fetch('/api/app-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role_definitions: roles.map((role, index) => ({ ...role, display_order: index })),
          primary_department_definitions: departments.map((department, index) => ({ ...department, display_order: index })),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { settings?: AppSettings; error?: string }
      if (!res.ok || !data.settings) {
        setError(data.error ?? 'Failed to save roles and departments')
        return
      }
      setRoles(sortDefinitionsByOrder(data.settings.role_definitions))
      setDepartments(sortDefinitionsByOrder(data.settings.primary_department_definitions))
      window.dispatchEvent(new Event('app-settings-updated'))
      setSaved('Roles and departments saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6">
      <AdminSubpageHeader
        title="Roles & Departments"
        subtitle="Manage role labels and schedule department choices used across Staffing, Reporting, Schedule, and Today’s Staff."
      />

      {loading ? (
        <p className="text-muted-foreground">Loading roles and departments…</p>
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                <BriefcaseBusiness className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Roles</h2>
                <p className="text-sm text-muted-foreground">Role labels used for staff records and reporting.</p>
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border">
              <div className="grid grid-cols-[minmax(0,1fr)_32px] gap-2 bg-slate-100 px-3 py-2 text-xs font-semibold uppercase text-slate-500 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_56px_32px]">
                <span>Name</span>
                <span className="hidden sm:block">Description</span>
                <span className="hidden sm:block">Key</span>
                <span />
              </div>
              {roles.map(role => (
                <div key={role.key} className="grid grid-cols-[minmax(0,1fr)_32px] items-center gap-2 border-t px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_56px_32px]">
                  <Input className="min-w-0" value={role.label} onChange={(event) => updateRole(role.key, event.target.value)} />
                  <Input
                    className="hidden min-w-0 sm:flex"
                    value={role.description ?? ''}
                    onChange={(event) => updateRoleDescription(role.key, event.target.value)}
                    placeholder="Description"
                  />
                  <span className="hidden min-w-0 truncate font-mono text-[11px] text-slate-500 sm:block" title={role.key}>{role.key}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="justify-self-center text-red-600 hover:text-red-700"
                    disabled={role.key === 'manager'}
                    onClick={() => removeRole(role.key)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t bg-slate-50 p-3">
                <Input
                  className="min-w-0"
                  value={newRole}
                  onChange={(event) => setNewRole(event.target.value)}
                  placeholder="Add a new role name"
                />
                <Button type="button" onClick={addRole}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Role
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Schedule Departments</h2>
                <p className="text-sm text-muted-foreground">Department choices used for staff assignment and schedule tabs.</p>
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border">
              <div className="grid grid-cols-[minmax(0,1fr)_32px] gap-2 bg-slate-100 px-3 py-2 text-xs font-semibold uppercase text-slate-500 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_56px_32px]">
                <span>Name</span>
                <span className="hidden sm:block">Description</span>
                <span className="hidden sm:block">Key</span>
                <span />
              </div>
              {departments.map(department => (
                <div key={department.key} className="grid grid-cols-[minmax(0,1fr)_32px] items-center gap-2 border-t px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_56px_32px]">
                  <Input className="min-w-0" value={department.label} onChange={(event) => updateDepartment(department.key, event.target.value)} />
                  <Input
                    className="hidden min-w-0 sm:flex"
                    value={department.description ?? ''}
                    onChange={(event) => updateDepartmentDescription(department.key, event.target.value)}
                    placeholder="Description"
                  />
                  <span className="hidden min-w-0 truncate font-mono text-[11px] text-slate-500 sm:block" title={department.key}>{department.key}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="justify-self-center text-red-600 hover:text-red-700"
                    disabled={departments.length <= 1}
                    onClick={() => removeDepartment(department.key)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t bg-slate-50 p-3">
                <Input
                  className="min-w-0"
                  value={newDepartment}
                  onChange={(event) => setNewDepartment(event.target.value)}
                  placeholder="Add a new department name"
                />
                <Button type="button" onClick={addDepartment}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Department
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Staff can be assigned to more than one department from Staffing. They appear in each selected department schedule.
              </p>
            </div>
          </div>

          {(error || saved) && (
            <div className={`rounded-xl border px-3 py-2 text-sm ${error ? 'border-red-200 bg-red-50 text-red-600' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
              {error ?? saved}
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Roles & Departments'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
