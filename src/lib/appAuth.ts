import { createHmac, timingSafeEqual } from 'crypto'

export const APP_SESSION_COOKIE = 'foh_app_session'
const APP_SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30

export interface AppSessionPayload {
  employeeId: string
  role: string
  name: string
  email: string | null
  expiresAt: number
}

function getSessionSecret() {
  return process.env.APP_SESSION_SECRET
    ?? process.env.SUPABASE_SERVICE_ROLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ?? 'foh-dashboard-dev-secret'
}

function sign(value: string) {
  return createHmac('sha256', getSessionSecret()).update(value).digest('base64url')
}

function encode(payload: AppSessionPayload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function decode(value: string) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as AppSessionPayload
}

export function createAppSessionValue(payload: Omit<AppSessionPayload, 'expiresAt'>) {
  const sessionPayload: AppSessionPayload = {
    ...payload,
    expiresAt: Date.now() + APP_SESSION_DURATION_SECONDS * 1000,
  }
  const body = encode(sessionPayload)
  return `${body}.${sign(body)}`
}

export function parseAppSessionValue(value: string | undefined | null) {
  if (!value) return null
  const [body, signature] = value.split('.')
  if (!body || !signature) return null

  const expected = sign(body)
  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return null
    }
  } catch {
    return null
  }

  try {
    const payload = decode(body)
    if (!payload.employeeId || !payload.role || !payload.name || typeof payload.expiresAt !== 'number') {
      return null
    }
    if (payload.expiresAt <= Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export function getAppSessionMaxAge() {
  return APP_SESSION_DURATION_SECONDS
}
