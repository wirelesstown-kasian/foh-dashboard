import { NextRequest, NextResponse } from 'next/server'
import { verifyPin } from '@/lib/pin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function POST(req: NextRequest) {
  const { pin } = await req.json()

  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 })
  }

  const { data: managers, error } = await supabaseAdmin
    .from('employees')
    .select('id, pin_hash')
    .eq('role', 'manager')
    .eq('is_active', true)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  for (const manager of managers ?? []) {
    if (await verifyPin(pin, manager.pin_hash)) {
      return NextResponse.json({ success: true, managerId: manager.id })
    }
  }

  return NextResponse.json({ error: 'Manager PIN required' }, { status: 401 })
}
