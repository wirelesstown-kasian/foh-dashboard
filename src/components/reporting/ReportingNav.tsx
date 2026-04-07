'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const links = [
  { href: '/reporting/task-performance', label: 'Task Performance' },
  { href: '/reporting/task-detail', label: 'Task Detail' },
  { href: '/reporting/wages', label: 'Wage Report' },
  { href: '/reporting/clock-records', label: 'Clock Records' },
  { href: '/reporting/eod-history', label: 'EOD History' },
]

export function ReportingNav() {
  const pathname = usePathname()

  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {links.map(link => {
        const active = pathname === link.href
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'border-violet-500 bg-violet-50 text-violet-800'
                : 'border-slate-200 bg-white text-slate-600 hover:border-violet-300 hover:text-violet-800'
            )}
          >
            {link.label}
          </Link>
        )
      })}
    </div>
  )
}
