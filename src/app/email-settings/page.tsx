'use client'

import { useEffect, useState } from 'react'
import { MailCheck } from 'lucide-react'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import type { EmailSettings } from '@/lib/appSettings'

const EMPTY_SETTINGS: EmailSettings = {
  from_name: '',
  from_email: '',
  reply_to: '',
  eod_report_email: '',
  eod_tip_emails_enabled: true,
  eod_admin_summary_enabled: true,
  schedule_emails_enabled: true,
  wage_report_emails_enabled: true,
}

function BooleanSelect({
  value,
  onChange,
}: {
  value: boolean
  onChange: (nextValue: boolean) => void
}) {
  return (
    <Select value={value ? 'enabled' : 'disabled'} onValueChange={(nextValue: string | null) => onChange(nextValue === 'enabled')}>
      <SelectTrigger>
        <span>{value ? 'Enabled' : 'Disabled'}</span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="enabled">Enabled</SelectItem>
        <SelectItem value="disabled">Disabled</SelectItem>
      </SelectContent>
    </Select>
  )
}

export default function EmailSettingsPage() {
  const [settings, setSettings] = useState<EmailSettings>(EMPTY_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    void (async () => {
      const res = await fetch('/api/app-settings', { cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as { settings?: EmailSettings; error?: string }
      if (!mounted) return
      if (!res.ok || !data.settings) {
        setError(data.error ?? 'Failed to load email settings')
        setLoading(false)
        return
      }
      setSettings(data.settings)
      setLoading(false)
    })()

    return () => {
      mounted = false
    }
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(null)

    try {
      const res = await fetch('/api/app-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const data = (await res.json().catch(() => ({}))) as { settings?: EmailSettings; error?: string }
      if (!res.ok || !data.settings) {
        setError(data.error ?? 'Failed to save email settings')
        return
      }
      setSettings(data.settings)
      setSaved('Email settings saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6">
      <AdminSubpageHeader
        title="Email Settings"
        subtitle="Control sender details, report recipients, and which email triggers are enabled."
      />

      {loading ? (
        <p className="text-muted-foreground">Loading email settings…</p>
      ) : (
        <div className="space-y-6">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                <MailCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Sender</h2>
                <p className="text-sm text-muted-foreground">These values are used across EOD, schedule, and wage emails.</p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>From Name</Label>
                <Input value={settings.from_name} onChange={(event) => setSettings((prev) => ({ ...prev, from_name: event.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>From Email</Label>
                <Input value={settings.from_email} onChange={(event) => setSettings((prev) => ({ ...prev, from_email: event.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Reply-To Email</Label>
                <Input value={settings.reply_to} onChange={(event) => setSettings((prev) => ({ ...prev, reply_to: event.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>EOD Summary Recipient</Label>
                <Input value={settings.eod_report_email} onChange={(event) => setSettings((prev) => ({ ...prev, eod_report_email: event.target.value }))} className="mt-1" />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Triggers</h2>
            <p className="mt-1 text-sm text-muted-foreground">Disable a trigger here without changing code or environment variables.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <Label>EOD Tip Emails</Label>
                <div className="mt-1">
                  <BooleanSelect value={settings.eod_tip_emails_enabled} onChange={(nextValue) => setSettings((prev) => ({ ...prev, eod_tip_emails_enabled: nextValue }))} />
                </div>
              </div>
              <div>
                <Label>EOD Admin Summary</Label>
                <div className="mt-1">
                  <BooleanSelect value={settings.eod_admin_summary_enabled} onChange={(nextValue) => setSettings((prev) => ({ ...prev, eod_admin_summary_enabled: nextValue }))} />
                </div>
              </div>
              <div>
                <Label>Schedule Emails</Label>
                <div className="mt-1">
                  <BooleanSelect value={settings.schedule_emails_enabled} onChange={(nextValue) => setSettings((prev) => ({ ...prev, schedule_emails_enabled: nextValue }))} />
                </div>
              </div>
              <div>
                <Label>Wage Report Emails</Label>
                <div className="mt-1">
                  <BooleanSelect value={settings.wage_report_emails_enabled} onChange={(nextValue) => setSettings((prev) => ({ ...prev, wage_report_emails_enabled: nextValue }))} />
                </div>
              </div>
            </div>
          </div>

          {(error || saved) && (
            <div className={`rounded-xl border px-3 py-2 text-sm ${error ? 'border-red-200 bg-red-50 text-red-600' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
              {error ?? saved}
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Email Settings'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
