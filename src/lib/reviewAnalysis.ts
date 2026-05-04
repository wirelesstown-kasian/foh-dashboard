import { supabaseAdmin } from '@/lib/supabaseAdmin'

type GoogleReviewRow = {
  id: string
  review_text: string
  review_date: string
  rating: number
  matched_employee_id: string | null
  attribution_status: string
}

type EmployeeClockRow = {
  employee_id: string
  clock_in_at: string
  clock_out_at: string | null
  employee?: {
    id: string
    name: string
    role: string
    primary_department?: string | null
    is_active?: boolean
  } | {
    id: string
    name: string
    role: string
    primary_department?: string | null
    is_active?: boolean
  }[] | null
}

type NormalizedEmployeeClockRow = {
  employee_id: string
  clock_in_at: string
  clock_out_at: string | null
  employee: {
    id: string
    name: string
    role: string
    primary_department?: string | null
    is_active?: boolean
  } | null
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

async function analyzeWithOpenAI(review: GoogleReviewRow, staff: NormalizedEmployeeClockRow[]) {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY')
  }

  const staffOptions = staff.map(member => ({
    employee_id: member.employee_id,
    name: member.employee?.name ?? 'Unknown',
    role: member.employee?.role ?? 'unknown',
    primary_department: member.employee?.primary_department ?? null,
    clock_in_at: member.clock_in_at,
    clock_out_at: member.clock_out_at,
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
            'You analyze restaurant reviews and attribute them to the most likely front-of-house employee on duty.',
            'Use only the review text, star rating, and the provided on-duty staff list.',
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
            on_duty_staff: staffOptions,
          }),
        },
      ],
    }),
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => ({})) as {
    choices?: Array<{
      message?: {
        content?: string
        refusal?: string
      }
    }>
    error?: {
      message?: string
    }
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

function normalizeEmployeeClockRow(row: EmployeeClockRow): NormalizedEmployeeClockRow {
  const employee = Array.isArray(row.employee) ? row.employee[0] ?? null : row.employee ?? null
  return {
    ...row,
    employee,
  }
}

export async function analyzeStoredReview(reviewId: string): Promise<ReviewAnalysisResult> {
  const { data: review, error: reviewError } = await supabaseAdmin
    .from('google_reviews')
    .select('id, review_text, review_date, rating, matched_employee_id, attribution_status')
    .eq('id', reviewId)
    .single()

  if (reviewError || !review) {
    throw new Error(reviewError?.message ?? 'Review not found')
  }

  if (review.attribution_status === 'manual') {
    throw new Error('Manual assignment preserved')
  }

  const { data: clockRows, error: clockError } = await supabaseAdmin
    .from('shift_clocks')
    .select('employee_id, clock_in_at, clock_out_at, employee:employees(id, name, role, primary_department, is_active)')
    .eq('session_date', review.review_date)

  if (clockError) {
    throw new Error(clockError.message)
  }

  let staff = ((clockRows ?? []) as EmployeeClockRow[])
    .map(normalizeEmployeeClockRow)
    .filter(row => row.employee?.is_active !== false && (row.employee?.primary_department ?? 'foh') !== 'boh')

  if (staff.length === 0) {
    const { data: allFohEmployees } = await supabaseAdmin
      .from('employees')
      .select('id, name, role, primary_department, is_active')
      .eq('is_active', true)
      .neq('primary_department', 'boh')

    staff = (allFohEmployees ?? []).map(emp => ({
      employee_id: emp.id as string,
      clock_in_at: review.review_date + 'T00:00:00Z',
      clock_out_at: null,
      employee: emp as NormalizedEmployeeClockRow['employee'],
    }))
  }

  const analysis = await analyzeWithOpenAI(review as GoogleReviewRow, staff)
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
      ? staff.find(member => member.employee_id === analysis.matched_employee_id)?.employee?.name ?? null
      : null,
    confidence: analysis.confidence,
    attribution_status: attributionStatus,
    sentiment: analysis.sentiment,
    categories: analysis.categories,
    staff_mentions: analysis.staff_mentions,
    reason: analysis.reason,
  }
}
