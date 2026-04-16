import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { syncEodReportToGoogleSheet, syncEodCashCountToGoogleSheet } from '@/lib/eodGoogleSheet'

export async function POST(req: NextRequest) {

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

    const [eodResult, cashResult] = await Promise.all([
      syncEodReportToGoogleSheet(report),
      report.actual_cash_on_hand != null
        ? syncEodCashCountToGoogleSheet({
            id: report.id,
            session_date: report.session_date,
            actual_cash_on_hand: Number(report.actual_cash_on_hand),
            updated_at: report.updated_at,
          })
        : Promise.resolve({ success: true, skipped: true, reason: 'No actual_cash_on_hand' }),
    ])
    return NextResponse.json({ eod: eodResult, cashLog: cashResult })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync EOD report to Google Sheets' },
      { status: 500 }
    )
  }
}
