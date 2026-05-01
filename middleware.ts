import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'

// Inlined to avoid pulling appAuth.ts (which imports Node.js crypto) into Edge Runtime
const APP_SESSION_COOKIE = 'foh_app_session'

const ADMIN_PATHS = ['/admin', '/task-admin', '/staffing', '/schedule-planning', '/roles-departments', '/reporting', '/email-settings']

// Edge Runtime cannot use Node.js crypto — decode payload and check expiry only.
// HMAC integrity is enforced by every API route via parseAppSessionValue.
function hasValidAppSession(request: NextRequest): boolean {
  const value = request.cookies.get(APP_SESSION_COOKIE)?.value
  if (!value) return false
  try {
    const [body] = value.split('.')
    if (!body) return false
    const base64 = body.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    const payload = JSON.parse(json) as { expiresAt?: number }
    return typeof payload.expiresAt === 'number' && payload.expiresAt > Date.now()
  } catch {
    return false
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const needsAdmin = ADMIN_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  )

  if (needsAdmin) {
    const sessionValue = request.cookies.get(ADMIN_SESSION_COOKIE)?.value
    if (isValidAdminSession(sessionValue)) return NextResponse.next()
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  if (hasValidAppSession(request)) return NextResponse.next()

  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('next', pathname)
  return NextResponse.redirect(url)
}

export const config = {
  // All routes except: API routes, Next.js internals, static assets, and the login page itself
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|login).*)'],
}
