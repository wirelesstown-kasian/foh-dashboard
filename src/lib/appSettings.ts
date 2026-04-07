import { supabaseAdmin } from '@/lib/supabaseAdmin'

export interface EmailSettings {
  from_name: string
  from_email: string
  reply_to: string
  eod_report_email: string
  eod_tip_emails_enabled: boolean
  eod_admin_summary_enabled: boolean
  schedule_emails_enabled: boolean
  wage_report_emails_enabled: boolean
}

const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  from_name: 'FOH Dashboard',
  from_email: 'noreply@mail.newvillagepub.com',
  reply_to: 'admin@newvillagepub.com',
  eod_report_email: process.env.EOD_REPORT_EMAIL ?? 'admin@newvillagepub.com',
  eod_tip_emails_enabled: true,
  eod_admin_summary_enabled: true,
  schedule_emails_enabled: true,
  wage_report_emails_enabled: true,
}

const EMAIL_SETTING_KEYS = Object.keys(DEFAULT_EMAIL_SETTINGS) as Array<keyof EmailSettings>

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export async function getEmailSettings(): Promise<EmailSettings> {
  const { data, error } = await supabaseAdmin
    .from('app_settings')
    .select('key, value')
    .in('key', EMAIL_SETTING_KEYS)

  if (error) {
    throw new Error(error.message)
  }

  const settings = { ...DEFAULT_EMAIL_SETTINGS }
  for (const row of (data ?? []) as Array<{ key: keyof EmailSettings; value: unknown }>) {
    if (row.key === 'eod_tip_emails_enabled' || row.key === 'eod_admin_summary_enabled' || row.key === 'schedule_emails_enabled' || row.key === 'wage_report_emails_enabled') {
      settings[row.key] = normalizeBoolean(row.value, settings[row.key])
      continue
    }
    settings[row.key] = normalizeString(row.value, settings[row.key])
  }

  return settings
}

export async function saveEmailSettings(input: Partial<EmailSettings>) {
  const payload = { ...(await getEmailSettings()), ...input }
  const rows = EMAIL_SETTING_KEYS.map((key) => ({
    key,
    value: payload[key],
    updated_at: new Date().toISOString(),
  }))

  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert(rows, { onConflict: 'key' })

  if (error) {
    throw new Error(error.message)
  }

  return payload
}
