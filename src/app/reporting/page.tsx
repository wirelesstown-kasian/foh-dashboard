'use client'

import Link from 'next/link'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { ReportingNav } from '@/components/reporting/ReportingNav'
import { BarChart3, ClipboardCheck, DollarSign, FileClock, ReceiptText } from 'lucide-react'

const reportingCards = [
  {
    href: '/reporting/task-performance',
    title: 'Task Performance',
    description: 'See rankings, scores, and monthly task pace.',
    icon: BarChart3,
  },
  {
    href: '/reporting/task-detail',
    title: 'Task Detail',
    description: 'Review complete, incomplete, and still-open task rows by employee.',
    icon: ClipboardCheck,
  },
  {
    href: '/reporting/wages',
    title: 'Wage Report',
    description: 'Track tips, hours, guaranteed top-up, and earnings.',
    icon: DollarSign,
  },
  {
    href: '/reporting/eod-history',
    title: 'EOD History',
    description: 'Review store-wide revenue, tips, deposits, and period totals.',
    icon: ReceiptText,
  },
  {
    href: '/reporting/clock-records',
    title: 'Clock Records',
    description: 'Inspect photos, modify times, and review shift timing.',
    icon: FileClock,
  },
]

export default function ReportingHomePage() {
  return (
    <div className="p-6">
      <AdminSubpageHeader
        title="Reporting"
        subtitle="Choose a report page to keep loading light and workflows focused."
        backHref="/admin"
        backLabel="Back to Admin Board"
      />
      <ReportingNav />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {reportingCards.map(card => {
          const Icon = card.icon
          return (
            <Link
              key={card.href}
              href={card.href}
              className="rounded-xl border bg-white p-5 transition-all hover:border-violet-300 hover:shadow-sm"
            >
              <Icon className="mb-3 h-7 w-7 text-violet-600" />
              <h2 className="text-lg font-semibold text-slate-900">{card.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{card.description}</p>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
