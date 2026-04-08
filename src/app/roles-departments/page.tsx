'use client'

import { useEffect, useState } from 'react'
import { Building2, BriefcaseBusiness, Plus, Trash2 } from 'lucide-react'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AppSettings, DepartmentDefinition, RoleDefinition } from '@/lib/appSettings'
import { getRoleDotStyle, sortDefinitionsByOrder, titleCaseWords } from '@/lib/organization'
import { Employee } from '@/lib/types'

const DEFAULT_ROLES: RoleDefinition[] = [
  { key: 'manager', label: 'Manager', description: 'Admin access and oversight', color: '#8b5cf6', is_active: true, display_order: 0 },
  { key: 'server', label: 'Server', description: 'Guest-facing service and table management', color: '#0ea5e9', is_active: true, display_order: 1 },
  { key: 'busser', label: 'Busser', description: 'Table reset and dining room support', color: '#10b981', is_active: true, display_order: 2 },
  { key: 'runner', label: 'Runner', description: 'Food running and service support', color: '#f59e0b', is_active: true, display_order: 3 },
  { key: 'kitchen_staff', label: 'Kitchen Staff', description: 'Back-of-house prep and line work', color: '#f43f5e', is_active: true, display_order: 4 },
]

const DEFAULT_DEPARTMENTS: DepartmentDefinition[] = [
  { key: 'foh', label: 'FOH', description: 'Front-of-house staff and service floor', is_active: true, display_order: 0 },
  { key: 'boh', label: 'BOH', description: 'Back-of-house kitchen operations', is_active: true, display_order: 1 },
  { key: 'hybrid', label: 'Hybrid', description: 'Floats across both FOH and BOH', is_active: true, display_order: 2 },
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

  const updateRoleColor = (key: string, color: string) => {
    setRoles(currentRoles => currentRoles.map(role => (
      role.key === key ? { ...role, color } : role
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
        subtitle="Manage role labels and the primary department choices used across Staffing, Reporting, Schedule, and Today’s Staff."
      />

      {loading ? (
        <p className="text-muted-foreground">Loading roles and departments…</p>
      ) : (
        <div className="space-y-6">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                <BriefcaseBusiness className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Roles</h2>
                <p className="text-sm text-muted-foreground">Change the role name, write a description, and pick the color used across schedule and staffing views.</p>
              </div>
            </div>
            <div className="space-y-3">
              {roles.map(role => (
                <div key={role.key} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                        <div>
                          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Name</p>
                          <Input value={role.label} onChange={(event) => updateRole(role.key, event.target.value)} />
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Color</p>
                          <div className="flex items-center gap-3 rounded-lg border bg-white px-3 py-2">
                            <input
                              type="color"
                              value={role.color ?? '#64748b'}
                              onChange={(event) => updateRoleColor(role.key, event.target.value)}
                              className="h-9 w-12 cursor-pointer rounded border border-slate-200 bg-transparent"
                            />
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-3 w-3 rounded-full" style={getRoleDotStyle(role.key, roles)} />
                              <span className="font-mono text-sm text-slate-600">{role.color ?? '#64748b'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Description</p>
                        <Input
                          value={role.description ?? ''}
                          onChange={(event) => updateRoleDescription(role.key, event.target.value)}
                          placeholder="What this role is responsible for"
                        />
                      </div>
                      <div className="rounded-lg border bg-white px-3 py-2 text-sm text-slate-600">
                        <span className="font-semibold text-slate-800">System key:</span> {role.key}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-red-600 hover:text-red-700"
                      disabled={role.key === 'manager'}
                      onClick={() => removeRole(role.key)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 pt-2">
                <Input
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

          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Primary Departments</h2>
                <p className="text-sm text-muted-foreground">Change the department name and description used throughout staffing and scheduling.</p>
              </div>
            </div>
            <div className="space-y-3">
              {departments.map(department => (
                <div key={department.key} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="space-y-3">
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Name</p>
                      <Input value={department.label} onChange={(event) => updateDepartment(department.key, event.target.value)} />
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Description</p>
                      <Input
                        value={department.description ?? ''}
                        onChange={(event) => updateDepartmentDescription(department.key, event.target.value)}
                        placeholder="What this department covers"
                      />
                    </div>
                    <div className="rounded-lg border bg-white px-3 py-2 text-sm text-slate-600">
                      <span className="font-semibold text-slate-800">System key:</span> {department.key}
                    </div>
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 pt-2">
                <Input
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
                `foh` and `boh` keep the operational tabs consistent. `hybrid` lets a person appear as a fallback in both schedule filters while still being grouped cleanly on the dashboard.
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
