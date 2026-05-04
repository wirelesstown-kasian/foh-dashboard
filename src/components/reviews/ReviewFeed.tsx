'use client'

import { GoogleReview } from '@/lib/types'
import { ReviewCard } from '@/components/reviews/ReviewCard'

interface ReviewFeedProps {
  reviews: GoogleReview[]
  onAssign: (review: GoogleReview) => void
  onSelectEmployee: (employeeId: string) => void
  filterLabel: string
}

export function ReviewFeed({ reviews, onAssign, onSelectEmployee, filterLabel }: ReviewFeedProps) {
  if (reviews.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-12 text-center text-sm text-slate-500">
        No reviews match {filterLabel.toLowerCase()} yet.
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-6">
      {reviews.map(review => (
        <ReviewCard
          key={review.id}
          review={review}
          onAssign={onAssign}
          onSelectEmployee={onSelectEmployee}
        />
      ))}
    </div>
  )
}
