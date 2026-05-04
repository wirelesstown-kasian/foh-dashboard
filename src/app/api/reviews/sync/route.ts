import { NextResponse } from 'next/server'
import { fetchGooglePlaceReviews, mapGooglePlaceReviewsToRows } from '@/lib/googleReviews'
import { analyzeStoredReview } from '@/lib/reviewAnalysis'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getReviewBoardViewer, isReviewBoardSetupMissingError, requireViewerSession } from '@/lib/reviewBoard'

export async function POST() {
  const { session } = await getReviewBoardViewer()
  if (!requireViewerSession(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let googleRows
  try {
    const place = await fetchGooglePlaceReviews()
    googleRows = mapGooglePlaceReviewsToRows(place)
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to fetch Google reviews',
    }, { status: 400 })
  }

  const existingResult = await supabaseAdmin
    .from('google_reviews')
    .select('google_review_id, matched_employee_id, confidence, reason, attribution_status, assigned_method, assigned_by_employee_id, categories, staff_mentions')

  if (existingResult.error) {
    if (isReviewBoardSetupMissingError(existingResult.error)) {
      return NextResponse.json({ error: 'Run the review board migration locally first.' }, { status: 400 })
    }
    return NextResponse.json({ error: existingResult.error.message }, { status: 500 })
  }

  const existingByGoogleId = new Map((existingResult.data ?? []).map(row => [row.google_review_id as string, row]))
  const rowsToUpsert = googleRows.map(row => {
    const existing = existingByGoogleId.get(row.google_review_id)
    if (!existing) return row

    return {
      ...row,
      matched_employee_id: existing.matched_employee_id ?? null,
      confidence: existing.confidence ?? null,
      reason: existing.reason ?? null,
      attribution_status: existing.attribution_status ?? 'unassigned',
      assigned_method: existing.assigned_method ?? row.assigned_method,
      assigned_by_employee_id: existing.assigned_by_employee_id ?? null,
      categories: Array.isArray(existing.categories) ? existing.categories : row.categories,
      staff_mentions: Array.isArray(existing.staff_mentions) ? existing.staff_mentions : row.staff_mentions,
    }
  })

  const { error, data } = await supabaseAdmin
    .from('google_reviews')
    .upsert(rowsToUpsert, { onConflict: 'google_review_id' })
    .select('id, google_review_id, matched_employee_id, attribution_status, assigned_method')

  if (error) {
    if (isReviewBoardSetupMissingError(error)) {
      return NextResponse.json({ error: 'Run the review board migration locally first.' }, { status: 400 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const analysisCandidates = (data ?? []).filter(review =>
    review.attribution_status !== 'manual' &&
    review.matched_employee_id == null
  )

  const analysisResults = await Promise.allSettled(
    analysisCandidates.map(review => analyzeStoredReview(review.id))
  )

  const analyzed = analysisResults.filter(result => result.status === 'fulfilled').length
  const analysisErrors = analysisResults
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason instanceof Error ? result.reason.message : 'Review analysis failed')

  return NextResponse.json({
    success: true,
    synced: data?.length ?? rowsToUpsert.length,
    reviews_found: googleRows.length,
    analyzed,
    analysis_errors: analysisErrors,
  })
}
