'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { PinModal } from '@/components/layout/PinModal'
import { GlobalTimeClock } from '@/components/layout/GlobalTimeClock'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  LayoutDashboard,
  Calendar,
  FileText,
  Trophy,
  MessageSquareQuote,
  ShieldCheck,
  Lock,
  UserRound,
  LogOut,
} from 'lucide-react'

const publicTabs = [
  { label: 'Task Board', href: '/', icon: LayoutDashboard },
  { label: 'Leaderboard', href: '/leaderboard', icon: Trophy },
  { label: 'Review', href: '/review-board', icon: MessageSquareQuote },
  { label: 'Schedule', href: '/schedule', icon: Calendar },
  { label: 'EOD', href: '/eod', icon: FileText },
]

const adminPaths = ['/admin', '/task-admin', '/staffing', '/schedule-planning', '/roles-departments', '/reporting', '/email-settings']

export function TabNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [appUserName, setAppUserName] = useState<string | null>(null)
  const [loginReady, setLoginReady] = useState(false)
  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [adminNeedsSetup, setAdminNeedsSetup] = useState(false)
  const [showPinModal, setShowPinModal] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)
  const [adminAccessError, setAdminAccessError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    void (async () => {
      let sessionRes: Response
      let setupRes: Response
      try {
        ;[sessionRes, setupRes] = await Promise.all([
          fetch('/api/admin-session', { cache: 'no-store' }),
          fetch('/api/admin-bootstrap', { cache: 'no-store' }),
        ])
      } catch (error) {
        if (mounted) {
          setAdminAccessError(error instanceof Error ? `Admin API fetch failed: ${error.message}` : 'Admin API fetch failed')
          setAdminNeedsSetup(false)
          setAdminUnlocked(false)
        }
        return
      }

      if (!mounted) return

      const sessionData = sessionRes.ok
        ? (await sessionRes.json()) as { authenticated?: boolean }
        : {}
      const setupData = (await setupRes.json().catch(() => ({}))) as { needsSetup?: boolean; error?: string }

      if (!sessionRes.ok || !setupRes.ok) {
        setAdminAccessError(setupData.error ?? 'Admin access check failed')
        setAdminNeedsSetup(false)
        setAdminUnlocked(false)
        return
      }

      if (setupData.needsSetup === true) {
        const createRes = await fetch('/api/admin-bootstrap/default', {
          method: 'POST',
        })
        if (createRes.ok && mounted) {
          setAdminNeedsSetup(false)
          return
        }
      }

      if (mounted) {
        setAdminUnlocked(sessionData.authenticated === true)
        setAdminNeedsSetup(setupData.needsSetup === true)
        setAdminAccessError(null)
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true

    void (async () => {
      const res = await fetch('/api/app-session', { cache: 'no-store' })
      const data = res.ok
        ? await res.json() as { authenticated?: boolean; login_ready?: boolean; employee?: { name?: string } }
        : {}

      if (!mounted) return
      setAppUserName(data.authenticated ? data.employee?.name ?? 'Signed In' : null)
      setLoginReady(data.login_ready === true)
    })()

    return () => {
      mounted = false
    }
  }, [pathname])

  const handleLogout = async () => {
    await fetch('/api/app-session', { method: 'DELETE' })
    setAppUserName(null)
    setAdminUnlocked(false)
    router.push('/')
    router.refresh()
  }

  const handleAdminClick = () => {
    if (adminAccessError) {
      setPinError(adminAccessError)
      setShowPinModal(true)
      return
    }
    if (adminNeedsSetup) {
      router.push('/setup-admin')
      return
    }
    setPinError(null)
    setShowPinModal(true)
  }

  const handlePinConfirm = async (pin: string) => {
    let res: Response
    try {
      res = await fetch('/api/admin-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
    } catch (error) {
      const message = error instanceof Error ? `Admin API fetch failed: ${error.message}` : 'Admin API fetch failed'
      setPinError(message)
      throw new Error(message)
    }

    if (res.ok) {
      setAdminUnlocked(true)
      setShowPinModal(false)
      router.push('/admin')
      return
    }

    const data = (await res.json().catch(() => ({}))) as { error?: string }
    setPinError(data.error ?? 'Incorrect manager PIN')
    throw new Error(data.error ?? 'Incorrect manager PIN')
  }

  const isOnAdminPage = adminPaths.some(path => pathname === path || pathname.startsWith(`${path}/`))

  if (pathname === '/login') {
    return null
  }

  return (
    <>
      <nav className="flex flex-col bg-gray-900 shrink-0">

        {/* ── Mobile layout (portrait phone) ── */}

        {/* Row 1: Logo + user controls */}
        <div className="flex md:hidden items-center h-12 px-3 gap-2 border-b border-gray-800">
          <div className="flex items-center gap-2 min-w-0">
            <div className="rounded-lg border border-gray-700 bg-gray-800 p-1 shrink-0">
              <Image
                src="/new%20logo%20V3.jpg"
                alt="FOH Dashboard"
                width={28}
                height={28}
                className="h-6 w-6 rounded object-contain"
                priority
              />
            </div>
            <div className="min-w-0">
              <div className="truncate text-white font-semibold text-[13px] leading-tight">New Village</div>
              <div className="truncate text-amber-400 font-semibold text-[11px] leading-tight">FOH Dashboard</div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1 shrink-0">
            <GlobalTimeClock />
            {appUserName ? (
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-md text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
                      aria-label={`Signed in as ${appUserName}`}
                      title={appUserName}
                    />
                  }
                >
                  <UserRound className="h-4 w-4 text-amber-400" />
                </PopoverTrigger>
                <PopoverContent align="end" className="w-48 bg-white text-slate-950">
                  <div className="border-b pb-2 text-xs font-semibold text-slate-500">{appUserName}</div>
                  <button
                    onClick={handleAdminClick}
                    className={cn(
                      'mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium hover:bg-violet-50',
                      isOnAdminPage ? 'text-violet-700' : 'text-slate-700'
                    )}
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {adminNeedsSetup ? 'Setup Admin' : 'Admin Board'}
                    {adminUnlocked && <Lock className="ml-auto h-3.5 w-3.5 text-emerald-600" />}
                  </button>
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                  >
                    <LogOut className="h-4 w-4" />
                    Logout
                  </button>
                </PopoverContent>
              </Popover>
            ) : loginReady ? (
              <Link
                href="/login"
                className="flex h-9 w-9 items-center justify-center rounded-md text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
                aria-label="Login"
                title="Login"
              >
                <UserRound className="h-4 w-4" />
              </Link>
            ) : null}
          </div>
        </div>

        {/* Row 2: Horizontally scrollable tabs */}
        <div
          className="flex md:hidden items-center gap-1 overflow-x-auto px-2 py-1.5"
          style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
        >
          {publicTabs.map(({ label, href, icon: Icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap shrink-0',
                  active ? 'bg-amber-500 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            )
          })}

        </div>

        {/* ── Desktop / landscape tablet layout (single row) ── */}
        <div className="hidden md:flex items-center min-h-16 px-3 gap-2">
          <div className="flex items-center mr-4 px-1 min-w-0">
            <div className="mr-3 rounded-xl border border-gray-700 bg-gray-800 p-1.5 shadow-sm">
              <Image
                src="/new%20logo%20V3.jpg"
                alt="New Village FOH Dashboard logo"
                width={40}
                height={40}
                className="h-8 w-8 rounded-md object-contain"
                priority
              />
            </div>
            <div className="min-w-0">
              <div className="truncate text-white font-semibold text-[15px] leading-tight tracking-tight">
                New Village
              </div>
              <div className="truncate text-amber-400 font-semibold text-sm leading-tight">
                FOH Dashboard
              </div>
            </div>
          </div>

          {publicTabs.map(({ label, href, icon: Icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
                  active ? 'bg-amber-500 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            )
          })}

          <div className="ml-auto flex items-center gap-2">
            <GlobalTimeClock />
            {appUserName ? (
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-700 bg-gray-800 text-gray-200 transition-colors hover:bg-gray-700 hover:text-white"
                      aria-label={`Signed in as ${appUserName}`}
                      title={appUserName}
                    />
                  }
                >
                  <UserRound className="h-4 w-4 text-amber-400" />
                </PopoverTrigger>
                <PopoverContent align="end" className="w-52 bg-white text-slate-950">
                  <div className="border-b pb-2 text-sm font-semibold text-slate-700">{appUserName}</div>
                  <button
                    onClick={handleAdminClick}
                    className={cn(
                      'mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium hover:bg-violet-50',
                      isOnAdminPage ? 'text-violet-700' : 'text-slate-700'
                    )}
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {adminNeedsSetup ? 'Setup Admin' : 'Admin Board'}
                    {adminUnlocked && <Lock className="ml-auto h-3.5 w-3.5 text-emerald-600" />}
                  </button>
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                  >
                    <LogOut className="h-4 w-4" />
                    Logout
                  </button>
                </PopoverContent>
              </Popover>
            ) : loginReady ? (
              <Link
                href="/login"
                className="flex h-9 w-9 items-center justify-center rounded-md text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
                aria-label="Login"
                title="Login"
              >
                <UserRound className="h-4 w-4" />
              </Link>
            ) : (
              <div className="hidden rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-gray-400 md:block">
                Enable app login in Staffing
              </div>
            )}
          </div>
        </div>
      </nav>

      <PinModal
        open={showPinModal}
        title="Admin Board"
        description={adminAccessError ? 'Admin access could not be checked.' : 'Enter admin PIN to unlock'}
        onConfirm={handlePinConfirm}
        onClose={() => { setShowPinModal(false); setPinError(null) }}
        error={pinError}
      />
    </>
  )
}
