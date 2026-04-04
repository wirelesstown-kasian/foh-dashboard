import { NextRequest, NextResponse } from 'next/server'
import { verifyPin } from '@/lib/pin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isValidPin } from '@/lib/validation'

export async function POST(req: NextRequest) {
  const { pin, task_id, session_date } = await req.json()

  if (!isValidPin(pin)) {
    return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 })
  }
  if (typeof task_id !== 'string' || typeof session_date !== 'string') {
    return NextResponse.json({ error: 'Missing task completion payload' }, { status: 400 })
  }

  const { data: employees, error: employeeError } = await supabaseAdmin
    .from('employees')
    .select('id, pin_hash')
    .eq('is_active', true)

  if (employeeError) {
    return NextResponse.json({ error: employeeError.message }, { status: 500 })
  }

  let employeeId: string | null = null
  for (const employee of employees ?? []) {
    if (await verifyPin(pin, employee.pin_hash)) {
      employeeId = employee.id
      break
    }
  }

  if (!employeeId) {
    return NextResponse.json({ error: 'Incorrect PIN' }, { status: 401 })
  }

  const { error } = await supabaseAdmin.from('task_completions').insert({
    task_id,
    employee_id: employeeId,
    session_date,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
