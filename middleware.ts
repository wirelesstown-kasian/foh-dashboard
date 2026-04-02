import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'

const ADMIN_PATHS = ['/admin', '/task-admin', '/staffing', '/schedule-planning', '/reporting']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const needsAdmin = ADMIN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))

  if (!needsAdmin) {
    return NextResponse.next()
  }

  const sessionValue = request.cookies.get(ADMIN_SESSION_COOKIE)?.value
  if (isValidAdminSession(sessionValue)) {
    return NextResponse.next()
  }

  const url = request.nextUrl.clone()
  url.pathname = '/'
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/admin/:path*', '/task-admin/:path*', '/staffing/:path*', '/schedule-planning/:path*', '/reporting/:path*'],
}
