import { supabaseAdmin } from '@/lib/supabaseAdmin'

export interface EmailSettings {
  from_name: string
  from_email: string
  reply_to: string
  eod_report_email: string
  eod_tip_emails_enabled: boolean
  eod_admin_summary_enabled: boolean
  schedule_emails_enabled: boolean
  queued_schedule_emails_enabled: boolean
  schedule_default_send_day: string
  schedule_default_send_time: string
  weekly_summary_emails_enabled: boolean
  weekly_summary_recipient: string
  wage_report_emails_enabled: boolean
  announcement_event_emails_enabled: boolean
  announcement_event_email: string
}

export interface RoleDefinition {
  key: string
  label: string
  description?: string
  color?: string
  is_active: boolean
  display_order: number
}

export interface DepartmentDefinition {
  key: string
  label: string
  description?: string
  payroll_cycle?: 'weekly' | 'semi_monthly'
  is_active: boolean
  display_order: number
}

export type AnnouncementDuration = 'month' | '7days' | 'until_close'
export type AnnouncementRecurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'annually'

export interface AnnouncementEvent {
  id: string
  title: string
  date: string
  time?: string
  day_start_time?: string
  day_end_time?: string
  place?: string
  duration: AnnouncementDuration
  recurrence?: AnnouncementRecurrence
  recurrence_end_date?: string
  is_active: boolean
}

export interface AppSettings extends EmailSettings {
  role_definitions: RoleDefinition[]
  primary_department_definitions: DepartmentDefinition[]
  time_clock_announcement: string
  announcement_events: AnnouncementEvent[]
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  from_name: 'FOH Dashboard',
  from_email: 'noreply@mail.newvillagepub.com',
  reply_to: 'admin@newvillagepub.com',
  eod_report_email: process.env.EOD_REPORT_EMAIL ?? 'admin@newvillagepub.com',
  eod_tip_emails_enabled: true,
  eod_admin_summary_enabled: true,
  schedule_emails_enabled: true,
  queued_schedule_emails_enabled: true,
  schedule_default_send_day: 'sunday',
  schedule_default_send_time: '21:00',
  weekly_summary_emails_enabled: true,
  weekly_summary_recipient: process.env.EOD_REPORT_EMAIL ?? 'admin@newvillagepub.com',
  wage_report_emails_enabled: true,
  announcement_event_emails_enabled: true,
  announcement_event_email: process.env.EOD_REPORT_EMAIL ?? 'admin@newvillagepub.com',
  time_clock_announcement: '',
  announcement_events: [],
  role_definitions: [
    { key: 'manager', label: 'Manager', description: 'Admin access and oversight', color: '#8b5cf6', is_active: true, display_order: 0 },
    { key: 'server', label: 'Server', description: 'Guest-facing service and table management', color: '#0ea5e9', is_active: true, display_order: 1 },
    { key: 'busser', label: 'Busser', description: 'Table reset and dining room support', color: '#10b981', is_active: true, display_order: 2 },
    { key: 'runner', label: 'Runner', description: 'Food running and service support', color: '#f59e0b', is_active: true, display_order: 3 },
    { key: 'kitchen_staff', label: 'Kitchen Staff', description: 'Back-of-house prep and line work', color: '#f43f5e', is_active: true, display_order: 4 },
  ],
  primary_department_definitions: [
    { key: 'manager', label: 'Manager', description: 'Management and schedule oversight', payroll_cycle: 'semi_monthly', is_active: true, display_order: 0 },
    { key: 'server', label: 'Server', description: 'Dining room service', payroll_cycle: 'weekly', is_active: true, display_order: 1 },
    { key: 'cook', label: 'Cook', description: 'Cooking shifts', payroll_cycle: 'semi_monthly', is_active: true, display_order: 2 },
    { key: 'kitchen', label: 'Kitchen', description: 'Kitchen support shifts', payroll_cycle: 'semi_monthly', is_active: true, display_order: 3 },
  ],
}

const APP_SETTING_KEYS = Object.keys(DEFAULT_APP_SETTINGS) as Array<keyof AppSettings>

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizeWeekday(value: unknown, fallback: string) {
  const allowedDays = new Set(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'])
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  return allowedDays.has(normalized) ? normalized : fallback
}

function normalizeTime(value: unknown, fallback: string) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim()) ? value.trim() : fallback
}

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeOptionalHexColor(value: unknown) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : undefined
}

function normalizeAnnouncementDuration(value: unknown): AnnouncementDuration {
  return value === 'month' || value === '7days' || value === 'until_close' ? value : '7days'
}

function normalizeAnnouncementRecurrence(value: unknown): AnnouncementRecurrence {
  return value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'annually' ? value : 'none'
}

