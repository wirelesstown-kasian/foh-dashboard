'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { Employee, EmployeeRole, PaymentMethod } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Archive, Plus, Pencil, Gift } from 'lucide-react'
import { format } from 'date-fns'
import { isBirthdayToday } from '@/lib/dateUtils'
import { getRoleColorTheme, getRoleLabel } from '@/lib/organization'
import { useAppSettings } from '@/components/useAppSettings'
import { getEmployeeScheduleDepartments } from '@/lib/employeeSelect'

interface FormState {
  name: string
  phone: string
  email: string
  address: string
  role: EmployeeRole
  primary_department: string
  schedule_departments: string[]
  hourly_wage: string
  tip_cap_enabled: boolean
  guaranteed_hourly: string
  guaranteed_enabled: boolean
  tip_pool_hourly_rate: string
  commission_enabled: boolean
  commission_note: string
  payment_method: PaymentMethod | ''
  birth_date: string
  pin: string
  login_enabled: 'enabled' | 'disabled'
  login_password: string
}

type SortOption = 'name_asc' | 'name_desc' | 'role' | 'birthday' | 'newest'
type DepartmentFilter = string

const EMPTY_FORM: FormState = {
  name: '',
  phone: '',
  email: '',
  address: '',
  role: 'server',
  primary_department: 'server',
  schedule_departments: ['server'],
  hourly_wage: '',
  tip_cap_enabled: false,
  guaranteed_hourly: '',
  guaranteed_enabled: false,
  tip_pool_hourly_rate: '',
  commission_enabled: false,
  commission_note: '',
  payment_method: '',
  birth_date: '',
  pin: '',
  login_enabled: 'disabled',
  login_password: '',
}

function getPaymentMethodLabel(paymentMethod: PaymentMethod | null | undefined) {
  if (paymentMethod === 'ach') return 'ACH'
  if (paymentMethod === 'check') return 'Check'
  if (paymentMethod === 'cash') return 'Cash'
  return 'Select'
}

function formatPay(value: number | null) {
  return value !== null ? `$${value.toFixed(2)}` : '—'
}

function ToggleRow({
  checked,
  onCheckedChange,
  label,
  description,
  children,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="rounded-lg border bg-background px-3 py-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label className="text-sm font-medium">{label}</Label>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onCheckedChange(!checked)}
          className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors ${
            checked ? 'border-primary bg-primary' : 'border-input bg-muted'
          }`}
        >
          <span
            className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform ${
              checked ? 'left-5' : 'left-0.5'
            }`}
          />
          <span className="sr-only">{checked ? `Disable ${label}` : `Enable ${label}`}</span>
        </button>
      </div>
      {checked && <div className="mt-3">{children}</div>}
    </div>
  )
}

