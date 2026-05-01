import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { APP_SESSION_COOKIE, parseAppSessionValue } from '@/lib/appAuth'

const ADMIN_PATHS = ['/admin', '/task-admin', '/staffing', '/schedule-planning', '/roles-departments', '/reporting', '/email-settings']

export function proxy(request: NextRequest) {
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

  const appSession = parseAppSessionValue(request.cookies.get(APP_SESSION_COOKIE)?.value)
  if (appSession) return NextResponse.next()

  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('next', pathname)
  return NextResponse.redirect(url)
}

export const proxyConfig = {
  // All routes except: API routes, Next.js internals, static assets, and the login page itself
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|login).*)'],
}
