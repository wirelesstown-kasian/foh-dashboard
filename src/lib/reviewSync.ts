import { fetchAllBusinessProfileReviews, fetchGooglePlaceReviews, hasBusinessProfileCredentials, mapGooglePlaceReviewsToRows } from '@/lib/googleReviews'
import { analyzeStoredReview, analyzeStoredReviewDirectMention, ReviewAnalysisResult } from '@/lib/reviewAnalysis'
import { isReviewBoardSetupMissingError } from '@/lib/reviewBoard'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const ANALYSIS_CONCURRENCY = 4
const REVIEW_ANALYSIS_STATE_KEY = 'review_analysis_state'
const AUTO_ANALYSIS_INTERVAL_DAYS = 3
const ANALYSIS_LOCK_MINUTES = 30
const MS_PER_DAY = 24 * 60 * 60 * 1000

type AnalysisRunner = (reviewId: string) => Promise<ReviewAnalysisResult | null>
type SyncedReviewRow = {
  id: string
  google_review_id: string
  matched_employee_id: string | null
  matched_employee_ids?: string[] | null
  attribution_status: string
  assigned_method?: string | null
}
type ReviewAnalysisState = {
  status?: 'idle' | 'in_progress' | 'error'
  lastStartedAt?: string
  lastCompletedAt?: string
  lastError?: string
}

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

function isMissingAnalysisTrackingColumn(error: { message?: string; code?: string; details?: string | null; hint?: string | null } | null | undefined) {
  const text = `${error?.message ?? ''} ${error?.details ?? ''} ${error?.hint ?? ''}`.toLowerCase()
  return error?.code === 'PGRST204' || text.includes('last_analyzed_at') || text.includes('analysis_error')
}

function parseStateValue(value: unknown): ReviewAnalysisState {
  return value && typeof value === 'object' ? value as ReviewAnalysisState : {}
}

async function readReviewAnalysisState(): Promise<ReviewAnalysisState> {
  const { data, error } = await supabaseAdmin
    .from('app_settings')
    .select('value')
    .eq('key', REVIEW_ANALYSIS_STATE_KEY)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return parseStateValue(data?.value)
}

async function saveReviewAnalysisState(state: ReviewAnalysisState) {
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({
      key: REVIEW_ANALYSIS_STATE_KEY,
      value: state,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })

  if (error) {
    throw new Error(error.message)
  }
}

function minutesSince(value?: string) {
  if (!value) return Number.POSITIVE_INFINITY
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY
  return (Date.now() - timestamp) / 60000
}

function daysSince(value?: string) {
  if (!value) return Number.POSITIVE_INFINITY
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY
  return (Date.now() - timestamp) / MS_PER_DAY
}

