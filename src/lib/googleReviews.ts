import { reviewPointsFromRating } from '@/lib/reviewScoring'

// ─── Places API (5 most recent) ───────────────────────────────────────────────

interface GooglePlaceReviewResponse {
  id?: string
  displayName?: { text?: string; languageCode?: string }
  reviews?: GooglePlaceReview[]
}

interface GooglePlaceReview {
  name?: string
  relativePublishTimeDescription?: string
  text?: { text?: string; languageCode?: string }
  originalText?: { text?: string; languageCode?: string }
  rating?: number
  authorAttribution?: { displayName?: string; photoUri?: string; uri?: string }
  publishTime?: string
  googleMapsUri?: string
  visitDate?: { year?: number; month?: number; day?: number }
}

// ─── Business Profile API (all reviews) ───────────────────────────────────────

interface BusinessProfileReview {
  reviewId?: string
  name?: string
  reviewer?: { displayName?: string; profilePhotoUrl?: string; isAnonymous?: boolean }
  starRating?: string
  comment?: string
  createTime?: string
  updateTime?: string
}

interface BusinessProfileReviewsResponse {
  reviews?: BusinessProfileReview[]
  nextPageToken?: string
  totalReviewCount?: number
  error?: { message?: string; status?: string }
}

const STAR_RATING_MAP: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
}

// ─── Shared sync row type ──────────────────────────────────────────────────────

export interface GoogleReviewSyncRow {
  google_review_id: string
  author_name: string
  reviewer_photo_url: string | null
  rating: number
  review_text: string
  review_date: string
  language: string | null
  source_payload: Record<string, unknown>
  sentiment: null
  categories: string[]
  staff_mentions: string[]
  matched_employee_id: null
  confidence: null
  reason: null
  attribution_status: 'unassigned'
  points: number
  assigned_method: string
  assigned_by_employee_id: null
}

// ─── Business Profile helpers ──────────────────────────────────────────────────

export function hasBusinessProfileCredentials() {
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() &&
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim() &&
    process.env.GOOGLE_BUSINESS_LOCATION_ID?.trim()
  )
}

async function getGoogleAccessToken(): Promise<string> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim()

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Google OAuth credentials (CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN)')
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  })

  const data = await res.json().catch(() => ({})) as { access_token?: string; error?: string; error_description?: string }
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? 'Failed to get Google access token')
  }

  return data.access_token
}

async function discoverAccountId(accessToken: string): Promise<string> {
  const res = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })

  const data = await res.json().catch(() => ({})) as { accounts?: Array<{ name: string; accountName?: string }> }
  const first = data.accounts?.[0]?.name
  if (!first) throw new Error('No Google Business account found — make sure the authorized account manages this business')

  // "accounts/123456789" → "123456789"
  return first.replace('accounts/', '')
}

export async function fetchAllBusinessProfileReviews(): Promise<GoogleReviewSyncRow[]> {
  const locationId = process.env.GOOGLE_BUSINESS_LOCATION_ID?.trim()
  if (!locationId) throw new Error('Missing env var: GOOGLE_BUSINESS_LOCATION_ID')

  const accessToken = await getGoogleAccessToken()
  const accountId = process.env.GOOGLE_BUSINESS_ACCOUNT_ID?.trim() || await discoverAccountId(accessToken)

  const allRows: GoogleReviewSyncRow[] = []
  let pageToken: string | undefined

  do {
    const url = new URL(`https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews`)
    url.searchParams.set('pageSize', '50')
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })

    const data = await res.json().catch(() => ({})) as BusinessProfileReviewsResponse
    if (!res.ok) throw new Error(data.error?.message ?? 'Failed to fetch Business Profile reviews')

    for (const review of data.reviews ?? []) {
      const reviewText = review.comment?.trim()
      const reviewId = review.reviewId?.trim()
      const rating = STAR_RATING_MAP[review.starRating ?? ''] ?? 0

      if (!reviewId || !reviewText || !rating) continue

      allRows.push({
        google_review_id: reviewId,
        author_name: review.reviewer?.displayName?.trim() || 'A Google user',
        reviewer_photo_url: review.reviewer?.profilePhotoUrl?.trim() || null,
        rating,
        review_text: reviewText,
        review_date: review.createTime ? review.createTime.slice(0, 10) : new Date().toISOString().slice(0, 10),
        language: null,
        source_payload: {
          source: 'google_business_profile',
          account_id: accountId,
          location_id: locationId,
          review_name: review.name ?? null,
          create_time: review.createTime ?? null,
          update_time: review.updateTime ?? null,
        },
        sentiment: null,
        categories: [],
        staff_mentions: [],
        matched_employee_id: null,
        confidence: null,
        reason: null,
        attribution_status: 'unassigned',
        points: reviewPointsFromRating(rating),
        assigned_method: 'business_profile_sync',
        assigned_by_employee_id: null,
      })
    }

    pageToken = data.nextPageToken
  } while (pageToken)

  return allRows
}

// ─── Places API (fallback — 5 most recent) ────────────────────────────────────

function getRequiredGoogleReviewsEnv() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim()
  const placeId = process.env.GOOGLE_PLACE_ID?.trim()

  if (!apiKey && !placeId) throw new Error('Missing env vars: GOOGLE_PLACES_API_KEY and GOOGLE_PLACE_ID')
  if (!apiKey) throw new Error('Missing env var: GOOGLE_PLACES_API_KEY')
  if (!placeId) throw new Error('Missing env var: GOOGLE_PLACE_ID')

  return { apiKey, placeId }
}

function reviewDateFromPublishTime(publishTime?: string) {
  if (!publishTime) return new Date().toISOString().slice(0, 10)
  const parsed = new Date(publishTime)
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10)
  return parsed.toISOString().slice(0, 10)
}

export async function fetchGooglePlaceReviews() {
  const { apiKey, placeId } = getRequiredGoogleReviewsEnv()

  const response = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'id,displayName,reviews',
    },
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => ({})) as GooglePlaceReviewResponse & { error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message ?? 'Failed to fetch Google reviews')

  return payload
}

export function mapGooglePlaceReviewsToRows(place: GooglePlaceReviewResponse): GoogleReviewSyncRow[] {
  const rows: GoogleReviewSyncRow[] = []

  for (const review of place.reviews ?? []) {
    const reviewText = review.originalText?.text?.trim() || review.text?.text?.trim() || ''
    const rating = Math.max(1, Math.min(5, Math.round(review.rating ?? 0)))
    const reviewId = review.name?.trim()

    if (!reviewId || !reviewText || !rating) continue

    rows.push({
      google_review_id: reviewId,
      author_name: review.authorAttribution?.displayName?.trim() || 'A Google user',
      reviewer_photo_url: review.authorAttribution?.photoUri?.trim() || null,
      rating,
      review_text: reviewText,
      review_date: reviewDateFromPublishTime(review.publishTime),
      language: review.originalText?.languageCode?.trim() || review.text?.languageCode?.trim() || null,
      source_payload: {
        source: 'google_places',
        place_id: place.id ?? null,
        place_name: place.displayName?.text ?? null,
        fetched_at: new Date().toISOString(),
        review_name: review.name ?? null,
        publish_time: review.publishTime ?? null,
        google_maps_uri: review.googleMapsUri ?? null,
      },
      sentiment: null,
      categories: [],
      staff_mentions: [],
      matched_employee_id: null,
      confidence: null,
      reason: null,
      attribution_status: 'unassigned',
      points: reviewPointsFromRating(rating),
      assigned_method: 'google_places_sync',
      assigned_by_employee_id: null,
    })
  }

  return rows
}
