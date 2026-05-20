import { NextResponse } from 'next/server'
import { syncGoogleReviews } from '@/lib/reviewSync'

export async function POST() {
  try {
    const result = await syncGoogleReviews()
    return NextResponse.json(result)
  } catch (error) {
    const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
      ? error.status
      : 400
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to fetch Google reviews',
    }, { status })
  }
}
