import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

interface AdminSubpageHeaderProps {
  title: string
  subtitle?: string
  rightSlot?: React.ReactNode
}

export function AdminSubpageHeader({ title, subtitle, rightSlot }: AdminSubpageHeaderProps) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Admin Board
        </Link>
        <h1 className="text-2xl font-bold mt-2">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {rightSlot}
    </div>
  )
}
