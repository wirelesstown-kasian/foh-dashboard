'use client'

import { format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getReviewBadgeClassName, getReviewBadgeLabel } from '@/lib/reviewScoring'
import { cn } from '@/lib/utils'
import { GoogleReview } from '@/lib/types'

function renderHighlightedText(text: string, mentions: string[]) {
  if (!mentions.length) {
    return <span className="whitespace-pre-wrap">{text}</span>
  }

  const escapedMentions = mentions
    .filter(Boolean)
    .map(mention => mention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

  if (!escapedMentions.length) {
    return <span className="whitespace-pre-wrap">{text}</span>
  }

  const pattern = new RegExp(`(${escapedMentions.join('|')})`, 'gi')
  const parts = text.split(pattern)

  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, index) => {
        const isMatch = escapedMentions.some(mention => mention.toLowerCase() === part.toLowerCase())
        return isMatch ? (
          <mark key={`${part}-${index}`} className="rounded bg-amber-200 px-1 py-0.5 text-slate-900">
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        )
      })}
    </span>
  )
}

interface ReviewCardProps {
  review: GoogleReview
  onAssign: (review: GoogleReview) => void
  onSelectEmployee: (employeeId: string) => void
}

export function ReviewCard({ review, onAssign, onSelectEmployee }: ReviewCardProps) {
  const pointsClassName = review.points > 0
    ? 'text-emerald-600'
    : review.points < 0
      ? 'text-red-600'
      : 'text-slate-500'

  return (
    <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <CardHeader className="gap-3 border-b border-slate-100 pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base font-bold text-slate-950">{review.author_name}</CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <span>{'★'.repeat(review.rating)}{'☆'.repeat(Math.max(0, 5 - review.rating))}</span>
              <span>{format(new Date(`${review.review_date}T12:00:00`), 'MMM d, yyyy')}</span>
              {review.language && (
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {review.language}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn('h-7 border px-3 text-xs font-semibold', getReviewBadgeClassName(review.attribution_status))}>
              {getReviewBadgeLabel(review.attribution_status)}
            </Badge>
            <div className={cn('rounded-full bg-slate-100 px-3 py-1 text-sm font-bold', pointsClassName)}>
              {review.points > 0 ? '+' : ''}{review.points} pts
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 text-sm text-slate-600 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-700">Assigned Staff:</span>
            {review.matched_employee ? (
              <button
                type="button"
                onClick={() => onSelectEmployee(review.matched_employee!.id)}
                className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-700 transition-colors hover:bg-amber-100"
              >
                {review.matched_employee.name}
              </button>
            ) : (
              <span className="rounded-full bg-orange-50 px-3 py-1 font-semibold text-orange-700">Unassigned</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {review.reason && <span className="text-xs text-slate-500">{review.reason}</span>}
            <Button variant="outline" className="h-11 min-w-24 text-sm font-semibold" onClick={() => onAssign(review)}>
              Assign
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-5 py-5 text-sm leading-6 text-slate-700">
        <div className="text-[15px] leading-7 text-slate-800">
          {renderHighlightedText(review.review_text, review.staff_mentions)}
        </div>

        <div className="flex flex-wrap gap-2">
          {review.categories.map(category => (
            <span key={category} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              {category.replace('_', ' ')}
            </span>
          ))}
          {review.confidence != null && (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Confidence {review.confidence}%
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
