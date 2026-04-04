'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { TaskCategory, Task, TaskType } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react'

const TYPE_OPTIONS: { value: TaskType; label: string }[] = [
  { value: 'pre_shift', label: 'Pre-Shift' },
  { value: 'operation', label: 'Operations' },
  { value: 'closing', label: 'Closing' },
  { value: 'custom', label: 'Custom' },
]
const TYPE_COLORS: Record<TaskType, string> = {
  pre_shift: 'bg-blue-100 text-blue-800',
  operation: 'bg-green-100 text-green-800',
  closing: 'bg-orange-100 text-orange-800',
  custom: 'bg-purple-100 text-purple-800',
}
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const isSystemClockTask = (task: Task) => {
  const title = task.title.trim().toLowerCase()
  return title === 'clock in' || title === 'clock out'
}

function normalizeDays(days: unknown): number[] | null {
  if (days == null) return null

  let values: unknown[] = []
  if (Array.isArray(days)) {
    values = days
  } else if (typeof days === 'string') {
    const trimmed = days.trim()
    if (!trimmed) return null

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      values = trimmed.slice(1, -1).split(',').map(value => value.trim()).filter(Boolean)
    } else if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        values = Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        values = trimmed.split(',').map(value => value.trim()).filter(Boolean)
      }
    } else {
      values = trimmed.split(',').map(value => value.trim()).filter(Boolean)
    }
  } else {
    values = [days]
  }

  const normalized = values
    .map(day => Number(day))
    .filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
  return normalized.length > 0 ? normalized : null
}

