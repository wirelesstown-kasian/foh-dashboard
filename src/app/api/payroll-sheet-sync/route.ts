import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { syncPayrollRunToGoogleSheet } from '@/lib/eodGoogleSheet'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import type { PayrollRun, PayrollRunItem } from '@/lib/types'

type PayrollSheetRun = PayrollRun & { payroll_run_items?: PayrollRunItem[] }

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  if (!isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { run_id } = await req.json() as { run_id?: string }
    if (!run_id) return NextResponse.json({ error: 'Missing run_id' }, { status: 400 })

    const { data: run, error } = await supabaseAdmin
      .from('payroll_runs')
      .select('*, payroll_run_items(*)')
      .eq('id', run_id)
      .single()

    if (error || !run) {
      return NextResponse.json({ error: error?.message ?? 'Payroll run not found' }, { status: 404 })
    }

    const result = await syncPayrollRunToGoogleSheet(run as PayrollSheetRun)
    return NextResponse.json({ payroll: result })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync payroll run to Google Sheets' },
      { status: 500 }
    )
  }
}
