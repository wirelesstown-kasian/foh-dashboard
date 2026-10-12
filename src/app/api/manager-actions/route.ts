import { NextRequest, NextResponse } from 'next/server'
import { businessDateInChicago } from '@/lib/dashboardDataAccess'
import { getDashboardViewer } from '@/lib/routeAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { verifyPin } from '@/lib/pin'
import { isValidPin } from '@/lib/validation'

type Action = 'reset_task_phase' | 'reset_all_tasks' | 'reset_eod'

async function verifyManagerPin(pin: string) {
  const { data, error } = await supabaseAdmin.from('employees')
    .select('pin_hash, pin_code')
    .eq('role', 'manager')
    .eq('is_active', true)
  if (error) throw new Error(error.message)
  for (const manager of data ?? []) {
    if (manager.pin_code === pin || (manager.pin_hash && await verifyPin(pin, manager.pin_hash))) return true
  }
  return false
}

export async function POST(req: NextRequest) {
  const viewer = await getDashboardViewer()
  if (!viewer) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  let body: { pin?: unknown; action?: Action; category_id?: unknown; report_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (!isValidPin(body.pin) || !await verifyManagerPin(body.pin)) {
    return NextResponse.json({ error: 'Manager PIN required' }, { status: 401 })
  }

  const date = businessDateInChicago()
  if (body.action === 'reset_task_phase') {
    if (typeof body.category_id !== 'string') return NextResponse.json({ error: 'Category required' }, { status: 400 })
    const { data: tasks, error } = await supabaseAdmin.from('tasks').select('id').eq('category_id', body.category_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const ids = (tasks ?? []).map(task => task.id)
    if (ids.length > 0) {
      const result = await supabaseAdmin.from('task_completions').delete().eq('session_date', date).in('task_id', ids)
      if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  }
  if (body.action === 'reset_all_tasks') {
    const deleted = await supabaseAdmin.from('task_completions').delete().eq('session_date', date)
    if (deleted.error) return NextResponse.json({ error: deleted.error.message }, { status: 500 })
    const session = await supabaseAdmin.from('daily_sessions').update({ current_phase: 'register_open' }).eq('session_date', date)
    if (session.error) return NextResponse.json({ error: session.error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }
  if (body.action === 'reset_eod') {
    if (typeof body.report_id !== 'string') return NextResponse.json({ error: 'Report required' }, { status: 400 })
    const report = await supabaseAdmin.from('eod_reports').select('id,session_date').eq('id', body.report_id).maybeSingle()
    if (report.error || !report.data || report.data.session_date !== date) {
      return NextResponse.json({ error: 'Current report not found' }, { status: 404 })
    }
    // The live FK uses ON DELETE CASCADE for tip_distributions.
    const deleted = await supabaseAdmin.from('eod_reports').delete().eq('id', body.report_id)
    if (deleted.error) return NextResponse.json({ error: deleted.error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
