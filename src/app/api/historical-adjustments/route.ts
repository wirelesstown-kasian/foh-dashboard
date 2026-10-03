import { createHmac, timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { APP_SESSION_COOKIE } from '@/lib/appAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

// The deployed app still accepts unsigned-looking manager cookies for other
// routes. This financial import requires a session signed with a private key.
function verifiedManagerSessionEmployeeId(value: string | undefined) {
  const secret = process.env.APP_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret || !value) return null
  const [body, signature, extra] = value.split('.')
  if (!body || !signature || extra) return null
  const expected = createHmac('sha256', secret).update(body).digest('base64url')
  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      employeeId?: unknown; expiresAt?: unknown
    }
    if (typeof payload.employeeId !== 'string' || typeof payload.expiresAt !== 'number'
      || payload.expiresAt <= Date.now()) return null
    return payload.employeeId
  } catch {
    return null
  }
}

export async function GET() {
  const cookieStore = await cookies()
  const employeeId = verifiedManagerSessionEmployeeId(cookieStore.get(APP_SESSION_COOKIE)?.value)
  if (!employeeId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data: manager, error: managerError } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('id', employeeId)
    .eq('role', 'manager')
    .eq('is_active', true)
    .eq('login_enabled', true)
    .maybeSingle()
  if (managerError || !manager) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: value, error } = await supabaseAdmin.rpc('get_foh_historical_adjustments')
  if (error) return NextResponse.json({ error: 'Failed to load historical data' }, { status: 500 })

  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.version !== 1 || !Array.isArray(value.sales) || !Array.isArray(value.payroll)) {
    return NextResponse.json({ data: null }, { headers: { 'cache-control': 'no-store' } })
  }
  return NextResponse.json({ data: value }, { headers: { 'cache-control': 'no-store' } })
}
