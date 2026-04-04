'use client'

import { useState, useEffect, useCallback } from 'react'
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
import { Plus, Pencil, Trash2, Gift } from 'lucide-react'
import { format } from 'date-fns'
import { isBirthdayToday } from '@/lib/dateUtils'

const ROLES: EmployeeRole[] = ['manager', 'server', 'busser', 'runner', 'kitchen_staff']
const ROLE_COLORS: Record<EmployeeRole, string> = {
  manager: 'bg-purple-100 text-purple-800',
  server: 'bg-blue-100 text-blue-800',
  busser: 'bg-green-100 text-green-800',
  runner: 'bg-orange-100 text-orange-800',
  kitchen_staff: 'bg-rose-100 text-rose-800',
}

interface FormState {
  name: string
  phone: string
  email: string
  role: EmployeeRole
  hourly_wage: string
  guaranteed_hourly: string
  birth_date: string
  pin: string
}

type SortOption = 'name_asc' | 'name_desc' | 'role' | 'birthday' | 'newest'

const EMPTY_FORM: FormState = { name: '', phone: '', email: '', role: 'server', hourly_wage: '', guaranteed_hourly: '', birth_date: '', pin: '' }
const ROLE_LABELS: Record<EmployeeRole, string> = {
  manager: 'Manager',
  server: 'Server',
  busser: 'Busser',
  runner: 'Runner',
  kitchen_staff: 'Kitchen Staff',
}

export function EmployeeTable() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Employee | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [filterRole, setFilterRole] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortOption>('name_asc')

  const load = useCallback(async () => {
    const res = await fetch('/api/employees', { cache: 'no-store' })
    const data = (await res.json().catch(() => ({}))) as { employees?: Employee[]; error?: string }
    if (!res.ok) {
      setSaveError(data.error ?? 'Failed to load employees')
      setEmployees([])
      setLoading(false)
      return
    }
    setEmployees(data.employees ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const openAdd = () => {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (emp: Employee) => {
    setEditTarget(emp)
    setForm({
      name: emp.name,
      phone: emp.phone ?? '',
      email: emp.email ?? '',
      role: emp.role,
      hourly_wage: emp.hourly_wage?.toFixed(2) ?? '',
      guaranteed_hourly: emp.guaranteed_hourly?.toFixed(2) ?? '',
      birth_date: emp.birth_date ?? '',
      pin: '',
    })
    setDialogOpen(true)
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
          }),
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) { setSaveError(data.error ?? 'Failed to update employee'); return }
      } else {
        const res = await fetch('/api/employees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
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
        return ROLE_LABELS[a.role].localeCompare(ROLE_LABELS[b.role]) || a.name.localeCompare(b.name)
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
                {filterRole === 'all' ? 'All Roles' : ROLE_LABELS[filterRole as EmployeeRole]}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              {ROLES.map(r => (
                <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
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
              <TableHead>Hourly Wage</TableHead>
              <TableHead>Guaranteed / Hr</TableHead>
              <TableHead>Birthday</TableHead>
              <TableHead>PIN</TableHead>
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
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${ROLE_COLORS[emp.role]}`}>
                    {emp.role}
                  </span>
                </TableCell>
                <TableCell>{emp.phone ?? '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{emp.email ?? '—'}</TableCell>
                <TableCell>{emp.hourly_wage !== null ? `$${emp.hourly_wage.toFixed(2)}` : '—'}</TableCell>
                <TableCell>{emp.guaranteed_hourly !== null ? `$${emp.guaranteed_hourly.toFixed(2)}` : '—'}</TableCell>
                <TableCell>
                  {emp.birth_date ? format(new Date(emp.birth_date + 'T00:00:00'), 'MMM d, yyyy') : '—'}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">••••</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
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
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  No employees found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={v => { if (!v) setDialogOpen(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit Employee' : 'Add Employee'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
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
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v: string | null) => v && setForm(f => ({ ...f, role: v as EmployeeRole }))}>
                <SelectTrigger>
                  <span>{ROLE_LABELS[form.role]}</span>
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => (
                    <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Hourly Wage</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.hourly_wage}
                  onChange={e => setForm(f => ({ ...f, hourly_wage: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label>Guaranteed / Hr</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.guaranteed_hourly}
                  onChange={e => setForm(f => ({ ...f, guaranteed_hourly: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              If wages plus tips do not reach the guaranteed amount per hour, the difference is paid as a guaranteed top-up.
            </p>
            <div>
              <Label>Birth Date</Label>
              <Input type="date" value={form.birth_date} onChange={e => setForm(f => ({ ...f, birth_date: e.target.value }))} />
            </div>
            <div>
              <Label>{editTarget ? 'New PIN (4 digits, leave blank to keep current)' : 'PIN * (4 digits)'}</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={form.pin}
                onChange={e => setForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                placeholder="••••"
                className="tracking-widest text-center font-mono"
              />
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
    </div>
  )
}
