'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { PinModal } from '@/components/layout/PinModal'
import {
  LayoutDashboard,
  Calendar,
  FileText,
  ShieldCheck,
  Lock,
  UserRound,
  LogOut,
} from 'lucide-react'

const publicTabs = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Schedule', href: '/schedule', icon: Calendar },
  { label: 'EOD', href: '/eod', icon: FileText },
]

const adminPaths = ['/admin', '/task-admin', '/staffing', '/schedule-planning', '/roles-departments', '/reporting', '/email-settings']

export function TabNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [appUserName, setAppUserName] = useState<string | null>(null)
  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [adminNeedsSetup, setAdminNeedsSetup] = useState(false)
  const [adminAvailable, setAdminAvailable] = useState(false)
  const [showPinModal, setShowPinModal] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    void (async () => {
      const [sessionRes, setupRes] = await Promise.all([
        fetch('/api/admin-session', { cache: 'no-store' }),
        fetch('/api/admin-bootstrap', { cache: 'no-store' }),
      ])

      if (!mounted) return

      const sessionData = sessionRes.ok
        ? (await sessionRes.json()) as { authenticated?: boolean }
        : {}
      const setupData = setupRes.ok
        ? (await setupRes.json()) as { needsSetup?: boolean }
        : {}

      if (setupData.needsSetup === true) {
        const createRes = await fetch('/api/admin-bootstrap/default', {
          method: 'POST',
        })
        if (createRes.ok && mounted) {
          setAdminAvailable(true)
          setAdminNeedsSetup(false)
          return
        }
      }

      if (mounted) {
        setAdminUnlocked(sessionData.authenticated === true)
        setAdminNeedsSetup(setupData.needsSetup === true)
        setAdminAvailable(setupData.needsSetup !== true)
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
        ? await res.json() as { authenticated?: boolean; employee?: { name?: string } }
        : {}

      if (!mounted) return
      setAppUserName(data.authenticated ? data.employee?.name ?? 'Signed In' : null)
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
    if (adminNeedsSetup) {
      router.push('/setup-admin')
      return
    }
    setPinError(null)
    setShowPinModal(true)
  }

  const handlePinConfirm = async (pin: string) => {
    const res = await fetch('/api/admin-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    })

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
        {/* Main row */}
        <div className="flex items-center min-h-16 px-3 gap-2">
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

          <div className="w-px h-6 bg-gray-700 mx-1" />

          <button
            onClick={handleAdminClick}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
              isOnAdminPage && adminUnlocked
                ? 'bg-violet-600 text-white'
                : adminUnlocked || adminAvailable
                  ? 'text-violet-300 hover:bg-gray-700 hover:text-white'
                  : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
            )}
          >
            <ShieldCheck className="w-4 h-4" />
            {adminNeedsSetup ? 'Setup Admin' : 'Admin Board'}
            {adminUnlocked
              ? <Lock className="w-3 h-3 ml-1 text-green-400" />
              : <Lock className="w-3 h-3 ml-1" />
            }
          </button>

          <div className="ml-auto flex items-center gap-2">
            {appUserName ? (
              <>
                <div className="hidden rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 md:flex md:items-center md:gap-2">
                  <UserRound className="h-4 w-4 text-amber-400" />
                  {appUserName}
                </div>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
              >
                <UserRound className="h-4 w-4" />
                Login
              </Link>
            )}
          </div>
        </div>
      </nav>

      <PinModal
        open={showPinModal}
        title="Admin Board"
        description="Enter admin PIN to unlock"
        onConfirm={handlePinConfirm}
        onClose={() => { setShowPinModal(false); setPinError(null) }}
        error={pinError}
      />
    </>
  )
}
