import type { SupabaseClient } from '@supabase/supabase-js'
import type { Task, TaskCategory } from '@/lib/types'

const DEFAULT_CLOCK_TASKS = [
  { categoryType: 'pre_shift', title: 'Clock In' },
  { categoryType: 'closing', title: 'Clock Out' },
] as const

export async function ensureDefaultClockTasks(
  supabase: SupabaseClient,
  categories: TaskCategory[],
  tasks: Task[]
) {
  const inserts: Array<{
    category_id: string
    title: string
    deadline_time: null
    display_order: number
    is_active: true
    days_of_week: null
  }> = []

  for (const defaultTask of DEFAULT_CLOCK_TASKS) {
    const category = categories.find(item => item.type === defaultTask.categoryType)
    if (!category) continue

    const existingTask = tasks.find(task =>
      task.category_id === category.id &&
      task.title.trim().toLowerCase() === defaultTask.title.toLowerCase()
    )

    if (existingTask) continue

    const categoryTasks = tasks.filter(task => task.category_id === category.id)
    const maxOrder = Math.max(0, ...categoryTasks.map(task => task.display_order))

    inserts.push({
      category_id: category.id,
      title: defaultTask.title,
      deadline_time: null,
      display_order: maxOrder + inserts.filter(item => item.category_id === category.id).length + 1,
      is_active: true,
      days_of_week: null,
    })
  }

  if (inserts.length === 0) return false

  const { error } = await supabase.from('tasks').insert(inserts)
  if (error) {
    throw error
  }

  return true
}
