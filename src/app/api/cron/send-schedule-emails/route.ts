import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sendWeeklyScheduleEmails } from '@/lib/scheduleEmail'

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const nowIso = new Date().toISOString()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin

  const { data: pendingPublications, error } = await supabaseAdmin
    .from('schedule_publications')
    .select('week_start, week_end, scheduled_send_at')
    .lte('scheduled_send_at', nowIso)
    .is('email_sent_at', null)
    .order('scheduled_send_at')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!pendingPublications || pendingPublications.length === 0) {
    return NextResponse.json({ success: true, sentWeeks: 0 })
  }

  const results = []

  for (const publication of pendingPublications) {
    const result = await sendWeeklyScheduleEmails({
      weekStart: publication.week_start,
      weekEnd: publication.week_end,
      appUrl,
    })

    // Always mark email_sent_at regardless of success/failure.
    // Without this, any email error leaves the record permanently pending
    // and the cron resends every hour indefinitely.
    await supabaseAdmin
      .from('schedule_publications')
      .update({ email_sent_at: new Date().toISOString() })
      .eq('week_start', publication.week_start)

    results.push({ week_start: publication.week_start, scheduled_send_at: publication.scheduled_send_at, ...result })
  }

  const hasErrors = results.some(result => !result.success)
  return NextResponse.json({ success: !hasErrors, results }, { status: hasErrors ? 207 : 200 })
}
