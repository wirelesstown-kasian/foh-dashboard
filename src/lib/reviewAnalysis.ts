import { supabaseAdmin } from '@/lib/supabaseAdmin'

type GoogleReviewRow = {
  id: string
  review_text: string
  review_date: string
  rating: number
  matched_employee_id: string | null
  attribution_status: string
}

type RosterEmployee = {
  id: string
  name: string
  role: string
}

export interface ReviewAnalysisResult {
  success: true
  review_id: string
  matched_employee_id: string | null
  matched_employee_name: string | null
  confidence: number
  attribution_status: 'auto_match' | 'ai_estimate' | 'unassigned'
  sentiment: 'positive' | 'neutral' | 'negative' | null
  categories: string[]
  staff_mentions: string[]
  reason: string
}

type OpenAiAnalysisResult = {
  matched_employee_id: string | null
  confidence: number
  reason: string
  sentiment: 'positive' | 'neutral' | 'negative'
  categories: Array<'food' | 'service' | 'wait_time' | 'ambiance' | 'price'>
  staff_mentions: string[]
}

type DirectMention = {
  employee: RosterEmployee
  mention: string
  index: number
  confidence: number
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getEmployeeNameParts(name: string) {
  return name
    .split(/\s+/)
    .map(part => part.trim())
    .filter(part => part.length >= 2)
}

function findDirectStaffMention(reviewText: string, roster: RosterEmployee[]): OpenAiAnalysisResult | null {
  const mentions: DirectMention[] = []
  const mentionedEmployeeIds = new Set<string>()

  for (const employee of roster) {
    const fullName = employee.name.trim()
    if (!fullName) continue
    const fullNamePattern = new RegExp(`\\b${escapeRegExp(fullName)}\\b`, 'i')
    const fullNameMatch = reviewText.match(fullNamePattern)
    if (fullNameMatch?.index != null) {
      mentions.push({
        employee,
        mention: employee.name,
        index: fullNameMatch.index,
        confidence: 98,
      })
      mentionedEmployeeIds.add(employee.id)
    }
  }

  const firstNameCounts = new Map<string, number>()
  for (const employee of roster) {
    const firstName = getEmployeeNameParts(employee.name)[0]?.toLowerCase()
    if (!firstName || firstName.length < 3) continue
    firstNameCounts.set(firstName, (firstNameCounts.get(firstName) ?? 0) + 1)
  }

  for (const employee of roster) {
    if (mentionedEmployeeIds.has(employee.id)) continue
    const firstName = getEmployeeNameParts(employee.name)[0]
    if (!firstName || firstName.length < 3 || firstNameCounts.get(firstName.toLowerCase()) !== 1) continue
    const firstNamePattern = new RegExp(`\\b${escapeRegExp(firstName)}\\b`, 'i')
    const firstNameMatch = reviewText.match(firstNamePattern)
    if (firstNameMatch?.index != null) {
      mentions.push({
        employee,
        mention: firstName,
        index: firstNameMatch.index,
        confidence: 94,
      })
      mentionedEmployeeIds.add(employee.id)
    }
  }

  if (mentions.length === 0) return null

  const orderedMentions = mentions.sort((left, right) => left.index - right.index)
  const primaryMention = orderedMentions[0]
  const staffMentions = orderedMentions.map(item => item.mention)

  return {
    matched_employee_id: primaryMention.employee.id,
    confidence: primaryMention.confidence,
    reason: `Review directly mentions ${staffMentions.join(', ')}.`,
    sentiment: 'positive',
    categories: ['service'],
    staff_mentions: staffMentions,
  }
}

const openAiSchema = {
  name: 'review_staff_match',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      matched_employee_id: {
        anyOf: [
          { type: 'string' },
          { type: 'null' },
        ],
      },
      confidence: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
      },
      reason: { type: 'string' },
      sentiment: {
        type: 'string',
        enum: ['positive', 'neutral', 'negative'],
      },
      categories: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['food', 'service', 'wait_time', 'ambiance', 'price'],
        },
      },
      staff_mentions: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['matched_employee_id', 'confidence', 'reason', 'sentiment', 'categories', 'staff_mentions'],
  },
} as const

