import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { TaskCategoryEditor } from '@/components/task-admin/TaskCategoryEditor'

export default function TaskAdminPage() {
  return (
    <div className="p-6">
      <AdminSubpageHeader title="Task Admin" subtitle="Create and organize categories, deadlines, and daily task rules." />
      <TaskCategoryEditor />
    </div>
  )
}
