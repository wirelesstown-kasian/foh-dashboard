import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getReviewAssignableEmployees } from '@/lib/reviewEmployees'

type GoogleReviewRow = {
  id: string
  review_text: string
  review_date: string
  rating: number
  matched_employee_id: string | null
  matched_employee_ids?: string[] | null
  attribution_status: string
}

type RosterEmployee = {
  id: string
  name: string
  role: string
  primary_department?: string
  schedule_departments?: string[]
  email?: string | null
  is_active: boolean
}

export interface ReviewAnalysisResult {
  success: true
  review_id: string
  matched_employee_id: string | null
  matched_employee_ids: string[]
  matched_employee_name: string | null
  matched_employee_names: string[]
  confidence: number
  attribution_status: 'auto_match' | 'ai_estimate' | 'unassigned'
  sentiment: 'positive' | 'neutral' | 'negative' | null
  categories: string[]
  staff_mentions: string[]
  reason: string
}

type ReviewAnalysisInput = {
  review: GoogleReviewRow
  roster: RosterEmployee[]
}

type OpenAiAnalysisResult = {
  matched_employee_id: string | null
  matched_employee_ids: string[]
  confidence: number
  reason: string
  sentiment: 'positive' | 'neutral' | 'negative'
  categories: Array<'food' | 'service' | 'wait_time' | 'ambiance' | 'price'>
  staff_mentions: string[]
}

type ReviewAnalysisCategory = OpenAiAnalysisResult['categories'][number]

type DirectMention = {
  employee: RosterEmployee
  mention: string
  index: number
  confidence: number
}

const UNSAFE_FIRST_NAME_ALIASES = new Set([
  'all',
  'admin',
  'everyone',
  'everybody',
  'food',
  'host',
  'new',
  'server',
  'service',
  'staff',
  'team',
  'village',
])

const CATEGORY_PATTERNS: Array<[ReviewAnalysisCategory, RegExp[]]> = [
  ['food', [
    /\bfood\b/i,
    /\bdelicious\b/i,
    /\btasty\b/i,
    /\bflavou?r\b/i,
    /\bmeal\b/i,
    /\bdish(?:es)?\b/i,
    /\bmenu\b/i,
    /\bkorean\b/i,
    /\bkimchi\b/i,
    /\bspicy\b/i,
    /\beat(?:ing)?\b/i,
  ]],
  ['service', [
    /\bservice\b/i,
    /\bstaff\b/i,
    /\bserver\b/i,
    /\bserving\b/i,
    /\bserved\b/i,
    /\bwaiter\b/i,
    /\bwaitress\b/i,
    /\bbartender\b/i,
    /\bfriendly\b/i,
    /\battentive\b/i,
    /\bhelpful\b/i,
    /\bkind\b/i,
    /\bwater\b/i,
  ]],
  ['wait_time', [
    /\bwait(?:ed|ing)?\b/i,
    /\bslow\b/i,
    /\bquick\b/i,
    /\bfast\b/i,
    /\bdelay(?:ed)?\b/i,
    /\blong time\b/i,
  ]],
  ['ambiance', [
    /\bvibe(?:s)?\b/i,
    /\batmosphere\b/i,
    /\bambi[ae]nce\b/i,
    /\bmusic\b/i,
    /\bdecor\b/i,
    /\bclean\b/i,
    /\bplace\b/i,
    /\bspot\b/i,
    /\benvironment\b/i,
  ]],
  ['price', [
    /\bprice(?:d|s)?\b/i,
    /\bexpensive\b/i,
    /\bcheap\b/i,
    /\bvalue\b/i,
    /\bcost\b/i,
    /\boverpriced\b/i,
    /\bworth\b/i,
  ]],
]

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeMatchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function getEmployeeNameParts(name: string) {
  return normalizeMatchText(name)
    .split(' ')
    .filter(part => part.length >= 2)
}

function detectReviewCategories(reviewText: string): ReviewAnalysisCategory[] {
  return CATEGORY_PATTERNS
    .filter(([, patterns]) => patterns.some(pattern => pattern.test(reviewText)))
    .map(([category]) => category)
}

function uniqueCategories(categories: ReviewAnalysisCategory[]) {
  return Array.from(new Set(categories))
}

function findNormalizedAliasIndex(reviewText: string, alias: string) {
  const normalizedReview = ` ${normalizeMatchText(reviewText)} `
  const normalizedAlias = normalizeMatchText(alias)
  if (!normalizedAlias) return -1
  return normalizedReview.indexOf(` ${normalizedAlias} `)
}

function buildFirstNameCounts(roster: RosterEmployee[]) {
  const firstNameCounts = new Map<string, number>()
  for (const employee of roster) {
    const firstName = getEmployeeNameParts(employee.name)[0]?.toLowerCase()
    if (!firstName || firstName.length < 3 || UNSAFE_FIRST_NAME_ALIASES.has(firstName)) continue
    firstNameCounts.set(firstName, (firstNameCounts.get(firstName) ?? 0) + 1)
  }
  return firstNameCounts
}