export async function syncGoogleReviews() {
  const usingBusinessProfile = hasBusinessProfileCredentials()
  const googleRows = usingBusinessProfile
    ? (await fetchAllBusinessProfileReviews()).rows
    : mapGooglePlaceReviewsToRows(await fetchGooglePlaceReviews())

  let reviewAnalysisTrackingEnabled = true
  let existingResult = await supabaseAdmin
    .from('google_reviews')
    .select('google_review_id, matched_employee_id, matched_employee_ids, confidence, reason, attribution_status, assigned_method, assigned_by_employee_id, categories, staff_mentions, last_analyzed_at, analysis_error')

  if (existingResult.error && isMissingAnalysisTrackingColumn(existingResult.error)) {
    reviewAnalysisTrackingEnabled = false
    existingResult = await supabaseAdmin
      .from('google_reviews')
      .select('google_review_id, matched_employee_id, matched_employee_ids, confidence, reason, attribution_status, assigned_method, assigned_by_employee_id, categories, staff_mentions')
  }

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
      matched_employee_ids: Array.isArray(existing.matched_employee_ids)
        ? existing.matched_employee_ids
        : existing.matched_employee_id
          ? [existing.matched_employee_id]
          : row.matched_employee_ids,
      confidence: existing.confidence ?? null,
      reason: existing.reason ?? null,
      attribution_status: existing.attribution_status ?? 'unassigned',
      assigned_method: existing.assigned_method ?? row.assigned_method,
      assigned_by_employee_id: existing.assigned_by_employee_id ?? null,
      categories: Array.isArray(existing.categories) ? existing.categories : row.categories,
      staff_mentions: Array.isArray(existing.staff_mentions) ? existing.staff_mentions : row.staff_mentions,
      ...(reviewAnalysisTrackingEnabled
        ? {
            last_analyzed_at: typeof existing.last_analyzed_at === 'string' ? existing.last_analyzed_at : null,
            analysis_error: typeof existing.analysis_error === 'string' ? existing.analysis_error : null,
          }
        : {}),
    }
  })

  const { error, data } = await supabaseAdmin
    .from('google_reviews')
    .upsert(rowsToUpsert, { onConflict: 'google_review_id' })
    .select(reviewAnalysisTrackingEnabled
      ? 'id, google_review_id, matched_employee_id, matched_employee_ids, attribution_status, assigned_method, last_analyzed_at'
      : 'id, google_review_id, matched_employee_id, matched_employee_ids, attribution_status, assigned_method')

  if (error) {
    throw Object.assign(new Error(normalizeSetupError(error).message), {
      status: normalizeSetupError(error).status,
    })
  }

  const syncedRows = (data ?? []) as unknown as SyncedReviewRow[]
  const analysisCandidates = syncedRows.filter(review =>
    newGoogleReviewIds.has(review.google_review_id) &&
    review.attribution_status !== 'manual' &&
    review.matched_employee_id == null &&
    (!Array.isArray(review.matched_employee_ids) || review.matched_employee_ids.length === 0)
  )

  const analysisResults = await analyzeReviewsInBatches(analysisCandidates)
  const { analyzed, analysisErrors, analysisErrorSamples } = buildAnalysisSummary(analysisResults)

  return {
    success: true,
    synced: syncedRows.length || rowsToUpsert.length,
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
  let reviewAnalysisTrackingEnabled = true
  let directCandidatesResult = await supabaseAdmin
    .from('google_reviews')
    .select('id', { count: 'exact' })
    .neq('attribution_status', 'manual')
    .is('last_analyzed_at', null)
    .order('review_date', { ascending: false })
    .limit(1000)

  if (directCandidatesResult.error && isMissingAnalysisTrackingColumn(directCandidatesResult.error)) {
    reviewAnalysisTrackingEnabled = false
    directCandidatesResult = await supabaseAdmin
      .from('google_reviews')
      .select('id', { count: 'exact' })
      .neq('attribution_status', 'manual')
      .order('review_date', { ascending: false })
      .limit(1000)
  }

  if (directCandidatesResult.error) {
    throw Object.assign(new Error(normalizeSetupError(directCandidatesResult.error).message), {
      status: normalizeSetupError(directCandidatesResult.error).status,
    })
  }

  const directCandidates = directCandidatesResult.data ?? []
  const directResults = await analyzeReviewsInBatches(directCandidates, analyzeStoredReviewDirectMention)
  const directSummary = buildAnalysisSummary(directResults)

  let openAiCandidatesQuery = supabaseAdmin
    .from('google_reviews')
    .select('id', { count: 'exact' })
    .neq('attribution_status', 'manual')
    .is('matched_employee_id', null)
    .eq('matched_employee_ids', '{}')
    .or('assigned_method.is.null,assigned_method.in.(business_profile_sync,google_places_sync,manager_clear)')

  if (reviewAnalysisTrackingEnabled) {
    openAiCandidatesQuery = openAiCandidatesQuery.is('last_analyzed_at', null)
  }

  const openAiCandidatesResult = await openAiCandidatesQuery
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

export async function analyzeSavedGoogleReviewsIfDue(limit = 100) {
  const state = await readReviewAnalysisState()

  if (state.status === 'in_progress' && minutesSince(state.lastStartedAt) < ANALYSIS_LOCK_MINUTES) {
    return {
      success: true,
      skipped: true,
      reason: 'analysis_already_in_progress',
      last_started_at: state.lastStartedAt ?? null,
      last_completed_at: state.lastCompletedAt ?? null,
    }
  }

  if (daysSince(state.lastCompletedAt) < AUTO_ANALYSIS_INTERVAL_DAYS) {
    return {
      success: true,
      skipped: true,
      reason: 'analysis_recently_completed',
      last_started_at: state.lastStartedAt ?? null,
      last_completed_at: state.lastCompletedAt ?? null,
    }
  }

  const startedAt = new Date().toISOString()
  await saveReviewAnalysisState({
    ...state,
    status: 'in_progress',
    lastStartedAt: startedAt,
    lastError: undefined,
  })

  try {
    const result = await analyzeSavedGoogleReviews(limit)
    const completedAt = new Date().toISOString()
    await saveReviewAnalysisState({
      status: 'idle',
      lastStartedAt: startedAt,
      lastCompletedAt: completedAt,
    })
    return {
      ...result,
      skipped: false,
      last_started_at: startedAt,
      last_completed_at: completedAt,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Review analysis failed'
    await saveReviewAnalysisState({
      status: 'error',
      lastStartedAt: startedAt,
      lastCompletedAt: state.lastCompletedAt,
      lastError: message,
    })
    throw error
  }
}
