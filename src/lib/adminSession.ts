import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { getSessionSecret } from '@/lib/appAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const ADMIN_SESSION_COOKIE = 'foh_admin_session'
const ADMIN_SESSION_DURATION_MS = 8 * 60 * 60 * 1000

type ManagerSession = {
  employeeId: string
  expiresAt: number
  nonce: string
}

function sign(body: string) {
  return createHmac('sha256', getSessionSecret()).update(`admin:${body}`).digest('base64url')
}

export function createAdminSessionValue(employeeId: string) {
  const body = Buffer.from(JSON.stringify({
    employeeId,
    expiresAt: Date.now() + ADMIN_SESSION_DURATION_MS,
    nonce: randomBytes(16).toString('base64url'),
  } satisfies ManagerSession)).toString('base64url')
  return `${body}.${sign(body)}`
}

export function getAdminSessionEmployeeId(value: string | undefined | null): string | null {
  if (!value) return null
  const parts = value.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const [body, signature] = parts
  const expected = sign(body)
  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
    const session = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ManagerSession
    if (!session.employeeId || !session.nonce || !Number.isFinite(session.expiresAt)) return null
    if (session.expiresAt <= Date.now() || session.expiresAt > Date.now() + ADMIN_SESSION_DURATION_MS) return null
    return session.employeeId
  } catch {
    return null
  }
}

// Proxy uses this only for navigation. API handlers also check the current role.
export function isValidAdminSession(value: string | undefined | null) {
  return getAdminSessionEmployeeId(value) !== null
}

export async function hasManagerAccess(value: string | undefined | null) {
  const employeeId = getAdminSessionEmployeeId(value)
  if (!employeeId) return false
  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('id', employeeId)
    .eq('role', 'manager')
    .eq('is_active', true)
    .maybeSingle()
  return !error && !!data
}
