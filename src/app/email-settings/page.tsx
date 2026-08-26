'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { CalendarClock, MailCheck, Send, Users } from 'lucide-react'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import type { EmailSettings } from '@/lib/appSettings'

type SettingsForm = EmailSettings & {
  time_clock_announcement: string
}

const EMPTY_SETTINGS: SettingsForm = {
  from_name: '',
  from_email: '',
  reply_to: '',
  eod_report_email: '',
  eod_tip_emails_enabled: true,
  eod_admin_summary_enabled: true,
  schedule_emails_enabled: true,
  queued_schedule_emails_enabled: true,
  schedule_default_send_day: 'sunday',
  schedule_default_send_time: '21:00',
  weekly_summary_emails_enabled: true,
  weekly_summary_recipient: '',
  weekly_summary_send_day: 'monday',
  weekly_summary_send_time: '09:00',
  wage_report_emails_enabled: true,
  payroll_summary_emails_enabled: true,
  payroll_summary_email: '',
  payroll_summary_send_timing: 'after_save',
  announcement_event_emails_enabled: true,
  announcement_event_email: '',
  eod_send_timing: 'manual',
  time_clock_announcement: '',
}

const WEEKDAY_OPTIONS = [
  { value: 'sunday', label: 'Sunday' },
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
]

const EOD_SEND_TIMING_OPTIONS = [
  { value: 'manual', label: 'Manual button' },
  { value: 'after_save', label: 'After EOD save' },
]

const PAYROLL_SEND_TIMING_OPTIONS = [
  { value: 'after_save', label: 'After worksheet save' },
  { value: 'manual', label: 'Manual only' },
]

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

