import { reviewPointsFromRating } from '@/lib/reviewScoring'

interface GooglePlaceReviewResponse {
  id?: string
  displayName?: {
    text?: string
    languageCode?: string
  }
  reviews?: GooglePlaceReview[]
}

interface GooglePlaceReview {
  name?: string
  relativePublishTimeDescription?: string
  text?: {
    text?: string
    languageCode?: string
  }
  originalText?: {
    text?: string
    languageCode?: string
  }
  rating?: number
  authorAttribution?: {
    displayName?: string
    photoUri?: string
    uri?: string
  }
  publishTime?: string
  googleMapsUri?: string
  visitDate?: {
    year?: number
    month?: number
    day?: number
  }
}

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
  assigned_method: 'google_places_sync'
  assigned_by_employee_id: null
}

function getRequiredGoogleReviewsEnv() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim()
  const placeId = process.env.GOOGLE_PLACE_ID?.trim()

  if (!apiKey || !placeId) {
    throw new Error('Missing GOOGLE_PLACES_API_KEY or GOOGLE_PLACE_ID')
  }

  return { apiKey, placeId }
}

function reviewDateFromPublishTime(publishTime?: string) {
  if (!publishTime) return new Date().toISOString().slice(0, 10)
  const parsed = new Date(publishTime)
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10)
  return parsed.toISOString().slice(0, 10)
}

function normalizeReviewText(review: GooglePlaceReview) {
  return review.originalText?.text?.trim()
    || review.text?.text?.trim()
    || ''
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

  if (!response.ok) {
    throw new Error(payload.error?.message ?? 'Failed to fetch Google reviews')
  }

  return payload
}

export function mapGooglePlaceReviewsToRows(place: GooglePlaceReviewResponse): GoogleReviewSyncRow[] {
  const rows: GoogleReviewSyncRow[] = []

  for (const review of place.reviews ?? []) {
    const reviewText = normalizeReviewText(review)
    const rating = Math.max(1, Math.min(5, Math.round(review.rating ?? 0)))
    const reviewId = review.name?.trim()

    if (!reviewId || !reviewText || !rating) {
      continue
    }

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
        relative_publish_time_description: review.relativePublishTimeDescription ?? null,
        publish_time: review.publishTime ?? null,
        google_maps_uri: review.googleMapsUri ?? null,
        author_profile_uri: review.authorAttribution?.uri ?? null,
        localized_text: review.text?.text ?? null,
        localized_language: review.text?.languageCode ?? null,
        original_text: review.originalText?.text ?? null,
        original_language: review.originalText?.languageCode ?? null,
        visit_date: review.visitDate ?? null,
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
