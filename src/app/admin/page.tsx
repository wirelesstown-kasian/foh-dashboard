'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Bell, ClipboardList, Users, CalendarDays, BarChart3, LogOut, MailCheck, BriefcaseBusiness, DollarSign, FileClock, LayoutDashboard, ListChecks, ReceiptText, HandCoins } from 'lucide-react'

const adminGroups = [
  {
    label: 'Staffing and Payroll',
    icon: Users,
    description: 'Employee setup, pay settings, payroll worksheet, and wage review.',
    links: [
      { label: 'New Wage Worksheet', href: '/payroll/worksheet', icon: DollarSign },
      { label: 'Tip Distribution Editor', href: '/payroll/tip-distribution-editor', icon: HandCoins },
      { label: 'Staffing', href: '/staffing', icon: Users },
      { label: 'Clock In Records', href: '/reporting/clock-records', icon: FileClock },
    ],
  },
  {
    label: 'Task Admin',
    icon: ClipboardList,
    description: 'Task setup, task completion review, and performance reporting.',
    links: [
      { label: 'Task Admin', href: '/task-admin', icon: ClipboardList },
      { label: 'Task Performance', href: '/reporting/task-performance', icon: BarChart3 },
      { label: 'Task Details', href: '/reporting/task-detail', icon: ListChecks },
    ],
  },
  {
    label: 'Reporting',
    icon: LayoutDashboard,
    description: 'Sales, payroll, and email reporting controls.',
    links: [
      { label: 'Dashboard', href: '/reporting/dashboard', icon: LayoutDashboard },
      { label: 'Wage Report', href: '/reporting/wages', icon: DollarSign },
      { label: 'Roles and Departments', href: '/roles-departments', icon: BriefcaseBusiness },
      { label: 'EOD History', href: '/reporting/eod-history', icon: ReceiptText },
    ],
  },
  {
    label: 'Schedule Planner',
    icon: CalendarDays,
    description: 'Build schedules, manage calendar reminders, and control schedule emails.',
    links: [
      { label: 'Schedule Planner', href: '/schedule-planning', icon: CalendarDays },
      { label: 'Announcement Board', href: '/announcements', icon: Bell },
      { label: 'Email Settings', href: '/email-settings', icon: MailCheck },
    ],
  },
]

export default function AdminPage() {
  const router = useRouter()

  const handleExit = async () => {
    await fetch('/api/admin-session', { method: 'DELETE' })
    router.push('/')
    router.refresh()
  }

  return (
    <div className="p-8">
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
      <div className="grid gap-5 xl:grid-cols-2">
        {adminGroups.map(({ label, icon: Icon, description, links }) => (
          <section key={label} className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">{label}</h2>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {links.map(link => {
                const LinkIcon = link.icon
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="flex items-center gap-2 rounded-lg border bg-slate-50 px-3 py-2 text-sm font-medium transition-colors hover:border-violet-300 hover:bg-violet-50"
                  >
                    <LinkIcon className="h-4 w-4 text-violet-600" />
                    {link.label}
                  </Link>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
