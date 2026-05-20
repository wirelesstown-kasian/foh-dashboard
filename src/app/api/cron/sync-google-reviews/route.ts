import { NextRequest, NextResponse } from 'next/server'
import { syncGoogleReviews } from '@/lib/reviewSync'

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await syncGoogleReviews()
    return NextResponse.json(result)
  } catch (error) {
    const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
      ? error.status
      : 500
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to sync Google reviews',
    }, { status })
  }
}
