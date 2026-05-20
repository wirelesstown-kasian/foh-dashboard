import { NextRequest, NextResponse } from 'next/server'
import { getReviewBoardViewer } from '@/lib/reviewBoard'
import { analyzeSavedGoogleReviews } from '@/lib/reviewSync'

export async function POST(req: NextRequest) {
  const { managerUnlocked } = await getReviewBoardViewer()
  if (!managerUnlocked) {
    return NextResponse.json({ error: 'Manager PIN required' }, { status: 401 })
  }

  const payload = await req.json().catch(() => ({})) as { limit?: number }

  try {
    const result = await analyzeSavedGoogleReviews(payload.limit)
    return NextResponse.json(result)
  } catch (error) {
    const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
      ? error.status
      : 500
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to analyze saved reviews',
    }, { status })
  }
}
