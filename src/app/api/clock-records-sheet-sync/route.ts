import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { removeClockRecordFromGoogleSheet, resetClockRecordsSheetInGoogleSheet, syncClockRecordToGoogleSheet } from '@/lib/eodGoogleSheet'

export async function POST(req: NextRequest) {
  try {
    const { record_id, deleted_record_id, reset_sheet } = await req.json() as {
      record_id?: string
      deleted_record_id?: string
      reset_sheet?: boolean
    }

    if (reset_sheet) {
      const { data, error } = await supabaseAdmin
        .from('shift_clocks')
        .select('*, employee:employees(name, role)')
        .order('session_date', { ascending: false })
        .order('clock_in_at', { ascending: false })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const result = await resetClockRecordsSheetInGoogleSheet(data ?? [])
      return NextResponse.json(result)
    }

    if (deleted_record_id) {
      const result = await removeClockRecordFromGoogleSheet(deleted_record_id)
      return NextResponse.json(result)
    }

    if (!record_id) {
      return NextResponse.json({ error: 'Missing record_id' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('shift_clocks')
      .select('*, employee:employees(name, role)')
      .eq('id', record_id)
      .single()

    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Clock record not found' }, { status: 404 })
    }

    const result = await syncClockRecordToGoogleSheet(data)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync clock record to Google Sheets' },
      { status: 500 }
    )
  }
}

