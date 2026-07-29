import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { verifyPin } from '@/lib/pin'
import { getReviewBoardViewer, requireViewerSession } from '@/lib/reviewBoard'
import { isValidPin } from '@/lib/validation'

export async function POST(req: NextRequest) {
  const { session } = await getReviewBoardViewer()
  if (!requireViewerSession(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { pin } = await req.json() as { pin?: string }
  if (!isValidPin(pin)) {
    return NextResponse.json({ error: 'PIN must be 4 digits' }, { status: 400 })
  }

  const { data: employees, error } = await supabaseAdmin
    .from('employees')
    .select('id, name, role, primary_department, pin_hash, is_active')
    .eq('is_active', true)
    .order('name')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  for (const employee of employees ?? []) {
    if (employee.pin_hash && await verifyPin(pin, employee.pin_hash)) {
      return NextResponse.json({
        success: true,
        employee: {
          id: employee.id,
          name: employee.name,
          role: employee.role,
          primary_department: employee.primary_department,
        },
      })
    }
  }

  return NextResponse.json({ error: 'PIN not recognized' }, { status: 401 })
}
