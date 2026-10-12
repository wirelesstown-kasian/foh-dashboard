import { NextResponse } from 'next/server'
import { syncGoogleReviews } from '@/lib/reviewSync'
import { getDashboardViewer } from '@/lib/routeAuth'

export async function POST() {
  const viewer = await getDashboardViewer()
  if (!viewer?.isManager) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
