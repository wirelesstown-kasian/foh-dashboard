import { NextRequest, NextResponse } from 'next/server'
import { chicagoDate, maybeSendOnboardingRecord } from '@/lib/onboarding'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const expiredClaim = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  await supabaseAdmin.from('onboarding_cases').update({ record_email_claimed_at: null }).lt('record_email_claimed_at', expiredClaim).is('record_email_sent_at', null)
  const due = await supabaseAdmin.from('onboarding_cases').select('id').eq('status', 'approved').lte('activation_date', chicagoDate())
  if (due.error) return NextResponse.json({ error: due.error.message }, { status: 500 })
  const results: Array<{ id: string; activated?: boolean; emailed?: boolean; error?: string }> = []
  for (const row of due.data ?? []) {
    const result = await supabaseAdmin.rpc('activate_onboarding_case', { p_case_id: row.id })
    results.push(result.error ? { id: row.id, error: result.error.message } : { id: row.id, activated: true })
  }
  const records = await supabaseAdmin.from('onboarding_cases').select('id').not('status', 'in', '(invited,cancelled)').is('record_email_sent_at', null).is('record_email_claimed_at', null)
  if (records.error) return NextResponse.json({ error: records.error.message, results }, { status: 500 })
  for (const row of records.data ?? []) {
    try { if (await maybeSendOnboardingRecord(row.id)) results.push({ id: row.id, emailed: true }) }
    catch (error) { results.push({ id: row.id, error: error instanceof Error ? error.message : 'Record email failed' }) }
  }
  return NextResponse.json({ success: true, results })
}
