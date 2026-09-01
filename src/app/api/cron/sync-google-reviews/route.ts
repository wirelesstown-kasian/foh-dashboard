import { NextRequest, NextResponse } from 'next/server'
import { analyzeSavedGoogleReviewsIfDue, syncGoogleReviews } from '@/lib/reviewSync'

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const syncResult = await syncGoogleReviews()
    const savedAnalysisResult = await analyzeSavedGoogleReviewsIfDue()
    return NextResponse.json({
      ...syncResult,
      saved_analysis: savedAnalysisResult,
    })
  } catch (error) {
    const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
      ? error.status
      : 500
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to sync Google reviews',
    }, { status })
  }
}