function findExplicitEmployeeMention(reviewText: string, employee: RosterEmployee, firstNameCounts: Map<string, number>) {
  const fullName = employee.name.trim()
  if (!fullName) return null

  const fullNamePattern = new RegExp(`\\b${escapeRegExp(fullName)}\\b`, 'i')
  const fullNameMatch = reviewText.match(fullNamePattern)
  const normalizedFullNameIndex = findNormalizedAliasIndex(reviewText, fullName)
  if (fullNameMatch?.index != null || normalizedFullNameIndex >= 0) {
    return {
      mention: employee.name,
      index: fullNameMatch?.index ?? normalizedFullNameIndex,
      confidence: 98,
    }
  }

  const firstName = getEmployeeNameParts(employee.name)[0]
  const normalizedFirstName = firstName?.toLowerCase()
  if (
    !firstName ||
    !normalizedFirstName ||
    firstName.length < 3 ||
    UNSAFE_FIRST_NAME_ALIASES.has(normalizedFirstName) ||
    firstNameCounts.get(normalizedFirstName) !== 1
  ) {
    return null
  }

  const firstNamePattern = new RegExp(`\\b${escapeRegExp(firstName)}\\b`, 'i')
  const firstNameMatch = reviewText.match(firstNamePattern)
  const normalizedFirstNameIndex = findNormalizedAliasIndex(reviewText, firstName)
  if (firstNameMatch?.index != null || normalizedFirstNameIndex >= 0) {
    return {
      mention: firstName,
      index: firstNameMatch?.index ?? normalizedFirstNameIndex,
      confidence: 94,
    }
  }

  return null
}

function findExplicitStaffMentions(reviewText: string, roster: RosterEmployee[]) {
  const mentions: DirectMention[] = []
  const firstNameCounts = buildFirstNameCounts(roster)

  for (const employee of roster) {
    const match = findExplicitEmployeeMention(reviewText, employee, firstNameCounts)
    if (!match) continue
    mentions.push({
      employee,
      ...match,
    })
  }

  return mentions
}

