import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { syncCashBalanceEntryToGoogleSheet } from '@/lib/eodGoogleSheet'

export async function POST(req: NextRequest) {
  try {
    const { entry_id } = await req.json() as { entry_id?: string }
    if (!entry_id) return NextResponse.json({ error: 'Missing entry_id' }, { status: 400 })

    const { data: entry, error } = await supabaseAdmin
      .from('cash_balance_entries')
      .select('*')
      .eq('id', entry_id)
      .single()

    if (error || !entry) {
      return NextResponse.json({ error: error?.message ?? 'Cash balance entry not found' }, { status: 404 })
    }

    const result = await syncCashBalanceEntryToGoogleSheet(entry)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync cash balance entry to Google Sheets' },
      { status: 500 }
    )
  }
}