function normalizeAnnouncementEvents(value: unknown): AnnouncementEvent[] {
  if (!Array.isArray(value)) return []
  const normalized = value
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') return null
      const maybeEntry = entry as Partial<AnnouncementEvent>
      const title = typeof maybeEntry.title === 'string' ? maybeEntry.title.trim() : ''
      const date = typeof maybeEntry.date === 'string' ? maybeEntry.date.trim() : ''
      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
      const normalizedEntry: AnnouncementEvent = {
        id: typeof maybeEntry.id === 'string' && maybeEntry.id.trim() ? maybeEntry.id.trim() : `event-${index}`,
        title,
        date,
        duration: normalizeAnnouncementDuration(maybeEntry.duration),
        is_active: maybeEntry.is_active !== false,
      }
      if (typeof maybeEntry.time === 'string' && maybeEntry.time.trim()) normalizedEntry.time = maybeEntry.time.trim()
      if (typeof maybeEntry.day_start_time === 'string' && maybeEntry.day_start_time.trim()) normalizedEntry.day_start_time = maybeEntry.day_start_time.trim()
      if (typeof maybeEntry.day_end_time === 'string' && maybeEntry.day_end_time.trim()) normalizedEntry.day_end_time = maybeEntry.day_end_time.trim()
      if (typeof maybeEntry.place === 'string' && maybeEntry.place.trim()) normalizedEntry.place = maybeEntry.place.trim()
      normalizedEntry.recurrence = normalizeAnnouncementRecurrence(maybeEntry.recurrence)
      if (typeof maybeEntry.recurrence_end_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(maybeEntry.recurrence_end_date.trim())) {
        normalizedEntry.recurrence_end_date = maybeEntry.recurrence_end_date.trim()
      }
      return normalizedEntry
    })
    .filter((entry): entry is AnnouncementEvent => entry !== null)
  return normalized.sort((left, right) => left.date.localeCompare(right.date) || (left.time ?? '').localeCompare(right.time ?? ''))
}

function getDefaultPayrollCycleForDepartment(key: string) {
  return key === 'server' ? 'weekly' : 'semi_monthly'
}

function normalizePayrollCycle(value: unknown, departmentKey: string) {
  return value === 'weekly' || value === 'semi_monthly'
    ? value
    : getDefaultPayrollCycleForDepartment(departmentKey)
}

function normalizeDefinitions<T extends RoleDefinition | DepartmentDefinition>(value: unknown, fallback: T[]): T[] {
  if (!Array.isArray(value)) return fallback
  const includesPayrollCycle = fallback.some(entry => 'payroll_cycle' in entry)
  const normalized = value
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') return null
      const maybeEntry = entry as Partial<T>
      if (typeof maybeEntry.key !== 'string' || !maybeEntry.key.trim()) return null
      const normalizedEntry = {
        key: maybeEntry.key.trim(),
        label: typeof maybeEntry.label === 'string' && maybeEntry.label.trim() ? maybeEntry.label.trim() : maybeEntry.key.trim(),
        description: normalizeOptionalString(maybeEntry.description),
        color: normalizeOptionalHexColor((maybeEntry as Partial<RoleDefinition>).color),
        is_active: typeof maybeEntry.is_active === 'boolean' ? maybeEntry.is_active : true,
        display_order: typeof maybeEntry.display_order === 'number' ? maybeEntry.display_order : index,
      }
      return (includesPayrollCycle
        ? {
            ...normalizedEntry,
            payroll_cycle: normalizePayrollCycle((maybeEntry as Partial<DepartmentDefinition>).payroll_cycle, maybeEntry.key.trim()),
          }
        : normalizedEntry) as unknown as T
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
    if (row.key === 'announcement_events') {
      settings.announcement_events = normalizeAnnouncementEvents(row.value)
      continue
    }
    if (
      row.key === 'eod_tip_emails_enabled' ||
      row.key === 'eod_admin_summary_enabled' ||
      row.key === 'schedule_emails_enabled' ||
      row.key === 'queued_schedule_emails_enabled' ||
      row.key === 'weekly_summary_emails_enabled' ||
      row.key === 'wage_report_emails_enabled' ||
      row.key === 'announcement_event_emails_enabled'
    ) {
      settings[row.key] = normalizeBoolean(row.value, settings[row.key])
      continue
    }
    if (row.key === 'schedule_default_send_day') {
      settings.schedule_default_send_day = normalizeWeekday(row.value, settings.schedule_default_send_day)
      continue
    }
    if (row.key === 'schedule_default_send_time') {
      settings.schedule_default_send_time = normalizeTime(row.value, settings.schedule_default_send_time)
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
    queued_schedule_emails_enabled: settings.queued_schedule_emails_enabled,
    schedule_default_send_day: settings.schedule_default_send_day,
    schedule_default_send_time: settings.schedule_default_send_time,
    weekly_summary_emails_enabled: settings.weekly_summary_emails_enabled,
    weekly_summary_recipient: settings.weekly_summary_recipient,
    wage_report_emails_enabled: settings.wage_report_emails_enabled,
    announcement_event_emails_enabled: settings.announcement_event_emails_enabled,
    announcement_event_email: settings.announcement_event_email,
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