export function TaskCategoryEditor() {
  const [categories, setCategories] = useState<TaskCategory[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [missingDaysColumn, setMissingDaysColumn] = useState(false)

  // Category dialog
  const [catDialog, setCatDialog] = useState(false)
  const [catEdit, setCatEdit] = useState<TaskCategory | null>(null)
  const [catForm, setCatForm] = useState({ name: '', type: 'pre_shift' as TaskType, deadline_time: '' })

  // Task dialog
  const [taskDialog, setTaskDialog] = useState(false)
  const [taskEdit, setTaskEdit] = useState<Task | null>(null)
  const [taskCatId, setTaskCatId] = useState<string>('')
  const [taskForm, setTaskForm] = useState({ title: '', deadline_time: '', days_of_week: null as number[] | null })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const [catRes, taskRes] = await Promise.all([
      supabase.from('task_categories').select('*').eq('is_active', true).order('display_order'),
      supabase.from('tasks').select('*').eq('is_active', true).order('display_order'),
    ])
    setErrorMessage(null)
    const loadedCategories = catRes.data ?? []
    const loadedTasks = (taskRes.data ?? []).filter(task => !isSystemClockTask(task))

    setCategories(loadedCategories)
    setTasks(loadedTasks)
    const firstTask = loadedTasks[0]
    setMissingDaysColumn(!!firstTask && !Object.prototype.hasOwnProperty.call(firstTask, 'days_of_week'))
    setLoading(false)
  }, [])

  useEffect(() => {
    let mounted = true

    void (async () => {
      if (!mounted) return
      await load()
    })()

    return () => {
      mounted = false
    }
  }, [load])

  const toggleExpand = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })

  const openAddCat = () => {
    setCatEdit(null)
    setCatForm({ name: '', type: 'pre_shift', deadline_time: '' })
    setCatDialog(true)
  }

  const openEditCat = (cat: TaskCategory) => {
    setCatEdit(cat)
    setCatForm({ name: cat.name, type: cat.type, deadline_time: cat.deadline_time?.slice(0, 5) ?? '' })
    setCatDialog(true)
  }

  const saveCat = async () => {
    if (!catForm.name.trim()) return
    setSaving(true)
    setErrorMessage(null)
    const payload = {
      name: catForm.name.trim(),
      type: catForm.type,
      deadline_time: catForm.deadline_time ? catForm.deadline_time + ':00' : null,
    }
    if (catEdit) {
      const result = await supabase.from('task_categories').update(payload).eq('id', catEdit.id)
      if (result.error) {
        setErrorMessage(result.error.message)
        setSaving(false)
        return
      }
    } else {
      const maxOrder = Math.max(0, ...categories.map(c => c.display_order))
      const result = await supabase.from('task_categories').insert({ ...payload, display_order: maxOrder + 1 })
      if (result.error) {
        setErrorMessage(result.error.message)
        setSaving(false)
        return
      }
    }
    await load()
    setCatDialog(false)
    setSaving(false)
  }

  const deleteCat = async (cat: TaskCategory) => {
    if (!confirm(`Delete "${cat.name}" and all its tasks?`)) return
    await supabase.from('task_categories').update({ is_active: false }).eq('id', cat.id)
    await load()
  }

  const openAddTask = (categoryId: string) => {
    setTaskEdit(null)
    setTaskCatId(categoryId)
    setTaskForm({ title: '', deadline_time: '', days_of_week: null })
    setTaskDialog(true)
  }

  const openEditTask = (task: Task) => {
    setTaskEdit(task)
    setTaskCatId(task.category_id)
    setTaskForm({
      title: task.title,
      deadline_time: task.deadline_time?.slice(0, 5) ?? '',
      days_of_week: normalizeDays(task.days_of_week),
    })
    setTaskDialog(true)
  }

  const saveTask = async () => {
    if (!taskForm.title.trim()) return
    setSaving(true)
    setErrorMessage(null)
    const payload = {
      title: taskForm.title.trim(),
      deadline_time: taskForm.deadline_time ? taskForm.deadline_time + ':00' : null,
      days_of_week: normalizeDays(taskForm.days_of_week),
    }
    if (taskEdit) {
      const result = await supabase.from('tasks').update(payload).eq('id', taskEdit.id)
      if (result.error) {
        setErrorMessage(result.error.message)
        setSaving(false)
        return
      }
    } else {
      const catTasks = tasks.filter(t => t.category_id === taskCatId)
      const maxOrder = Math.max(0, ...catTasks.map(t => t.display_order))
      const result = await supabase.from('tasks').insert({ ...payload, category_id: taskCatId, display_order: maxOrder + 1 })
      if (result.error) {
        setErrorMessage(result.error.message)
        setSaving(false)
        return
      }
    }
    await load()
    setTaskDialog(false)
    setSaving(false)
  }

  const deleteTask = async (task: Task) => {
    if (!confirm(`Delete task "${task.title}"?`)) return
    await supabase.from('tasks').update({ is_active: false }).eq('id', task.id)
    await load()
  }

  const moveTask = async (task: Task, direction: 'up' | 'down') => {
    const catTasks = tasks.filter(t => t.category_id === task.category_id).sort((a, b) => a.display_order - b.display_order)
    const idx = catTasks.findIndex(t => t.id === task.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= catTasks.length) return
    const other = catTasks[swapIdx]
    await Promise.all([
      supabase.from('tasks').update({ display_order: other.display_order }).eq('id', task.id),
      supabase.from('tasks').update({ display_order: task.display_order }).eq('id', other.id),
    ])
    await load()
  }

  const sortTasksForOverview = (a: Task, b: Task) => {
    const aCategory = categories.find(category => category.id === a.category_id)
    const bCategory = categories.find(category => category.id === b.category_id)
    if ((aCategory?.display_order ?? 0) !== (bCategory?.display_order ?? 0)) {
      return (aCategory?.display_order ?? 0) - (bCategory?.display_order ?? 0)
    }
    return a.display_order - b.display_order
  }

  const everydayTasks = tasks
    .filter(task => {
      const days = normalizeDays(task.days_of_week)
      return task.is_active && !days
    })
    .sort(sortTasksForOverview)

  const tasksByDay = DAY_NAMES.map((dayName, dayIndex) => ({
    dayName,
    tasks: tasks
      .filter(task => {
        const days = normalizeDays(task.days_of_week)
        return task.is_active && !!days && days.includes(dayIndex)
      })
      .sort(sortTasksForOverview),
  }))

  return (
    <div className="w-full max-w-7xl">
      {missingDaysColumn && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          `days_of_week` column is missing in the live `tasks` table, so day-specific tasks cannot be saved or shown in the weekly chart yet. Run [002_add_email_and_task_days.sql](/Users/jamesshin/foh-dashboard/supabase/migrations/002_add_email_and_task_days.sql) in Supabase SQL Editor first.
        </div>
      )}
      {errorMessage && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <div />
        <Button onClick={openAddCat}>
          <Plus className="w-4 h-4 mr-2" /> Add Category
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-3">
          {categories.map(cat => {
            const catTasks = tasks.filter(t => t.category_id === cat.id).sort((a, b) => a.display_order - b.display_order)
            const isOpen = expanded.has(cat.id)
            return (
              <div key={cat.id} className="border rounded-lg bg-white overflow-hidden">
                <div className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50" onClick={() => toggleExpand(cat.id)}>
                  {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                  <div className="flex-1">
                    <span className="font-semibold">{cat.name}</span>
                    {cat.deadline_time && (
                      <span className="ml-2 text-xs text-muted-foreground">by {cat.deadline_time.slice(0, 5)}</span>
                    )}
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[cat.type]}`}>
                    {TYPE_OPTIONS.find(o => o.value === cat.type)?.label}
                  </span>
                  <Badge variant="outline" className="text-xs">{catTasks.length} tasks</Badge>
                  <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" onClick={() => openEditCat(cat)}><Pencil className="w-4 h-4" /></Button>
                    <Button size="sm" variant="ghost" className="text-red-500" onClick={() => deleteCat(cat)}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t bg-gray-50 p-3 space-y-1">
                    {catTasks.map((task, idx) => (
                      <div key={task.id} className="flex items-center gap-2 bg-white rounded border px-3 py-2 text-sm">
                        <div className="flex flex-col gap-0.5">
                          <button className="text-gray-400 hover:text-gray-600 disabled:opacity-20" disabled={idx === 0} onClick={() => moveTask(task, 'up')}><ArrowUp className="w-3 h-3" /></button>
                          <button className="text-gray-400 hover:text-gray-600 disabled:opacity-20" disabled={idx === catTasks.length - 1} onClick={() => moveTask(task, 'down')}><ArrowDown className="w-3 h-3" /></button>
                        </div>
                        <div className="flex-1 min-w-0">
                          <span>{task.title}</span>
                          {task.deadline_time && (
                            <span className="ml-2 text-xs text-muted-foreground">by {task.deadline_time.slice(0, 5)}</span>
                          )}
                          {normalizeDays(task.days_of_week) && (
                            <span className="ml-2 text-xs text-violet-600 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5">
                              {DAY_NAMES.filter((_, i) => normalizeDays(task.days_of_week)?.includes(i)).join(', ')}
                            </span>
                          )}
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => openEditTask(task)}><Pencil className="w-3 h-3" /></Button>
                        <Button size="sm" variant="ghost" className="text-red-500" onClick={() => deleteTask(task)}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    ))}
                    <button
                      className="w-full border border-dashed border-gray-300 rounded p-2 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors text-xs flex items-center justify-center gap-1 mt-1"
                      onClick={() => openAddTask(cat.id)}
                    >
                      <Plus className="w-3 h-3" /> Add Task
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          {categories.length === 0 && (
            <p className="text-center text-muted-foreground py-8">No categories yet. Add your first one.</p>
          )}
        </div>
      )}

      {!loading && tasks.length > 0 && (
        <div className="mt-8 rounded-xl border bg-white overflow-hidden">
          <div className="border-b px-4 py-3">
            <h2 className="text-base font-semibold">Weekly Task Overview</h2>
            <p className="text-sm text-muted-foreground">Everyday tasks are grouped separately, and the weekly table shows day-specific tasks only.</p>
          </div>
          {everydayTasks.length > 0 && (
            <div className="border-b bg-amber-50/60 px-4 py-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Every Day</h3>
                  <p className="text-xs text-muted-foreground">These tasks appear on every shift, every day.</p>
                </div>
                <Badge variant="outline" className="bg-white">{everydayTasks.length} tasks</Badge>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {everydayTasks.map(task => {
                  const category = categories.find(cat => cat.id === task.category_id)
                  return (
                    <div key={`everyday-${task.id}`} className="rounded-lg border bg-white px-3 py-2.5">
                      <p className="font-medium leading-tight">{task.title}</p>
                      <div className="mt-1 flex items-center gap-2 text-xs">
                        {category && (
                          <span className={`rounded-full px-2 py-0.5 font-medium ${TYPE_COLORS[category.type]}`}>
                            {TYPE_OPTIONS.find(option => option.value === category.type)?.label}
                          </span>
                        )}
                        {task.deadline_time && (
                          <span className="text-muted-foreground">by {task.deadline_time.slice(0, 5)}</span>
                        )}
                      </div>
                      {category && (
                        <p className="mt-1 text-xs text-muted-foreground">{category.name}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-sm">
              <thead className="bg-gray-50">
                <tr className="border-b">
                  {tasksByDay.map(({ dayName }) => (
                    <th key={dayName} className="px-3 py-3 text-left font-semibold text-gray-700">
                      {dayName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="align-top">
                  {tasksByDay.map(({ dayName, tasks: dayTasks }) => (
                    <td key={dayName} className="h-56 border-r px-3 py-3 last:border-r-0">
                      {dayTasks.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No tasks</p>
                      ) : (
                        <div className="space-y-2">
                          {dayTasks.map(task => {
                            const category = categories.find(cat => cat.id === task.category_id)
                            return (
                              <div key={`${dayName}-${task.id}`} className="rounded-lg border bg-gray-50 px-2.5 py-2">
                                <p className="font-medium leading-tight">{task.title}</p>
                                <div className="mt-1 flex items-center gap-2 text-xs">
                                  {category && (
                                    <span className={`rounded-full px-2 py-0.5 font-medium ${TYPE_COLORS[category.type]}`}>
                                      {TYPE_OPTIONS.find(option => option.value === category.type)?.label}
                                    </span>
                                  )}
                                  {task.deadline_time && (
                                    <span className="text-muted-foreground">by {task.deadline_time.slice(0, 5)}</span>
                                  )}
                                </div>
                                {category && (
                                  <p className="mt-1 text-xs text-muted-foreground">{category.name}</p>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Category Dialog */}
      <Dialog open={catDialog} onOpenChange={setCatDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{catEdit ? 'Edit Category' : 'Add Category'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name *</Label>
              <Input value={catForm.name} onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Pre-Shift" />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={catForm.type} onValueChange={(v: string | null) => v && setCatForm(f => ({ ...f, type: v as TaskType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Deadline Time (optional)</Label>
              <Input type="time" value={catForm.deadline_time} onChange={e => setCatForm(f => ({ ...f, deadline_time: e.target.value }))} />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setCatDialog(false)}>Cancel</Button>
              <Button className="flex-1" onClick={saveCat} disabled={saving || !catForm.name.trim()}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Task Dialog */}
      <Dialog open={taskDialog} onOpenChange={setTaskDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{taskEdit ? 'Edit Task' : 'Add Task'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Task Title *</Label>
              <Input value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Wipe down tables" />
            </div>
            <div>
              <Label>Deadline Time (optional)</Label>
              <Input type="time" value={taskForm.deadline_time} onChange={e => setTaskForm(f => ({ ...f, deadline_time: e.target.value }))} />
            </div>
            <div>
              <Label>Active Days <span className="text-muted-foreground font-normal">(leave blank = every day)</span></Label>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                {DAY_NAMES.map((day, idx) => {
                  const isSelected = taskForm.days_of_week?.includes(idx) ?? false
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setTaskForm(f => {
                          const current = f.days_of_week ?? []
                          const next = isSelected
                            ? current.filter(d => d !== idx)
                            : [...current, idx].sort((a, b) => a - b)
                          return { ...f, days_of_week: next.length === 0 ? null : next }
                        })
                      }}
                      className={`min-w-0 rounded-md border px-1.5 py-1 text-[11px] font-medium transition-colors sm:px-2 sm:text-xs ${
                        isSelected
                          ? 'bg-violet-600 text-white border-violet-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-violet-400'
                      }`}
                    >
                      {day}
                    </button>
                  )
                })}
              </div>
              {taskForm.days_of_week && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground mt-1 underline"
                  onClick={() => setTaskForm(f => ({ ...f, days_of_week: null }))}
                >
                  Clear (show every day)
                </button>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setTaskDialog(false)}>Cancel</Button>
              <Button className="flex-1" onClick={saveTask} disabled={saving || !taskForm.title.trim()}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
