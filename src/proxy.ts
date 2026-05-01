import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { parseAppSessionValue, APP_SESSION_COOKIE } from '@/lib/appAuth'
import { isValidAdminSession, ADMIN_SESSION_COOKIE } from '@/lib/adminSession'

function getHomePathForRole(role: string) {
  return role === 'manager' ? '/admin' : '/schedule'
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const session = parseAppSessionValue(request.cookies.get(APP_SESSION_COOKIE)?.value)
  const hasAdminSession = isValidAdminSession(request.cookies.get(ADMIN_SESSION_COOKIE)?.value)

  if (pathname === '/login') {
    if (!session && !hasAdminSession) return NextResponse.next()
    return NextResponse.redirect(new URL(session ? getHomePathForRole(session.role) : '/admin', request.url))
  }

  if (session || hasAdminSession) {
    return NextResponse.next()
  }

  const loginUrl = new URL('/login', request.url)
  if (pathname !== '/') {
    loginUrl.searchParams.set('next', pathname)
  }
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: [
    '/',
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
