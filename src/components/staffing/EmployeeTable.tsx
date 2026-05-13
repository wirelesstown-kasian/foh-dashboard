'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { Employee, EmployeeRole } from '@/lib/types'
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
import { getDepartmentLabel, getPrimaryDepartmentBadge, getRoleColorTheme, getRoleLabel } from '@/lib/organization'
import { useAppSettings } from '@/components/useAppSettings'

interface FormState {
  name: string
  phone: string
  email: string
  role: EmployeeRole
  primary_department: string
  hourly_wage: string
  guaranteed_hourly: string
  tip_pool_hourly_rate: string
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
}

type SortOption = 'name_asc' | 'name_desc' | 'role' | 'birthday' | 'newest'

const EMPTY_FORM: FormState = { name: '', phone: '', email: '', role: 'server', primary_department: 'foh', hourly_wage: '', guaranteed_hourly: '', tip_pool_hourly_rate: '', birth_date: '', pin: '', login_enabled: 'disabled', login_password: '' }
const EMPTY_PAY_FORM: PayFormState = { hourly_wage: '', guaranteed_enabled: false, guaranteed_hourly: '', tip_cap_enabled: false, tip_pool_hourly_rate: '' }

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
    setEditTarget(null)
    setForm({ ...EMPTY_FORM })
    setDialogOpen(true)
  }

  const openEdit = (emp: Employee) => {
    setEditTarget(emp)
    setForm({
      name: emp.name,
      phone: emp.phone ?? '',
      email: emp.email ?? '',
      role: emp.role,
      primary_department: emp.primary_department ?? 'foh',
      hourly_wage: emp.hourly_wage?.toFixed(2) ?? '',
      guaranteed_hourly: emp.guaranteed_hourly?.toFixed(2) ?? '',
      tip_pool_hourly_rate: emp.tip_pool_hourly_rate?.toFixed(2) ?? '',
      birth_date: emp.birth_date ?? '',
      pin: '',
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
    })
    setPaySaveError(null)
    setPayDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    if (!editTarget && !/^\d{4}$/.test(form.pin)) return
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
          primary_department: payTarget.primary_department ?? 'foh',
          birth_date: payTarget.birth_date ?? '',
          pin: '',
          login_enabled: payTarget.login_enabled === true,
          login_password: '',
          hourly_wage: payForm.hourly_wage,
          guaranteed_hourly: payForm.guaranteed_enabled ? payForm.guaranteed_hourly : '',
          tip_pool_hourly_rate: payForm.tip_cap_enabled ? payForm.tip_pool_hourly_rate : '',
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

  const filtered = filterRole === 'all' ? employees : employees.filter(e => e.role === filterRole)
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

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div />
        <div className="flex items-center gap-3">
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
              <TableHead>Birthday</TableHead>
              <TableHead>PIN</TableHead>
              <TableHead>App Login</TableHead>
              <TableHead className="w-24">Actions</TableHead>
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
                <TableCell>{getPrimaryDepartmentBadge(emp.primary_department, departmentDefinitions)}</TableCell>
                <TableCell>{formatPay(emp.hourly_wage)}</TableCell>
                <TableCell>{emp.guaranteed_hourly !== null ? `${formatPay(emp.guaranteed_hourly)} on` : 'Off'}</TableCell>
                <TableCell>{emp.tip_pool_hourly_rate !== null ? `${formatPay(emp.tip_pool_hourly_rate)} on` : 'Off'}</TableCell>
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
                <TableCell>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => openPayStructure(emp)} title="Pay structure">
                      <CircleDollarSign className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(emp)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => handleDelete(emp)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
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
              <Label>Primary Department</Label>
              <Select value={form.primary_department} onValueChange={(v: string | null) => v && setForm(f => ({ ...f, primary_department: v }))}>
                <SelectTrigger>
                  <span>{getDepartmentLabel(form.primary_department, departmentDefinitions)}</span>
                </SelectTrigger>
                <SelectContent>
                  {departmentDefinitions.map(definition => (
                    <SelectItem key={definition.key} value={definition.key}>{definition.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Label>{editTarget ? 'New PIN (4 digits, leave blank to keep current)' : 'PIN * (4 digits)'}</Label>
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
                  Current PIN is stored securely and can&apos;t be viewed. Enter a new 4-digit PIN here to replace it.
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
                disabled={saving || !form.name.trim() || (!editTarget && !/^\d{4}$/.test(form.pin))}
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
