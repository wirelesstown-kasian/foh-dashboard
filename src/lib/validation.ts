/** Returns true if value is a valid 4-digit numeric PIN string. */
export function isValidPin(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}$/.test(value)
}
