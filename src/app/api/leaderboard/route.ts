import { format, startOfMonth } from 'date-fns'
import { NextRequest, NextResponse } from 'next/server'
import {
  EMPLOYEE_PUBLIC_SELECT,
  EMPLOYEE_PUBLIC_SELECT_FALLBACK,
  EMPLOYEE_PUBLIC_SELECT_WITHOUT_MEAL_BREAK_THRESHOLD,
  EMPLOYEE_PUBLIC_SELECT_WITHOUT_TIP_ELIGIBLE,
  isMissingAddressColumn,
  isMissingMealBreakThresholdColumn,
  isMissingPaymentMethodColumn,
  isMissingTipEligibleColumn,
  isMissingTipPoolRateColumn,
  withMealBreakThresholdHours,
  withPaymentMethod,
  withStaffingProfileFields,
  withTipEligible,
  withTipPoolHourlyRate,
} from '@/lib/employeeSelect'
import { isReviewBoardSetupMissingError, normalizeReviewRow } from '@/lib/reviewBoard'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { Employee, EodReport, GoogleReview, RewardRedemption, ShiftClock, Task, TaskCompletion, TipDistribution } from '@/lib/types'

export const dynamic = 'force-dynamic'

function isMissingRewardsTable(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? ''
  return message.includes('reward_catalog') || message.includes('reward_redemptions') || error?.code === '42P01'
}

async function loadEmployees() {
  let res = await supabaseAdmin
    .from('employees')
    .select(EMPLOYEE_PUBLIC_SELECT)
    .eq('is_active', true)
    .order('name') as { data: object[] | null; error: { message?: string; code?: string } | null }

  if (res.error && isMissingMealBreakThresholdColumn(res.error)) {
    res = await supabaseAdmin
      .from('employees')
      .select(EMPLOYEE_PUBLIC_SELECT_WITHOUT_MEAL_BREAK_THRESHOLD)
      .eq('is_active', true)
      .order('name') as { data: object[] | null; error: { message?: string; code?: string } | null }
  }

  if (res.error && isMissingTipEligibleColumn(res.error)) {
    res = await supabaseAdmin
      .from('employees')
      .select(EMPLOYEE_PUBLIC_SELECT_WITHOUT_TIP_ELIGIBLE)
      .eq('is_active', true)
      .order('name') as { data: object[] | null; error: { message?: string; code?: string } | null }
  }

  if (res.error && (isMissingTipPoolRateColumn(res.error) || isMissingPaymentMethodColumn(res.error) || isMissingAddressColumn(res.error))) {
    res = await supabaseAdmin
      .from('employees')
      .select(EMPLOYEE_PUBLIC_SELECT_FALLBACK)
      .eq('is_active', true)
      .order('name') as { data: object[] | null; error: { message?: string; code?: string } | null }
  }

  if (res.error) throw new Error(res.error.message ?? 'Failed to load employees')

  return withTipEligible(
    withMealBreakThresholdHours(
      withStaffingProfileFields(
        withPaymentMethod(withTipPoolHourlyRate(res.data ?? []))
      )
    )
  ) as Employee[]
}

export async function GET(req: NextRequest) {
  try {
    const today = format(new Date(), 'yyyy-MM-dd')
    const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')
    const startDate = req.nextUrl.searchParams.get('start_date') || monthStart
    const endDate = req.nextUrl.searchParams.get('end_date') || today

    const employees = await loadEmployees()
    const [
      tasksResult,
      completionsResult,
      eodReportsResult,
      clockRecordsResult,
      reviewsResult,
      redemptionsResult,
    ] = await Promise.all([
      supabaseAdmin
        .from('tasks')
        .select('*, category:task_categories(*)')
        .eq('is_active', true)
        .order('display_order'),
      supabaseAdmin
        .from('task_completions')
        .select('*')
        .gte('session_date', startDate)
        .lte('session_date', endDate),
      supabaseAdmin
        .from('eod_reports')
        .select('*, tip_distributions(*, employee:employees(*))')
        .gte('session_date', startDate)
        .lte('session_date', endDate)
        .order('session_date', { ascending: false }),
      supabaseAdmin
        .from('shift_clocks')
        .select('*')
        .gte('session_date', startDate)
        .lte('session_date', endDate),
      supabaseAdmin
        .from('google_reviews')
        .select('*')
        .gte('review_date', startDate)
        .lte('review_date', endDate)
        .order('review_date', { ascending: false }),
      supabaseAdmin
        .from('reward_redemptions')
        .select('*, employee:employees(id, name, role, primary_department, is_active), reward:reward_catalog(*)')
        .gte('redeemed_at', startDate)
        .lte('redeemed_at', endDate)
        .order('redeemed_at', { ascending: false }),
    ])

    const firstError = tasksResult.error
      ?? completionsResult.error
      ?? eodReportsResult.error
      ?? clockRecordsResult.error
      ?? null
    if (firstError) throw new Error(firstError.message)

    if (reviewsResult.error && !isReviewBoardSetupMissingError(reviewsResult.error)) {
      throw new Error(reviewsResult.error.message)
    }
    if (redemptionsResult.error && !isMissingRewardsTable(redemptionsResult.error)) {
      throw new Error(redemptionsResult.error.message)
    }

    return NextResponse.json({
      employees,
      tasks: (tasksResult.data ?? []) as Task[],
      completions: (completionsResult.data ?? []) as TaskCompletion[],
      eodReports: (eodReportsResult.data ?? []) as (EodReport & { tip_distributions?: (TipDistribution & { employee?: Employee })[] })[],
      clockRecords: (clockRecordsResult.data ?? []) as ShiftClock[],
      reviews: reviewsResult.error
        ? []
        : ((reviewsResult.data ?? []) as GoogleReview[]).map(review => normalizeReviewRow(review, employees)),
      redemptions: redemptionsResult.error ? [] : ((redemptionsResult.data ?? []) as RewardRedemption[]),
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load leaderboard data' }, { status: 500 })
  }
}