function getAttributionStatus(result: OpenAiAnalysisResult): 'auto_match' | 'ai_estimate' | 'unassigned' {
  if (result.matched_employee_id && result.confidence >= 90) return 'auto_match'
  if (result.matched_employee_id && result.confidence >= 70) return 'ai_estimate'
  return 'unassigned'
}

function getAssignedMethod(result: OpenAiAnalysisResult) {
  if (result.matched_employee_id && result.confidence >= 90) return 'openai_auto_match'
  if (result.matched_employee_id && result.confidence >= 70) return 'openai_estimate'
  return 'openai_unassigned'
}

async function analyzeWithOpenAI(review: GoogleReviewRow, roster: RosterEmployee[]) {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY')
  }

  const staffOptions = roster.map(emp => ({
    employee_id: emp.id,
    name: emp.name,
    role: emp.role,
  }))

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: {
        type: 'json_schema',
        json_schema: openAiSchema,
      },
      messages: [
        {
          role: 'system',
          content: [
            'You analyze restaurant reviews and attribute them to the most likely front-of-house employee.',
            'Use only the review text, star rating, and the provided staff roster.',
            'If there is no reliable match, return matched_employee_id as null.',
            'Confidence >= 90 means very strong direct evidence such as a clear name mention.',
            'Confidence 70-89 means plausible but still needs manager confirmation.',
            'Below 70 should not auto-assign.',
            'Return JSON only.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            review_text: review.review_text,
            review_date: review.review_date,
            star_rating: review.rating,
            staff_roster: staffOptions,
          }),
        },
      ],
    }),
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => ({})) as {
    choices?: Array<{ message?: { content?: string; refusal?: string } }>
    error?: { message?: string }
  }

  if (!response.ok) {
    throw new Error(payload.error?.message ?? 'OpenAI analysis failed')
  }

  const content = payload.choices?.[0]?.message?.content
  if (!content) {
    throw new Error(payload.choices?.[0]?.message?.refusal ?? 'No analysis returned')
  }

  return JSON.parse(content) as OpenAiAnalysisResult
}

export async function analyzeStoredReview(reviewId: string): Promise<ReviewAnalysisResult> {
  const [reviewResult, rosterResult] = await Promise.all([
    supabaseAdmin
      .from('google_reviews')
      .select('id, review_text, review_date, rating, matched_employee_id, attribution_status')
      .eq('id', reviewId)
      .single(),
    supabaseAdmin
      .from('employees')
      .select('id, name, role')
      .eq('is_active', true)
      .neq('primary_department', 'boh')
      .order('name'),
  ])

  if (reviewResult.error || !reviewResult.data) {
    throw new Error(reviewResult.error?.message ?? 'Review not found')
  }

  const review = reviewResult.data as GoogleReviewRow

  if (review.attribution_status === 'manual') {
    throw new Error('Manual assignment preserved')
  }

  const roster = (rosterResult.data ?? []) as RosterEmployee[]

  const analysis = findDirectStaffMention(review.review_text, roster) ?? await analyzeWithOpenAI(review, roster)
  const attributionStatus = getAttributionStatus(analysis)
  const assignedMethod = getAssignedMethod(analysis)

  const { error: updateError } = await supabaseAdmin
    .from('google_reviews')
    .update({
      matched_employee_id: attributionStatus === 'unassigned' ? null : analysis.matched_employee_id,
      confidence: analysis.confidence,
      reason: analysis.reason,
      sentiment: analysis.sentiment,
      categories: analysis.categories,
      staff_mentions: analysis.staff_mentions,
      attribution_status: attributionStatus,
      assigned_method: assignedMethod,
      updated_at: new Date().toISOString(),
    })
    .eq('id', reviewId)

  if (updateError) {
    throw new Error(updateError.message)
  }

  return {
    success: true,
    review_id: reviewId,
    matched_employee_id: attributionStatus === 'unassigned' ? null : analysis.matched_employee_id,
    matched_employee_name: analysis.matched_employee_id
      ? roster.find(emp => emp.id === analysis.matched_employee_id)?.name ?? null
      : null,
    confidence: analysis.confidence,
    attribution_status: attributionStatus,
    sentiment: analysis.sentiment,
    categories: analysis.categories,
    staff_mentions: analysis.staff_mentions,
    reason: analysis.reason,
  }
}
