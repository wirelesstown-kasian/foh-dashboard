import { fetchAllBusinessProfileReviews, fetchGooglePlaceReviews, hasBusinessProfileCredentials, mapGooglePlaceReviewsToRows } from '@/lib/googleReviews'
import { analyzeStoredReview, analyzeStoredReviewDirectMention, ReviewAnalysisResult } from '@/lib/reviewAnalysis'
import { isReviewBoardSetupMissingError } from '@/lib/reviewBoard'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const ANALYSIS_CONCURRENCY = 4

type AnalysisRunner = (reviewId: string) => Promise<ReviewAnalysisResult | null>

async function analyzeReviewsInBatches(reviews: Array<{ id: string }>, runner: AnalysisRunner = analyzeStoredReview) {
  const results: PromiseSettledResult<ReviewAnalysisResult | null>[] = []

  for (let index = 0; index < reviews.length; index += ANALYSIS_CONCURRENCY) {
    const batch = reviews.slice(index, index + ANALYSIS_CONCURRENCY)
    const batchResults = await Promise.allSettled(
      batch.map(review => runner(review.id))
    )
    results.push(...batchResults)
  }

  return results
}

function buildAnalysisSummary(
  analysisResults: PromiseSettledResult<ReviewAnalysisResult | null>[]
) {
  const analyzed = analysisResults.filter(result => result.status === 'fulfilled' && result.value !== null).length
  const analysisErrors = analysisResults
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason instanceof Error ? result.reason.message : 'Review analysis failed')
  const analysisErrorSamples = Array.from(new Set(analysisErrors)).slice(0, 5)

  return { analyzed, analysisErrors, analysisErrorSamples }
}

function normalizeSetupError(error: { message?: string }) {
  if (isReviewBoardSetupMissingError(error)) {
    return { message: 'Run the review board migration locally first.', status: 400 }
  }
  return { message: error.message ?? 'Review sync failed', status: 500 }
}

export async function syncGoogleReviews() {
  const usingBusinessProfile = hasBusinessProfileCredentials()
  const googleRows = usingBusinessProfile
    ? (await fetchAllBusinessProfileReviews()).rows
    : mapGooglePlaceReviewsToRows(await fetchGooglePlaceReviews())

  const existingResult = await supabaseAdmin
    .from('google_reviews')
    .select('google_review_id, matched_employee_id, confidence, reason, attribution_status, assigned_method, assigned_by_employee_id, categories, staff_mentions')

  if (existingResult.error) {
    throw Object.assign(new Error(normalizeSetupError(existingResult.error).message), {
      status: normalizeSetupError(existingResult.error).status,
    })
  }

  const existingByGoogleId = new Map((existingResult.data ?? []).map(row => [row.google_review_id as string, row]))
  const newGoogleReviewIds = new Set<string>()
  const rowsToUpsert = googleRows.map(row => {
    const existing = existingByGoogleId.get(row.google_review_id)
    if (!existing) {
      newGoogleReviewIds.add(row.google_review_id)
      return row
    }

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
    throw Object.assign(new Error(normalizeSetupError(error).message), {
      status: normalizeSetupError(error).status,
    })
  }

  const analysisCandidates = (data ?? []).filter(review =>
    newGoogleReviewIds.has(review.google_review_id) &&
    review.attribution_status !== 'manual' &&
    review.matched_employee_id == null
  )

  const analysisResults = await analyzeReviewsInBatches(analysisCandidates)
  const { analyzed, analysisErrors, analysisErrorSamples } = buildAnalysisSummary(analysisResults)

  return {
    success: true,
    synced: data?.length ?? rowsToUpsert.length,
    reviews_found: googleRows.length,
    new_reviews: newGoogleReviewIds.size,
    analyzed,
    analysis_errors: analysisErrors,
    analysis_error_samples: analysisErrorSamples,
    api_used: usingBusinessProfile ? 'business_profile' : 'places_api',
  }
}

export async function analyzeSavedGoogleReviews(limit = 75) {
  const safeLimit = Math.max(1, Math.min(limit, 250))
  const directCandidatesResult = await supabaseAdmin
    .from('google_reviews')
    .select('id', { count: 'exact' })
    .neq('attribution_status', 'manual')
    .is('matched_employee_id', null)
    .order('review_date', { ascending: false })
    .limit(Math.max(safeLimit, 250))

  if (directCandidatesResult.error) {
    throw Object.assign(new Error(normalizeSetupError(directCandidatesResult.error).message), {
      status: normalizeSetupError(directCandidatesResult.error).status,
    })
  }

  const directCandidates = directCandidatesResult.data ?? []
  const directResults = await analyzeReviewsInBatches(directCandidates, analyzeStoredReviewDirectMention)
  const directSummary = buildAnalysisSummary(directResults)

  const openAiCandidatesResult = await supabaseAdmin
    .from('google_reviews')
    .select('id', { count: 'exact' })
    .neq('attribution_status', 'manual')
    .is('matched_employee_id', null)
    .or('assigned_method.is.null,assigned_method.in.(business_profile_sync,google_places_sync,manager_clear)')
    .order('review_date', { ascending: false })
    .limit(safeLimit)

  if (openAiCandidatesResult.error) {
    throw Object.assign(new Error(normalizeSetupError(openAiCandidatesResult.error).message), {
      status: normalizeSetupError(openAiCandidatesResult.error).status,
    })
  }

  const openAiCandidates = openAiCandidatesResult.data ?? []
  const openAiResults = await analyzeReviewsInBatches(openAiCandidates)
  const openAiSummary = buildAnalysisSummary(openAiResults)
  const analysisErrors = [...directSummary.analysisErrors, ...openAiSummary.analysisErrors]
  const analysisErrorSamples = Array.from(new Set([
    ...directSummary.analysisErrorSamples,
    ...openAiSummary.analysisErrorSamples,
  ])).slice(0, 5)

  return {
    success: true,
    pending_found: directCandidatesResult.count ?? directCandidates.length,
    processed: directCandidates.length + openAiCandidates.length,
    direct_matched: directSummary.analyzed,
    ai_analyzed: openAiSummary.analyzed,
    analyzed: directSummary.analyzed + openAiSummary.analyzed,
    analysis_errors: analysisErrors,
    analysis_error_samples: analysisErrorSamples,
  }
}
