'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loginReady, setLoginReady] = useState(true)

  useEffect(() => {
    let mounted = true
    const nextPath = searchParams.get('next')

    void (async () => {
      const res = await fetch('/api/app-session', { cache: 'no-store' })
      const data = res.ok
        ? await res.json() as { authenticated?: boolean; can_manage_admin?: boolean; login_ready?: boolean }
        : {}

      if (!mounted) return
      setLoginReady(data.login_ready !== false)
      if (!data.authenticated) return
      router.replace(nextPath || (data.can_manage_admin ? '/admin' : '/schedule'))
    })()

    return () => {
      mounted = false
    }
  }, [router, searchParams])

  const handleSubmit = async () => {
    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/app-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; can_manage_admin?: boolean }
      if (!res.ok) {
        setError(data.error ?? 'Unable to sign in')
        return
      }

      const nextPath = searchParams.get('next')
      router.push(nextPath || (data.can_manage_admin ? '/admin' : '/schedule'))
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6 bg-slate-100">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white px-6 py-7 shadow-sm">
        <div className="mb-6">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">FOH Login</h1>
          <p className="mt-1 text-sm text-slate-500">
            Sign in with the app login managed in Staffing. PIN stays available for task actions inside service.
          </p>
        </div>

        <div className="mb-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 text-violet-600" />
            <div>
              <p className="font-medium text-slate-800">Existing manager PIN access still works.</p>
              <p className="mt-1">
                Managers can go back to the dashboard and open <span className="font-medium">Admin Board</span> with the
                usual PIN. Use this page only after an app login has been enabled in Staffing.
              </p>
            </div>
          </div>
        </div>

        {loginReady ? (
          <div className="space-y-4">
            <div>
              <Label>Email</Label>
              <div className="relative mt-1">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="manager@newvillagepub.com"
                  className="pl-9"
                />
              </div>
            </div>
            <div>
              <Label>Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                className="mt-1"
              />
            </div>
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </div>
            )}
            <Button
              className="w-full"
              disabled={saving || !email.trim() || !password.trim()}
              onClick={handleSubmit}
            >
              {saving ? 'Signing In…' : 'Sign In'}
            </Button>
            <Link
              href="/"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Back To Dashboard
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Create the first app login in <span className="font-medium">Staffing</span> before using this page.
            </div>
            <Link
              href="/"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Back To Dashboard
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
