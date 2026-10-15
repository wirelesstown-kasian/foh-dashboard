import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { resetEodSheetInGoogleSheet, syncEodReportToGoogleSheet, syncEodCashCountToGoogleSheet } from '@/lib/eodGoogleSheet'
import { getDashboardViewer } from '@/lib/routeAuth'
import { businessDateInChicago } from '@/lib/dashboardDataAccess'

export async function POST(req: NextRequest) {
  const viewer = await getDashboardViewer()
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { report_id, reset_sheet } = await req.json() as { report_id?: string; reset_sheet?: boolean }

    if (reset_sheet) {
      if (!viewer.isManager) return NextResponse.json({ error: 'Manager access required' }, { status: 403 })
      const { data: reports, error } = await supabaseAdmin
        .from('eod_reports')
        .select('*, closed_by:employees(name)')
        .order('session_date', { ascending: false })
        .order('updated_at', { ascending: false })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const result = await resetEodSheetInGoogleSheet(reports ?? [])
      return NextResponse.json({ eod: result, cashLog: { success: true, skipped: true, reason: 'Reset only affects the EOD sheet.' } })
    }

    if (!report_id) return NextResponse.json({ error: 'Missing report_id' }, { status: 400 })

    if (!viewer.isManager) {
      const { data: authorizedReport } = await supabaseAdmin
        .from('eod_reports')
        .select('session_date')
        .eq('id', report_id)
        .maybeSingle()
      if (authorizedReport?.session_date !== businessDateInChicago()) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
      }
    }

    const [{ data: report, error }, { data: allReports }, { data: allCashEntries }] = await Promise.all([
      supabaseAdmin.from('eod_reports').select('*, closed_by:employees(name)').eq('id', report_id).single(),
      supabaseAdmin.from('eod_reports').select('actual_cash_on_hand').gt('actual_cash_on_hand', 0),
      supabaseAdmin.from('cash_balance_entries').select('entry_type, amount'),
    ])

    if (error || !report) {
      return NextResponse.json({ error: error?.message ?? 'Report not found' }, { status: 404 })
    }

    // Running balance = sum of all EOD actual cash + sum of all cash in/out entries (same logic as UI)
    const eodCashTotal = (allReports ?? []).reduce((sum, r) => sum + Number(r.actual_cash_on_hand ?? 0), 0)
    const cashEntryTotal = (allCashEntries ?? []).reduce((sum, e) => {
      return sum + (e.entry_type === 'cash_in' ? Number(e.amount) : -Number(e.amount))
    }, 0)
    const runningBalance = eodCashTotal + cashEntryTotal

    const [eodResult, cashResult] = await Promise.allSettled([
      syncEodReportToGoogleSheet(report),
      report.actual_cash_on_hand != null
        ? syncEodCashCountToGoogleSheet({
            id: report.id,
            session_date: report.session_date,
            actual_cash_on_hand: Number(report.actual_cash_on_hand),
            updated_at: report.updated_at,
            cash_total: Number(report.cash_total ?? 0),
            cash_tip: Number(report.cash_tip ?? 0),
            cash_on_hand: runningBalance,
          })
        : Promise.resolve({ success: true, skipped: true, reason: 'No actual_cash_on_hand' }),
    ])

    if (eodResult.status === 'rejected' || cashResult.status === 'rejected') {
      return NextResponse.json(
        {
          error: 'Google Sheets sync failed',
          eod: eodResult.status === 'fulfilled' ? eodResult.value : { success: false, error: eodResult.reason instanceof Error ? eodResult.reason.message : 'Unknown EOD sheet error' },
          cashLog: cashResult.status === 'fulfilled' ? cashResult.value : { success: false, error: cashResult.reason instanceof Error ? cashResult.reason.message : 'Unknown cash log sheet error' },
        },
        { status: 500 }
      )
    }

    return NextResponse.json({ eod: eodResult.value, cashLog: cashResult.value })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync EOD report to Google Sheets' },
      { status: 500 }
    )
  }
}