function FieldNote({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-xs text-muted-foreground">{children}</p>
}

function SettingsSection({
  title,
  description,
  icon,
  children,
}: {
  title: string
  description: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
          {icon}
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

export default function EmailSettingsPage() {
  const [settings, setSettings] = useState<SettingsForm>(EMPTY_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    void (async () => {
      const res = await fetch('/api/app-settings', { cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as { settings?: Partial<SettingsForm>; error?: string }
      if (!mounted) return
      if (!res.ok || !data.settings) {
        setError(data.error ?? 'Failed to load email settings')
        setLoading(false)
        return
      }
      setSettings({ ...EMPTY_SETTINGS, ...data.settings })
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
      const data = (await res.json().catch(() => ({}))) as { settings?: Partial<SettingsForm>; error?: string }
      if (!res.ok || !data.settings) {
        setError(data.error ?? 'Failed to save email settings')
        return
      }
      setSettings({ ...EMPTY_SETTINGS, ...data.settings })
      window.dispatchEvent(new Event('app-settings-updated'))
      setSaved('Settings saved')
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
        <div className="space-y-4">
          <SettingsSection title="Sender" description="Default identity for every system email." icon={<MailCheck className="h-5 w-5" />}>
            <div className="grid gap-4 md:grid-cols-3">
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
            </div>
          </SettingsSection>

          <SettingsSection title="EOD Emails" description="Admin EOD summary and employee tip email controls." icon={<Send className="h-5 w-5" />}>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <Label>Admin Summary</Label>
                <div className="mt-1">
                  <BooleanSelect value={settings.eod_admin_summary_enabled} onChange={(nextValue) => setSettings((prev) => ({ ...prev, eod_admin_summary_enabled: nextValue }))} />
                </div>
              </div>
              <div>
                <Label>Tip Emails</Label>
                <div className="mt-1">
                  <BooleanSelect value={settings.eod_tip_emails_enabled} onChange={(nextValue) => setSettings((prev) => ({ ...prev, eod_tip_emails_enabled: nextValue }))} />
                </div>
              </div>
              <div>
                <Label>Send Timing</Label>
                <div className="mt-1">
                  <Select value={settings.eod_send_timing} onValueChange={(nextValue: string | null) => setSettings((prev) => ({ ...prev, eod_send_timing: nextValue ?? prev.eod_send_timing }))}>
                    <SelectTrigger><span>{EOD_SEND_TIMING_OPTIONS.find((option) => option.value === settings.eod_send_timing)?.label ?? 'Manual button'}</span></SelectTrigger>
                    <SelectContent>{EOD_SEND_TIMING_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <FieldNote>Manual keeps the current review-before-send flow.</FieldNote>
              </div>
              <div>
                <Label>EOD Summary Recipient</Label>
                <Input value={settings.eod_report_email} onChange={(event) => setSettings((prev) => ({ ...prev, eod_report_email: event.target.value }))} className="mt-1" />
              </div>
            </div>
          </SettingsSection>

          <SettingsSection title="Payroll Emails" description="Worksheet summary and wage report delivery." icon={<Users className="h-5 w-5" />}>
            <div className="grid gap-4 md:grid-cols-5">
              <div>
                <Label>Payroll Summary</Label>
                <div className="mt-1">
                  <BooleanSelect value={settings.payroll_summary_emails_enabled} onChange={(nextValue) => setSettings((prev) => ({ ...prev, payroll_summary_emails_enabled: nextValue }))} />
                </div>
              </div>
              <div>
                <Label>Wage Reports</Label>
                <div className="mt-1">
                  <BooleanSelect value={settings.wage_report_emails_enabled} onChange={(nextValue) => setSettings((prev) => ({ ...prev, wage_report_emails_enabled: nextValue }))} />
                </div>
              </div>
              <div>
                <Label>Send Timing</Label>
                <div className="mt-1">
                  <Select value={settings.payroll_summary_send_timing} onValueChange={(nextValue: string | null) => setSettings((prev) => ({ ...prev, payroll_summary_send_timing: nextValue ?? prev.payroll_summary_send_timing }))}>
                    <SelectTrigger><span>{PAYROLL_SEND_TIMING_OPTIONS.find((option) => option.value === settings.payroll_summary_send_timing)?.label ?? 'After worksheet save'}</span></SelectTrigger>
                    <SelectContent>{PAYROLL_SEND_TIMING_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="md:col-span-2">
                <Label>Payroll Summary Recipient</Label>
                <Input value={settings.payroll_summary_email} onChange={(event) => setSettings((prev) => ({ ...prev, payroll_summary_email: event.target.value }))} className="mt-1" />
                <FieldNote>Used when payroll worksheet summary is emailed.</FieldNote>
              </div>
            </div>
          </SettingsSection>

          <SettingsSection title="Schedule Emails" description="Immediate schedule sends and queued schedule defaults." icon={<CalendarClock className="h-5 w-5" />}>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <Label>Manual Send</Label>
                <div className="mt-1">
                  <BooleanSelect value={settings.schedule_emails_enabled} onChange={(nextValue) => setSettings((prev) => ({ ...prev, schedule_emails_enabled: nextValue }))} />
                </div>
              </div>
              <div>
                <Label>Queued Send</Label>
                <div className="mt-1">
                  <BooleanSelect value={settings.queued_schedule_emails_enabled} onChange={(nextValue) => setSettings((prev) => ({ ...prev, queued_schedule_emails_enabled: nextValue }))} />
                </div>
              </div>
              <div>
                <Label>Default Queue Day</Label>
                <div className="mt-1">
                  <Select value={settings.schedule_default_send_day} onValueChange={(nextValue: string | null) => setSettings((prev) => ({ ...prev, schedule_default_send_day: nextValue ?? prev.schedule_default_send_day }))}>
                    <SelectTrigger><span>{WEEKDAY_OPTIONS.find((option) => option.value === settings.schedule_default_send_day)?.label ?? 'Select day'}</span></SelectTrigger>
                    <SelectContent>{WEEKDAY_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Default Queue Time</Label>
                <Input type="time" value={settings.schedule_default_send_time} onChange={(event) => setSettings((prev) => ({ ...prev, schedule_default_send_time: event.target.value }))} className="mt-1" />
              </div>
            </div>
          </SettingsSection>

          <SettingsSection title="Weekly Summary" description="Weekly management summary settings." icon={<CalendarClock className="h-5 w-5" />}>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <Label>Weekly Email</Label>
                <div className="mt-1">
                  <BooleanSelect value={settings.weekly_summary_emails_enabled} onChange={(nextValue) => setSettings((prev) => ({ ...prev, weekly_summary_emails_enabled: nextValue }))} />
                </div>
              </div>
              <div>
                <Label>Send Day</Label>
                <div className="mt-1">
                  <Select value={settings.weekly_summary_send_day} onValueChange={(nextValue: string | null) => setSettings((prev) => ({ ...prev, weekly_summary_send_day: nextValue ?? prev.weekly_summary_send_day }))}>
                    <SelectTrigger><span>{WEEKDAY_OPTIONS.find((option) => option.value === settings.weekly_summary_send_day)?.label ?? 'Select day'}</span></SelectTrigger>
                    <SelectContent>{WEEKDAY_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <FieldNote>Vercel cron currently controls exact delivery.</FieldNote>
              </div>
              <div>
                <Label>Send Time</Label>
                <Input type="time" value={settings.weekly_summary_send_time} onChange={(event) => setSettings((prev) => ({ ...prev, weekly_summary_send_time: event.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Recipient</Label>
                <Input value={settings.weekly_summary_recipient} onChange={(event) => setSettings((prev) => ({ ...prev, weekly_summary_recipient: event.target.value }))} className="mt-1" />
              </div>
            </div>
          </SettingsSection>

          <SettingsSection title="Announcements" description="Time clock announcement text and event email notifications." icon={<Send className="h-5 w-5" />}>
            <div className="grid gap-4 md:grid-cols-[1fr_180px_1fr]">
              <div>
                <Label>Clock-In Announcement</Label>
                <Textarea
                  value={settings.time_clock_announcement}
                  onChange={(event) => setSettings((prev) => ({ ...prev, time_clock_announcement: event.target.value }))}
                  className="mt-1 min-h-24"
                  placeholder="Example: Patio section open tonight. Check with manager before breaks."
                />
              </div>
              <div>
                <Label>Event Emails</Label>
                <div className="mt-1">
                  <BooleanSelect value={settings.announcement_event_emails_enabled} onChange={(nextValue) => setSettings((prev) => ({ ...prev, announcement_event_emails_enabled: nextValue }))} />
                </div>
              </div>
              <div>
                <Label>Announcement Event Recipient</Label>
                <Input value={settings.announcement_event_email} onChange={(event) => setSettings((prev) => ({ ...prev, announcement_event_email: event.target.value }))} className="mt-1" />
              </div>
            </div>
          </SettingsSection>

          {(error || saved) && (
            <div className={`rounded-xl border px-3 py-2 text-sm ${error ? 'border-red-200 bg-red-50 text-red-600' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
              {error ?? saved}
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Settings'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