export function EmployeeTable() {
  const { roleDefinitions, departmentDefinitions } = useAppSettings()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Employee | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [resetPinMode, setResetPinMode] = useState(false)
  const [filterRole, setFilterRole] = useState<string>('all')
  const [filterDepartment, setFilterDepartment] = useState<DepartmentFilter>('all')
  const [sortBy, setSortBy] = useState<SortOption>('name_asc')

  const load = useCallback(async () => {
    const employeesRes = await fetch('/api/employees', { cache: 'no-store' })
    const employeeData = (await employeesRes.json().catch(() => ({}))) as { employees?: Employee[]; error?: string }
    if (!employeesRes.ok) {
      setSaveError(employeeData.error ?? 'Failed to load employees')
      setEmployees([])
      setLoading(false)
      return
    }
    setEmployees(employeeData.employees ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const openAdd = () => {
    const firstDepartment = departmentDefinitions.find(department => department.key === 'server')?.key ?? departmentDefinitions[0]?.key ?? 'server'
    setEditTarget(null)
    setResetPinMode(true)
    setForm({ ...EMPTY_FORM, primary_department: firstDepartment, schedule_departments: [firstDepartment] })
    setDialogOpen(true)
  }

  const openEdit = (emp: Employee) => {
    const scheduleDepartments = getEmployeeScheduleDepartments(emp)
    setEditTarget(emp)
    setForm({
      name: emp.name,
      phone: emp.phone ?? '',
      email: emp.email ?? '',
      address: emp.address ?? '',
      role: emp.role,
      primary_department: scheduleDepartments[0] ?? emp.primary_department ?? 'foh',
      schedule_departments: scheduleDepartments,
      hourly_wage: emp.hourly_wage?.toFixed(2) ?? '',
      tip_cap_enabled: emp.tip_pool_hourly_rate !== null,
      guaranteed_hourly: emp.guaranteed_hourly?.toFixed(2) ?? '',
      guaranteed_enabled: emp.guaranteed_hourly !== null,
      tip_pool_hourly_rate: emp.tip_pool_hourly_rate?.toFixed(2) ?? '',
      commission_enabled: emp.commission_enabled === true,
      commission_note: emp.commission_note ?? '',
      payment_method: emp.payment_method ?? '',
      birth_date: emp.birth_date ?? '',
      pin: '',
      login_enabled: emp.login_enabled ? 'enabled' : 'disabled',
      login_password: '',
    })
    setResetPinMode(false)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    if (form.schedule_departments.length === 0) {
      setSaveError('Select at least one schedule department')
      return
    }
    if (!form.payment_method) {
      setSaveError('Select cash, check, or ACH payment method')
      return
    }
    if (form.tip_cap_enabled && !form.tip_pool_hourly_rate.trim()) {
      setSaveError('Tip cap amount is required when Tip Cap is on')
      return
    }
    if (form.guaranteed_enabled && !form.guaranteed_hourly.trim()) {
      setSaveError('Guaranteed pay amount is required when Guaranteed Pay is on')
      return
    }
    if (form.commission_enabled && !form.commission_note.trim()) {
      setSaveError('Commission note is required when Commission is on')
      return
    }
    if ((!editTarget || resetPinMode) && !/^\d{4}$/.test(form.pin)) {
      setSaveError('PIN must be 4 digits')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      if (editTarget) {
        const res = await fetch('/api/employees', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editTarget.id,
            ...form,
            primary_department: form.schedule_departments[0] ?? form.primary_department,
            guaranteed_hourly: form.guaranteed_enabled ? form.guaranteed_hourly : '',
            tip_pool_hourly_rate: form.tip_cap_enabled ? form.tip_pool_hourly_rate : '',
            pin: resetPinMode ? form.pin : '',
            login_enabled: form.login_enabled === 'enabled',
          }),
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) { setSaveError(data.error ?? 'Failed to update employee'); return }
      } else {
        const res = await fetch('/api/employees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...form,
            primary_department: form.schedule_departments[0] ?? form.primary_department,
            guaranteed_hourly: form.guaranteed_enabled ? form.guaranteed_hourly : '',
            tip_pool_hourly_rate: form.tip_cap_enabled ? form.tip_pool_hourly_rate : '',
            login_enabled: form.login_enabled === 'enabled',
          }),
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) { setSaveError(data.error ?? 'Failed to create employee'); return }
      }
      await load()
      setDialogOpen(false)
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = async (emp: Employee) => {
    if (!confirm(`Archive ${emp.name}? Financial history will be kept.`)) return
    await fetch(`/api/employees?id=${encodeURIComponent(emp.id)}`, { method: 'DELETE' })
    await load()
  }

  const filtered = employees.filter(employee => {
    const roleMatches = filterRole === 'all' || employee.role === filterRole
    const departmentMatches = filterDepartment === 'all' || getEmployeeScheduleDepartments(employee).includes(filterDepartment)
    return roleMatches && departmentMatches
  })
  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'name_desc':
        return b.name.localeCompare(a.name)
      case 'role':
        return getRoleLabel(a.role, roleDefinitions).localeCompare(getRoleLabel(b.role, roleDefinitions)) || a.name.localeCompare(b.name)
      case 'birthday': {
        const aValue = a.birth_date ?? '9999-12-31'
        const bValue = b.birth_date ?? '9999-12-31'
        return aValue.localeCompare(bValue) || a.name.localeCompare(b.name)
      }
      case 'newest':
        return b.created_at.localeCompare(a.created_at)
      case 'name_asc':
      default:
        return a.name.localeCompare(b.name)
    }
  })
  const canSaveEmployee = Boolean(form.name.trim()) &&
    (!editTarget || !resetPinMode || /^\d{4}$/.test(form.pin)) &&
    (Boolean(editTarget) || /^\d{4}$/.test(form.pin)) &&
    Boolean(form.payment_method) &&
    (!form.tip_cap_enabled || Boolean(form.tip_pool_hourly_rate.trim())) &&
    (!form.guaranteed_enabled || Boolean(form.guaranteed_hourly.trim())) &&
    (!form.commission_enabled || Boolean(form.commission_note.trim()))

  const toggleScheduleDepartment = (department: string) => {
    setForm(currentForm => {
      const hasDepartment = currentForm.schedule_departments.includes(department)
      const nextDepartments = hasDepartment
        ? currentForm.schedule_departments.filter(item => item !== department)
        : [...currentForm.schedule_departments, department]
      const normalizedDepartments = nextDepartments.length > 0 ? nextDepartments : currentForm.schedule_departments
      return {
        ...currentForm,
        schedule_departments: normalizedDepartments,
        primary_department: normalizedDepartments[0] ?? currentForm.primary_department,
      }
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div />
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Select value={filterDepartment} onValueChange={(v: string | null) => v && setFilterDepartment(v)}>
            <SelectTrigger className="w-36">
              <span className={filterDepartment === 'all' ? 'text-muted-foreground' : ''}>
                {filterDepartment === 'all'
                  ? 'All Dept.'
                  : departmentDefinitions.find(department => department.key === filterDepartment)?.label ?? filterDepartment}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departmentDefinitions.map(department => (
                <SelectItem key={department.key} value={department.key}>{department.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterRole} onValueChange={(v: string | null) => v && setFilterRole(v)}>
            <SelectTrigger className="w-36">
              <span className={filterRole === 'all' ? 'text-muted-foreground' : ''}>
                {filterRole === 'all' ? 'All Roles' : getRoleLabel(filterRole, roleDefinitions)}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              {roleDefinitions.map(r => (
                <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v: string | null) => v && setSortBy(v as SortOption)}>
            <SelectTrigger className="w-40">
              <span>
                {sortBy === 'name_asc' && 'Name A-Z'}
                {sortBy === 'name_desc' && 'Name Z-A'}
                {sortBy === 'role' && 'Role'}
                {sortBy === 'birthday' && 'Birthday'}
                {sortBy === 'newest' && 'Newest'}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name_asc">Name A-Z</SelectItem>
              <SelectItem value="name_desc">Name Z-A</SelectItem>
              <SelectItem value="role">Role</SelectItem>
              <SelectItem value="birthday">Birthday</SelectItem>
              <SelectItem value="newest">Newest</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={openAdd}>
            <Plus className="w-4 h-4 mr-2" /> Add Employee
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <Table className="min-w-[900px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Name</TableHead>
              <TableHead className="w-24">Role</TableHead>
              <TableHead className="w-28">Phone</TableHead>
              <TableHead className="w-36">Email</TableHead>
              <TableHead className="w-24">Hourly</TableHead>
              <TableHead className="w-28">Guaranteed</TableHead>
              <TableHead className="w-24">Tip Cap</TableHead>
              <TableHead className="w-20">Payroll</TableHead>
              <TableHead className="w-28">Birthday</TableHead>
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(emp => (
                <TableRow key={emp.id}>
                  <TableCell className="font-medium">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{emp.name}</span>
                      {isBirthdayToday(emp.birth_date) && (
                        <Gift className="w-4 h-4 shrink-0 text-pink-500" />
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={getRoleColorTheme(emp.role, roleDefinitions).badgeStyle}>
                      {getRoleLabel(emp.role, roleDefinitions)}
                    </span>
                  </TableCell>
                  <TableCell className="truncate">{emp.phone ?? '—'}</TableCell>
                  <TableCell className="truncate text-xs text-muted-foreground">{emp.email ?? '—'}</TableCell>
                  <TableCell>{formatPay(emp.hourly_wage)}</TableCell>
                  <TableCell>{emp.guaranteed_hourly !== null ? `${formatPay(emp.guaranteed_hourly)} on` : 'Off'}</TableCell>
                  <TableCell>{emp.tip_pool_hourly_rate !== null ? `${formatPay(emp.tip_pool_hourly_rate)} on` : 'Off'}</TableCell>
                  <TableCell>
                    <Badge variant={emp.payment_method ? 'outline' : 'destructive'}>
                      {getPaymentMethodLabel(emp.payment_method)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {emp.birth_date ? format(new Date(emp.birth_date + 'T00:00:00'), 'MMM d, yyyy') : '—'}
                  </TableCell>
                  <TableCell className="w-20 pr-2">
                    <div className="grid grid-cols-2 justify-end gap-1">
                      <Button size="icon-sm" variant="ghost" className="h-7 w-7" onClick={() => openEdit(emp)} title="Edit employee">
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700" onClick={() => handleArchive(emp)} title="Archive employee">
                        <Archive className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
            ))}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                  No employees found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={v => { if (!v) setDialogOpen(false) }}>
        <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit Employee' : 'Add Employee'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto pr-1">
            <div>
              <Label>Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" />
            </div>
            <div>
              <Label>Phone Number</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 000-0000" />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="name@email.com" />
            </div>
            <div>
              <Label>Address</Label>
              <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Street, city, state" />
            </div>
            <div>
              <Label>Birthday</Label>
              <Input type="date" value={form.birth_date} onChange={e => setForm(f => ({ ...f, birth_date: e.target.value }))} />
            </div>
            <div>
              <Label>Schedule Departments</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {departmentDefinitions.map(definition => {
                  const checked = form.schedule_departments.includes(definition.key)
                  return (
                    <button
                      key={definition.key}
                      type="button"
                      onClick={() => toggleScheduleDepartment(definition.key)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        checked
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                      }`}
                    >
                      <span className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
                        checked ? 'border-white bg-white text-slate-900' : 'border-slate-300 bg-white text-transparent'
                      }`}>
                        x
                      </span>
                      <span className="font-medium">{definition.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v: string | null) => v && setForm(f => ({ ...f, role: v as EmployeeRole }))}>
                  <SelectTrigger>
                    <span>{getRoleLabel(form.role, roleDefinitions)}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {roleDefinitions.map(r => (
                      <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Paid By *</Label>
                <Select value={form.payment_method || undefined} onValueChange={(v: string | null) => v && setForm(f => ({ ...f, payment_method: v as PaymentMethod }))}>
                  <SelectTrigger>
                    <span className={form.payment_method ? '' : 'text-muted-foreground'}>{getPaymentMethodLabel(form.payment_method || null)}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="ach">ACH</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <ToggleRow
                checked={form.tip_cap_enabled}
                onCheckedChange={checked => setForm(f => ({ ...f, tip_cap_enabled: checked, tip_pool_hourly_rate: checked ? f.tip_pool_hourly_rate : '' }))}
                label="Tip Cap"
                description="Cap tip payout per hour."
              >
                <Label>Dollar Amount *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.tip_pool_hourly_rate}
                  onChange={e => setForm(f => ({ ...f, tip_pool_hourly_rate: e.target.value }))}
                  placeholder="0.00"
                />
              </ToggleRow>

              <ToggleRow
                checked={form.guaranteed_enabled}
                onCheckedChange={checked => setForm(f => ({ ...f, guaranteed_enabled: checked, guaranteed_hourly: checked ? f.guaranteed_hourly : '' }))}
                label="Guaranteed Pay"
                description="Minimum hourly target."
              >
                <Label>Dollar Amount *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.guaranteed_hourly}
                  onChange={e => setForm(f => ({ ...f, guaranteed_hourly: e.target.value }))}
                  placeholder="0.00"
                />
              </ToggleRow>

              <ToggleRow
                checked={form.commission_enabled}
                onCheckedChange={checked => setForm(f => ({ ...f, commission_enabled: checked, commission_note: checked ? f.commission_note : '' }))}
                label="Commission"
                description="Requires a note."
              >
                <Label>Commission Note *</Label>
                <Input
                  value={form.commission_note}
                  onChange={e => setForm(f => ({ ...f, commission_note: e.target.value }))}
                  placeholder="Commission detail"
                />
              </ToggleRow>
            </div>

            <div>
              <Label>Hourly Wage</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.hourly_wage}
                onChange={e => setForm(f => ({ ...f, hourly_wage: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <Label>PIN</Label>
                {editTarget && !resetPinMode && (
                  <Button type="button" variant="outline" size="sm" onClick={() => { setResetPinMode(true); setForm(f => ({ ...f, pin: '' })) }}>
                    Reset PIN
                  </Button>
                )}
              </div>
              {editTarget && !resetPinMode ? (
                <div className="rounded-lg border bg-slate-50 px-3 py-2 font-mono text-sm tracking-widest text-slate-700">
                  {editTarget.pin_code ?? 'Current PIN hidden'}
                </div>
              ) : (
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={form.pin}
                  onChange={e => setForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                  placeholder="1234"
                  className="tracking-widest text-center font-mono"
                />
              )}
            </div>
            {saveError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {saveError}
              </p>
            )}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => { setDialogOpen(false); setSaveError(null) }}>Cancel</Button>
              <Button
                className="flex-1"
                onClick={handleSave}
                disabled={saving || !canSaveEmployee}
              >
                {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Add Employee'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  )
}
