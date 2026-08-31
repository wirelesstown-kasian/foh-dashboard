import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

async function requireAdmin() {
  const cookieStore = await cookies()
  return isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)
}

function isMissingRewardsTable(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? ''
  return message.includes('reward_catalog') || message.includes('reward_redemptions') || error?.code === '42P01'
}

function normalizePoints(value: unknown) {
  const points = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : 0
  return Number.isFinite(points) ? Math.round(points) : 0
}

export async function GET() {
  const isAdmin = await requireAdmin()

  const rewardsResult = await supabaseAdmin.from('reward_catalog').select('*').eq('is_active', true).order('display_order')
  const redemptionsResult = isAdmin
    ? await supabaseAdmin
        .from('reward_redemptions')
        .select('*, employee:employees(id, name, role, primary_department, is_active), reward:reward_catalog(*)')
        .order('redeemed_at', { ascending: false })
        .order('created_at', { ascending: false })
    : { data: [], error: null }

  if (isMissingRewardsTable(rewardsResult.error) || isMissingRewardsTable(redemptionsResult.error)) {
    return NextResponse.json({ rewards: [], redemptions: [], setup_required: true })
  }

  if (rewardsResult.error || redemptionsResult.error) {
    return NextResponse.json({
      error: rewardsResult.error?.message ?? redemptionsResult.error?.message ?? 'Failed to load rewards',
    }, { status: 500 })
  }

  return NextResponse.json({
    rewards: rewardsResult.data ?? [],
    redemptions: redemptionsResult.data ?? [],
  })
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as {
    action?: string
    id?: string
    name?: string
    description?: string
    points_cost?: number | string
    employee_id?: string
    reward_id?: string | null
    points_delta?: number | string
    memo?: string
    redeemed_at?: string
  }

  if (body.action === 'reward') {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'Reward name is required' }, { status: 400 })
    const pointsCost = Math.max(0, normalizePoints(body.points_cost))
    const payload = {
      name,
      points_cost: pointsCost,
      description: typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null,
    }

    const result = body.id
      ? await supabaseAdmin.from('reward_catalog').update(payload).eq('id', body.id).select('*').single()
      : await supabaseAdmin.from('reward_catalog').insert(payload).select('*').single()

    if (isMissingRewardsTable(result.error)) {
      return NextResponse.json({ error: 'Run migration 034_add_rewards_points.sql before saving rewards.' }, { status: 400 })
    }
    if (result.error || !result.data) return NextResponse.json({ error: result.error?.message ?? 'Failed to save reward' }, { status: 500 })
    return NextResponse.json({ success: true, reward: result.data })
  }

  if (body.action === 'archive_reward') {
    if (!body.id) return NextResponse.json({ error: 'Reward id is required' }, { status: 400 })
    const result = await supabaseAdmin.from('reward_catalog').update({ is_active: false }).eq('id', body.id)
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  if (body.action === 'redemption') {
    if (typeof body.employee_id !== 'string' || !body.employee_id) {
      return NextResponse.json({ error: 'Employee is required' }, { status: 400 })
    }
    const pointsDelta = normalizePoints(body.points_delta)
    if (pointsDelta === 0) return NextResponse.json({ error: 'Points change is required' }, { status: 400 })
    const memo = typeof body.memo === 'string' ? body.memo.trim() : ''
    if (!memo) return NextResponse.json({ error: 'Memo is required for redemption or deduction' }, { status: 400 })

    const result = await supabaseAdmin
      .from('reward_redemptions')
      .insert({
        employee_id: body.employee_id,
        reward_id: body.reward_id || null,
        points_delta: pointsDelta,
        memo,
        redeemed_at: typeof body.redeemed_at === 'string' && body.redeemed_at ? body.redeemed_at : new Date().toISOString().slice(0, 10),
      })
      .select('*, employee:employees(id, name, role, primary_department, is_active), reward:reward_catalog(*)')
      .single()

    if (isMissingRewardsTable(result.error)) {
      return NextResponse.json({ error: 'Run migration 034_add_rewards_points.sql before saving redemptions.' }, { status: 400 })
    }
    if (result.error || !result.data) return NextResponse.json({ error: result.error?.message ?? 'Failed to save redemption' }, { status: 500 })
    return NextResponse.json({ success: true, redemption: result.data })
  }

  return NextResponse.json({ error: 'Invalid rewards action' }, { status: 400 })
}
