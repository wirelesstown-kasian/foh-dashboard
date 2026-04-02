'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ClipboardList, Users, CalendarDays, BarChart3, LogOut } from 'lucide-react'

const adminCards = [
  { label: 'Task Admin', href: '/task-admin', icon: ClipboardList, description: 'Manage task categories and daily assignments' },
  { label: 'Staffing', href: '/staffing', icon: Users, description: 'Manage employees, roles, and PINs' },
  { label: 'Schedule Planner', href: '/schedule-planning', icon: CalendarDays, description: 'Build and publish weekly schedules' },
  { label: 'Reporting', href: '/reporting', icon: BarChart3, description: 'View EOD reports and analytics' },
]

export default function AdminPage() {
  const router = useRouter()

  const handleExit = async () => {
    await fetch('/api/admin-session', { method: 'DELETE' })
    router.push('/')
    router.refresh()
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admin Board</h1>
          <p className="text-muted-foreground mt-1">Select a section to manage</p>
        </div>
        <button
          onClick={handleExit}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Exit Admin
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {adminCards.map(({ label, href, icon: Icon, description }) => (
          <Link
            key={href}
            href={href}
            className="bg-white rounded-xl border p-6 hover:border-violet-400 hover:shadow-md transition-all group"
          >
            <Icon className="w-8 h-8 text-violet-500 mb-3 group-hover:scale-110 transition-transform" />
            <h2 className="font-semibold text-lg mb-1">{label}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
