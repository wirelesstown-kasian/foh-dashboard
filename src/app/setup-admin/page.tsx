'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function SetupAdminPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [form, setForm] = useState({ name: '', email: '', pin: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    void (async () => {
      const res = await fetch('/api/admin-bootstrap', { cache: 'no-store' })
      if (!res.ok) {
        if (mounted) {
          setChecking(false)
          setError('초기 관리자 상태를 확인하지 못했습니다.')
        }
        return
      }

      const data = (await res.json()) as { needsSetup?: boolean }
      if (!mounted) return

      if (!data.needsSetup) {
        router.replace('/')
        return
      }

      setChecking(false)
    })()

    return () => {
      mounted = false
    }
  }, [router])

  const handleSubmit = async () => {
    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/admin-bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(data.error ?? '첫 관리자 생성에 실패했습니다.')
        return
      }

      router.push('/admin')
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  if (checking) {
    return <div className="p-6 text-muted-foreground">Checking admin setup…</div>
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-md bg-white border rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Create First Admin</h1>
            <p className="text-sm text-muted-foreground">관리자 계정이 아직 없어서 첫 매니저를 등록해야 합니다.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label>Manager Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Manager name"
            />
          </div>
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="manager@example.com"
            />
          </div>
          <div>
            <Label>PIN</Label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={form.pin}
              onChange={(e) => setForm((prev) => ({ ...prev, pin: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
              placeholder="4-digit PIN"
              className="tracking-widest text-center font-mono"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}
          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={saving || !form.name.trim() || !/^\d{4}$/.test(form.pin)}
          >
            {saving ? 'Creating…' : 'Create Admin'}
          </Button>
        </div>
      </div>
    </div>
  )
}
