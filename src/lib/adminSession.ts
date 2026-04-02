export const ADMIN_SESSION_COOKIE = 'foh_admin_session'

export function createAdminSessionValue() {
  return String(Date.now())
}

export function isValidAdminSession(value: string | undefined | null) {
  return Boolean(value)
}
