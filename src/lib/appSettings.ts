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

export interface RoleDefinition {
  key: string
  label: string
  is_active: boolean
  display_order: number
}

export interface DepartmentDefinition {
  key: string
  label: string
  is_active: boolean
  display_order: number
}

export interface AppSettings extends EmailSettings {
  role_definitions: RoleDefinition[]
  primary_department_definitions: DepartmentDefinition[]
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  from_name: 'FOH Dashboard',
  from_email: 'noreply@mail.newvillagepub.com',
  reply_to: 'admin@newvillagepub.com',
  eod_report_email: process.env.EOD_REPORT_EMAIL ?? 'admin@newvillagepub.com',
  eod_tip_emails_enabled: true,
  eod_admin_summary_enabled: true,
  schedule_emails_enabled: true,
  wage_report_emails_enabled: true,
  role_definitions: [
    { key: 'manager', label: 'Manager', is_active: true, display_order: 0 },
    { key: 'server', label: 'Server', is_active: true, display_order: 1 },
    { key: 'busser', label: 'Busser', is_active: true, display_order: 2 },
    { key: 'runner', label: 'Runner', is_active: true, display_order: 3 },
    { key: 'kitchen_staff', label: 'Kitchen Staff', is_active: true, display_order: 4 },
  ],
  primary_department_definitions: [
    { key: 'foh', label: 'FOH', is_active: true, display_order: 0 },
    { key: 'boh', label: 'BOH', is_active: true, display_order: 1 },
    { key: 'hybrid', label: 'Hybrid', is_active: true, display_order: 2 },
  ],
}

const APP_SETTING_KEYS = Object.keys(DEFAULT_APP_SETTINGS) as Array<keyof AppSettings>

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizeDefinitions<T extends RoleDefinition | DepartmentDefinition>(value: unknown, fallback: T[]): T[] {
  if (!Array.isArray(value)) return fallback
  const normalized = value
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') return null
      const maybeEntry = entry as Partial<T>
      if (typeof maybeEntry.key !== 'string' || !maybeEntry.key.trim()) return null
      return {
        key: maybeEntry.key.trim(),
        label: typeof maybeEntry.label === 'string' && maybeEntry.label.trim() ? maybeEntry.label.trim() : maybeEntry.key.trim(),
        is_active: typeof maybeEntry.is_active === 'boolean' ? maybeEntry.is_active : true,
        display_order: typeof maybeEntry.display_order === 'number' ? maybeEntry.display_order : index,
      } as T
    })
    .filter((entry): entry is T => entry !== null)

  return normalized.length > 0 ? normalized.sort((a, b) => a.display_order - b.display_order) : fallback
}

export async function getAppSettings(): Promise<AppSettings> {
  const { data, error } = await supabaseAdmin
    .from('app_settings')
    .select('key, value')
    .in('key', APP_SETTING_KEYS)

  if (error) {
    throw new Error(error.message)
  }

  const settings = { ...DEFAULT_APP_SETTINGS }
  for (const row of (data ?? []) as Array<{ key: keyof AppSettings; value: unknown }>) {
    if (row.key === 'role_definitions') {
      settings.role_definitions = normalizeDefinitions(row.value, settings.role_definitions)
      continue
    }
    if (row.key === 'primary_department_definitions') {
      settings.primary_department_definitions = normalizeDefinitions(row.value, settings.primary_department_definitions)
      continue
    }
    if (row.key === 'eod_tip_emails_enabled' || row.key === 'eod_admin_summary_enabled' || row.key === 'schedule_emails_enabled' || row.key === 'wage_report_emails_enabled') {
      settings[row.key] = normalizeBoolean(row.value, settings[row.key])
      continue
    }
    settings[row.key] = normalizeString(row.value, settings[row.key])
  }

  return settings
}

export async function getEmailSettings(): Promise<EmailSettings> {
  const settings = await getAppSettings()
  return {
    from_name: settings.from_name,
    from_email: settings.from_email,
    reply_to: settings.reply_to,
    eod_report_email: settings.eod_report_email,
    eod_tip_emails_enabled: settings.eod_tip_emails_enabled,
    eod_admin_summary_enabled: settings.eod_admin_summary_enabled,
    schedule_emails_enabled: settings.schedule_emails_enabled,
    wage_report_emails_enabled: settings.wage_report_emails_enabled,
  }
}

export async function saveAppSettings(input: Partial<AppSettings>) {
  const payload = { ...(await getAppSettings()), ...input }
  const rows = APP_SETTING_KEYS.map((key) => ({
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

export async function saveEmailSettings(input: Partial<EmailSettings>) {
  return saveAppSettings(input)
}