function findDirectStaffMention(reviewText: string, roster: RosterEmployee[]): OpenAiAnalysisResult | null {
  const mentions = findExplicitStaffMentions(reviewText, roster)

  if (mentions.length === 0) return null

  const orderedMentions = mentions.sort((left, right) => left.index - right.index)
  const primaryMention = orderedMentions[0]
  const staffMentions = orderedMentions.map(item => item.mention)
  const categories = uniqueCategories([...detectReviewCategories(reviewText), 'service'])

  return {
    matched_employee_id: primaryMention.employee.id,
    matched_employee_ids: orderedMentions.map(item => item.employee.id),
    confidence: primaryMention.confidence,
    reason: `Review directly mentions ${staffMentions.join(', ')}.`,
    sentiment: 'positive',
    categories,
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
      matched_employee_ids: {
        type: 'array',
        items: { type: 'string' },
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
    required: ['matched_employee_id', 'matched_employee_ids', 'confidence', 'reason', 'sentiment', 'categories', 'staff_mentions'],
  },
} as const

function getAttributionStatus(result: OpenAiAnalysisResult): 'auto_match' | 'ai_estimate' | 'unassigned' {
  if (result.matched_employee_ids.length > 0 && result.confidence >= 90) return 'auto_match'
  if (result.matched_employee_ids.length > 0 && result.confidence >= 70) return 'ai_estimate'
  return 'unassigned'
}

function getAssignedMethod(result: OpenAiAnalysisResult) {
  if (result.matched_employee_ids.length > 0 && result.confidence >= 90) return 'openai_auto_match'
  if (result.matched_employee_ids.length > 0 && result.confidence >= 70) return 'openai_estimate'
  return 'openai_unassigned'
}

function isMissingAnalysisTrackingColumn(error: { message?: string; code?: string; details?: string | null; hint?: string | null }) {
  const text = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase()
  return error.code === 'PGRST204' || text.includes('last_analyzed_at') || text.includes('analysis_error')
}

function normalizeMatchedEmployeeIds(analysis: OpenAiAnalysisResult, roster: RosterEmployee[], reviewText: string) {
  const rosterIds = new Set(roster.map(employee => employee.id))
  const explicitlyMentionedIds = new Set(findExplicitStaffMentions(reviewText, roster).map(mention => mention.employee.id))
  const ids = [
    ...(Array.isArray(analysis.matched_employee_ids) ? analysis.matched_employee_ids : []),
    analysis.matched_employee_id,
  ]

  return Array.from(new Set(
    ids.filter((employeeId): employeeId is string =>
      typeof employeeId === 'string' &&
      rosterIds.has(employeeId) &&
      explicitlyMentionedIds.has(employeeId)
    )
  ))
}

function normalizeStaffMentionsForAssignedEmployees(reviewText: string, roster: RosterEmployee[], employeeIds: string[]) {
  const allowedIds = new Set(employeeIds)
  return findExplicitStaffMentions(reviewText, roster)
    .filter(mention => allowedIds.has(mention.employee.id))
    .sort((left, right) => left.index - right.index)
    .map(mention => mention.mention)
}

async function getReviewAnalysisInput(reviewId: string): Promise<ReviewAnalysisInput> {
  const [reviewResult, rosterResult] = await Promise.all([
    supabaseAdmin
      .from('google_reviews')
      .select('id, review_text, review_date, rating, matched_employee_id, matched_employee_ids, attribution_status')
      .eq('id', reviewId)
      .single(),
    supabaseAdmin
      .from('employees')
      .select('id, name, role, primary_department, schedule_departments, email, is_active')
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

  return {
    review,
    roster: getReviewAssignableEmployees((rosterResult.data ?? []) as RosterEmployee[]),
  }
}

async function saveReviewAnalysis(
  reviewText: string,
  reviewId: string,
  roster: RosterEmployee[],
  analysis: OpenAiAnalysisResult
): Promise<ReviewAnalysisResult> {
  const categories = uniqueCategories([...analysis.categories, ...detectReviewCategories(reviewText)])
  const matchedEmployeeIds = normalizeMatchedEmployeeIds(analysis, roster, reviewText)
  const primaryEmployeeId = matchedEmployeeIds[0] ?? null
  const staffMentions = normalizeStaffMentionsForAssignedEmployees(reviewText, roster, matchedEmployeeIds)
  const normalizedAnalysis = {
    ...analysis,
    matched_employee_id: primaryEmployeeId,
    matched_employee_ids: matchedEmployeeIds,
    staff_mentions: staffMentions,
  }
  const attributionStatus = getAttributionStatus(normalizedAnalysis)
  const assignedMethod = getAssignedMethod(normalizedAnalysis)
  const assignedEmployeeIds = attributionStatus === 'unassigned' ? [] : matchedEmployeeIds

  const { error: updateError } = await supabaseAdmin
    .from('google_reviews')
    .update({
      matched_employee_id: assignedEmployeeIds[0] ?? null,
      matched_employee_ids: assignedEmployeeIds,
      confidence: analysis.confidence,
      reason: analysis.reason,
      sentiment: analysis.sentiment,
      categories,
      staff_mentions: normalizedAnalysis.staff_mentions,
      attribution_status: attributionStatus,
      assigned_method: assignedMethod,
      last_analyzed_at: new Date().toISOString(),
      analysis_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', reviewId)

  if (updateError) {
    if (!isMissingAnalysisTrackingColumn(updateError)) {
      throw new Error(updateError.message)
    }

    const fallbackUpdate = await supabaseAdmin
      .from('google_reviews')
      .update({
        matched_employee_id: assignedEmployeeIds[0] ?? null,
        matched_employee_ids: assignedEmployeeIds,
        confidence: analysis.confidence,
        reason: analysis.reason,
        sentiment: analysis.sentiment,
        categories,
        staff_mentions: normalizedAnalysis.staff_mentions,
        attribution_status: attributionStatus,
        assigned_method: assignedMethod,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reviewId)

    if (fallbackUpdate.error) {
      throw new Error(fallbackUpdate.error.message)
    }
  }

  return {
    success: true,
    review_id: reviewId,
    matched_employee_id: assignedEmployeeIds[0] ?? null,
    matched_employee_ids: assignedEmployeeIds,
    matched_employee_name: assignedEmployeeIds[0]
      ? roster.find(emp => emp.id === assignedEmployeeIds[0])?.name ?? null
      : null,
    matched_employee_names: assignedEmployeeIds
      .map(employeeId => roster.find(emp => emp.id === employeeId)?.name ?? null)
      .filter((name): name is string => name !== null),
    confidence: analysis.confidence,
    attribution_status: attributionStatus,
    sentiment: analysis.sentiment,
    categories,
    staff_mentions: normalizedAnalysis.staff_mentions,
    reason: analysis.reason,
  }
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
            'If multiple staff members are clearly mentioned, return every matching employee_id in matched_employee_ids and put the first/primary one in matched_employee_id.',
            'Direct name mentions should be credited to all clearly mentioned matching employees; do not choose only one when several staff names appear.',
            'Do not credit broad phrases like everyone, everybody, staff, team, servers, or great service unless the review also names the employee.',
            'Never infer a staff member from role, department, schedule, or general service praise.',
            'If there is no reliable match, return matched_employee_id as null and matched_employee_ids as an empty array.',
            'Confidence >= 90 requires a direct employee name mention.',
            'Confidence 70-89 requires a direct employee name mention but may need manager confirmation.',
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
  const { review, roster } = await getReviewAnalysisInput(reviewId)
  const analysis = findDirectStaffMention(review.review_text, roster) ?? await analyzeWithOpenAI(review, roster)
  return saveReviewAnalysis(review.review_text, reviewId, roster, analysis)
}

export async function analyzeStoredReviewDirectMention(reviewId: string): Promise<ReviewAnalysisResult | null> {
  const { review, roster } = await getReviewAnalysisInput(reviewId)
  const analysis = findDirectStaffMention(review.review_text, roster)
  if (!analysis) return null
  return saveReviewAnalysis(review.review_text, reviewId, roster, analysis)
}
