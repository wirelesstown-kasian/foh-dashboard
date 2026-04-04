import { NextRequest, NextResponse } from 'next/server'
import { subDays } from 'date-fns'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { CLOCK_PHOTO_BUCKET, getSessionCutoffIso } from '@/lib/clockUtils'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: openRecords } = await supabaseAdmin
    .from('shift_clocks')
    .select('id, session_date')
    .is('clock_out_at', null)

  for (const record of openRecords ?? []) {
    const cutoffIso = getSessionCutoffIso(record.session_date)
    if (new Date(cutoffIso) > new Date()) continue
    await supabaseAdmin
      .from('shift_clocks')
      .update({
        clock_out_at: cutoffIso,
        auto_clock_out: true,
        approval_status: 'pending_review',
        approved_hours: null,
        manager_note: 'Auto clock-out triggered at business cutoff. Manager approval required.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', record.id)
  }

  const cutoffIso = subDays(new Date(), 60).toISOString()
  const { data, error } = await supabaseAdmin
    .from('shift_clocks')
    .select('id, clock_in_photo_path, clock_out_photo_path')
    .lt('created_at', cutoffIso)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const paths = Array.from(new Set(
    (data ?? [])
      .flatMap(record => [record.clock_in_photo_path, record.clock_out_photo_path])
      .filter(Boolean)
  )) as string[]

  if (paths.length > 0) {
    await supabaseAdmin.storage.from(CLOCK_PHOTO_BUCKET).remove(paths)
  }

  const ids = (data ?? []).map(record => record.id)
  if (ids.length > 0) {
    await supabaseAdmin
      .from('shift_clocks')
      .update({
        clock_in_photo_path: '',
        clock_out_photo_path: null,
        updated_at: new Date().toISOString(),
      })
      .in('id', ids)
  }

  return NextResponse.json({ success: true, cleaned: ids.length })
}
