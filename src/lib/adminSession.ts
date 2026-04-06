export const ADMIN_SESSION_COOKIE = 'foh_admin_session'

// 32-byte random hex token — not guessable unlike Date.now()
export function createAdminSessionValue() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

// Accepts both legacy timestamp tokens (13-digit Date.now()) and new 64-char hex tokens.
// Cookie maxAge (8h) enforces expiry at the browser/server level.
export function isValidAdminSession(value: string | undefined | null) {
  if (!value) return false
  return /^[0-9a-f]{64}$/.test(value) || /^\d{13}$/.test(value)
}
