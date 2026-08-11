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
import { Plus, Pencil, Trash2, Gift, CircleDollarSign } from 'lucide-react'
import { format } from 'date-fns'
import { isBirthdayToday } from '@/lib/dateUtils'
import { getRoleColorTheme, getRoleLabel, getScheduleDepartmentBadges } from '@/lib/organization'
import { useAppSettings } from '@/components/useAppSettings'
import { getEmployeeScheduleDepartments } from '@/lib/employeeSelect'

interface FormState {
  name: string
  phone: string
  email: string
  role: EmployeeRole
  primary_department: string
  schedule_departments: string[]
  hourly_wage: string
  guaranteed_hourly: string
  tip_pool_hourly_rate: string
  payment_method: PaymentMethod | ''
  birth_date: string
  pin: string
  login_enabled: 'enabled' | 'disabled'
  login_password: string
}

interface PayFormState {
  hourly_wage: string
  guaranteed_enabled: boolean
  guaranteed_hourly: string
  tip_cap_enabled: boolean
  tip_pool_hourly_rate: string
  payment_method: PaymentMethod | ''
}

type SortOption = 'name_asc' | 'name_desc' | 'role' | 'birthday' | 'newest'
type DepartmentFilter = string

const EMPTY_FORM: FormState = { name: '', phone: '', email: '', role: 'server', primary_department: 'server', schedule_departments: ['server'], hourly_wage: '', guaranteed_hourly: '', tip_pool_hourly_rate: '', payment_method: '', birth_date: '', pin: '', login_enabled: 'disabled', login_password: '' }
const EMPTY_PAY_FORM: PayFormState = { hourly_wage: '', guaranteed_enabled: false, guaranteed_hourly: '', tip_cap_enabled: false, tip_pool_hourly_rate: '', payment_method: '' }

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
  const [payDialogOpen, setPayDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Employee | null>(null)
  const [payTarget, setPayTarget] = useState<Employee | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [payForm, setPayForm] = useState<PayFormState>(EMPTY_PAY_FORM)
  const [saving, setSaving] = useState(false)
  const [paySaving, setPaySaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [paySaveError, setPaySaveError] = useState<string | null>(null)
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
      role: emp.role,
      primary_department: scheduleDepartments[0] ?? emp.primary_department ?? 'foh',
      schedule_departments: scheduleDepartments,
      hourly_wage: emp.hourly_wage?.toFixed(2) ?? '',
      guaranteed_hourly: emp.guaranteed_hourly?.toFixed(2) ?? '',
      tip_pool_hourly_rate: emp.tip_pool_hourly_rate?.toFixed(2) ?? '',
      payment_method: emp.payment_method ?? '',
      birth_date: emp.birth_date ?? '',
      pin: emp.pin_code ?? '',
      login_enabled: emp.login_enabled ? 'enabled' : 'disabled',
      login_password: '',
    })
    setDialogOpen(true)
  }

  const openPayStructure = (emp: Employee) => {
    setPayTarget(emp)
    setPayForm({
      hourly_wage: emp.hourly_wage?.toFixed(2) ?? '',
      guaranteed_enabled: emp.guaranteed_hourly !== null,
      guaranteed_hourly: emp.guaranteed_hourly?.toFixed(2) ?? '',
      tip_cap_enabled: emp.tip_pool_hourly_rate !== null,
      tip_pool_hourly_rate: emp.tip_pool_hourly_rate?.toFixed(2) ?? '',
      payment_method: emp.payment_method ?? '',
    })
    setPaySaveError(null)
    setPayDialogOpen(true)
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
    if (!editTarget && !/^\d{4}$/.test(form.pin)) return
    if (editTarget && form.pin && !/^\d{4}$/.test(form.pin)) {
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

  const handlePaySave = async () => {
    if (!payTarget) return
    if (!payForm.payment_method) {
      setPaySaveError('Select cash, check, or ACH payment method')
      return
    }
    setPaySaving(true)
    setPaySaveError(null)
    try {
      const res = await fetch('/api/employees', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: payTarget.id,
          name: payTarget.name,
          phone: payTarget.phone ?? '',
          email: payTarget.email ?? '',
          role: payTarget.role,
          primary_department: getEmployeeScheduleDepartments(payTarget)[0] ?? payTarget.primary_department ?? 'foh',
          schedule_departments: getEmployeeScheduleDepartments(payTarget),
          birth_date: payTarget.birth_date ?? '',
          pin: '',
          login_enabled: payTarget.login_enabled === true,
          login_password: '',
          hourly_wage: payForm.hourly_wage,
          guaranteed_hourly: payForm.guaranteed_enabled ? payForm.guaranteed_hourly : '',
          tip_pool_hourly_rate: payForm.tip_cap_enabled ? payForm.tip_pool_hourly_rate : '',
          payment_method: payForm.payment_method,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setPaySaveError(data.error ?? 'Failed to update pay structure')
        return
      }
      await load()
      setPayDialogOpen(false)
      setPayTarget(null)
    } finally {
      setPaySaving(false)
    }
  }

  const handleDelete = async (emp: Employee) => {
    if (!confirm(`Remove ${emp.name}?`)) return
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
  const canSaveEmployee = Boolean(form.name.trim()) && (
    editTarget
      ? form.pin === '' || /^\d{4}$/.test(form.pin)
      : /^\d{4}$/.test(form.pin)
  ) && Boolean(form.payment_method)

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
          <div className="inline-flex h-8 overflow-hidden rounded-lg border bg-background">
            {[
              { key: 'all', label: 'All' },
              ...departmentDefinitions.map(department => ({ key: department.key, label: department.label })),
            ].map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilterDepartment(key)}
                className={`px-3 text-sm font-medium transition-colors ${
                  filterDepartment === key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Hourly Wage</TableHead>
              <TableHead>Guaranteed / Hr</TableHead>
              <TableHead>Tip Cap / Hr</TableHead>
              <TableHead>Paid By</TableHead>
              <TableHead>Birthday</TableHead>
              <TableHead>PIN</TableHead>
              <TableHead>App Login</TableHead>
              <TableHead className="w-28 min-w-28 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(emp => (
              <TableRow key={emp.id}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    {emp.name}
                    {isBirthdayToday(emp.birth_date) && (
                      <Gift className="w-4 h-4 text-pink-500" />
                    )}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={getRoleColorTheme(emp.role, roleDefinitions).badgeStyle}>
                    {getRoleLabel(emp.role, roleDefinitions)}
                  </span>
                </TableCell>
                <TableCell>{emp.phone ?? '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{emp.email ?? '—'}</TableCell>
                <TableCell>{getScheduleDepartmentBadges(emp, departmentDefinitions)}</TableCell>
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
                <TableCell>
                  <Badge variant="outline">••••</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={emp.login_enabled ? 'default' : 'outline'}>
                    {emp.login_enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </TableCell>
                <TableCell className="w-28 min-w-28 pr-2">
                  <div className="grid grid-cols-3 justify-end gap-1">
                    <Button size="icon-sm" variant="ghost" className="h-7 w-7" onClick={() => openPayStructure(emp)} title="Pay structure">
                      <CircleDollarSign className="w-4 h-4" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" className="h-7 w-7" onClick={() => openEdit(emp)} title="Edit employee">
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700" onClick={() => handleDelete(emp)} title="Delete employee">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={13} className="text-center text-muted-foreground py-8">
                  No employees found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={v => { if (!v) setDialogOpen(false) }}>
        <DialogContent className="flex max-h-[90vh] max-w-md flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit Employee' : 'Add Employee'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto pr-1">
            <div>
              <Label>Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 000-0000" />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="name@email.com" />
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
                <Label>App Login</Label>
                <Select value={form.login_enabled} onValueChange={(v: string | null) => v && setForm(f => ({ ...f, login_enabled: v as 'enabled' | 'disabled' }))}>
                  <SelectTrigger>
                    <span>{form.login_enabled === 'enabled' ? 'Enabled' : 'Disabled'}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="disabled">Disabled</SelectItem>
                    <SelectItem value="enabled">Enabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{editTarget ? 'Reset Login Password' : 'Login Password'}</Label>
                <Input
                  type="password"
                  value={form.login_password}
                  onChange={e => setForm(f => ({ ...f, login_password: e.target.value }))}
                  placeholder={editTarget ? 'Leave blank to keep current' : 'At least 8 chars'}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Enable app login for people who should sign into the web app with email and password. Managers who sign in this way also unlock Admin Board access.
            </p>
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
              <Label>Birth Date</Label>
              <Input type="date" value={form.birth_date} onChange={e => setForm(f => ({ ...f, birth_date: e.target.value }))} />
            </div>
            <div>
              <Label>{editTarget ? 'PIN (4 digits)' : 'PIN * (4 digits)'}</Label>
              <Input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={form.pin}
                onChange={e => setForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                placeholder="1234"
                className="tracking-widest text-center font-mono"
              />
              {editTarget && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {editTarget.pin_code
                    ? 'This PIN is used for clock-in and must be unique.'
                    : 'This employee was saved before visible PINs. Enter a 4-digit PIN to keep it visible going forward.'}
                </p>
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

      <Dialog open={payDialogOpen} onOpenChange={v => { if (!v) setPayDialogOpen(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pay Structure{payTarget ? ` - ${payTarget.name}` : ''}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Paid By *</Label>
              <Select value={payForm.payment_method || undefined} onValueChange={(v: string | null) => v && setPayForm(f => ({ ...f, payment_method: v as PaymentMethod }))}>
                <SelectTrigger>
                  <span className={payForm.payment_method ? '' : 'text-muted-foreground'}>{getPaymentMethodLabel(payForm.payment_method || null)}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="ach">ACH</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">Required before saving staffing and payroll details.</p>
            </div>
            <div>
              <Label>Hourly Wage</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={payForm.hourly_wage}
                onChange={e => setPayForm(f => ({ ...f, hourly_wage: e.target.value }))}
                placeholder="0.00"
              />
              <p className="mt-1 text-xs text-muted-foreground">Base hourly wage used for wage and earnings reports.</p>
            </div>

            <ToggleRow
              checked={payForm.guaranteed_enabled}
              onCheckedChange={checked => setPayForm(f => ({ ...f, guaranteed_enabled: checked }))}
              label="Guaranteed Pay"
              description="Minimum hourly pay target for tip-share earnings. When off, no guaranteed top-up is calculated."
            >
              <Label>Guaranteed / Hr</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={payForm.guaranteed_hourly}
                onChange={e => setPayForm(f => ({ ...f, guaranteed_hourly: e.target.value }))}
                placeholder="0.00"
              />
            </ToggleRow>

            <ToggleRow
              checked={payForm.tip_cap_enabled}
              onCheckedChange={checked => setPayForm(f => ({ ...f, tip_cap_enabled: checked }))}
              label="Tip Cap"
              description="Maximum tip-share payout per worked hour. When off, tips are shared by hours without a ceiling."
            >
              <Label>Tip Cap / Hr</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={payForm.tip_pool_hourly_rate}
                onChange={e => setPayForm(f => ({ ...f, tip_pool_hourly_rate: e.target.value }))}
                placeholder="0.00"
              />
            </ToggleRow>

            {paySaveError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {paySaveError}
              </p>
            )}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => { setPayDialogOpen(false); setPaySaveError(null) }}>Cancel</Button>
              <Button className="flex-1" onClick={handlePaySave} disabled={paySaving}>
                {paySaving ? 'Saving…' : 'Save Pay Structure'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
