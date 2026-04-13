import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { APP_SESSION_COOKIE, parseAppSessionValue } from '@/lib/appAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { syncEodReportToGoogleSheet } from '@/lib/eodGoogleSheet'

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const isAdminSession = isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)
  const appSession = parseAppSessionValue(cookieStore.get(APP_SESSION_COOKIE)?.value)

  if (!isAdminSession && !appSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { report_id } = await req.json() as { report_id?: string }
    if (!report_id) return NextResponse.json({ error: 'Missing report_id' }, { status: 400 })

    const { data: report, error } = await supabaseAdmin
      .from('eod_reports')
      .select('*, closed_by:employees(name)')
      .eq('id', report_id)
      .single()

    if (error || !report) {
      return NextResponse.json({ error: error?.message ?? 'Report not found' }, { status: 404 })
    }

    const result = await syncEodReportToGoogleSheet(report)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync EOD report to Google Sheets' },
      { status: 500 }
    )
  }
}
