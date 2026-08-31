import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isValidAdminSession, ADMIN_SESSION_COOKIE } from '@/lib/adminSession'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const hasAdminSession = isValidAdminSession(request.cookies.get(ADMIN_SESSION_COOKIE)?.value)

  if (pathname === '/login') {
    return NextResponse.redirect(new URL(hasAdminSession ? '/admin' : '/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/',
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
