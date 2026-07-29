import { hashPin } from '@/lib/pin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const DEFAULT_ADMIN_NAME = 'Default Admin'
export const DEFAULT_ADMIN_PIN = '1234'

function isMissingPinCodeColumn(error: { message?: string } | null | undefined) {
  return (error?.message?.toLowerCase() ?? '').includes('pin_code')
}

export async function hasActiveManagers() {
  const { count, error } = await supabaseAdmin
    .from('employees')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'manager')
    .eq('is_active', true)

  if (error) {
    throw new Error(error.message)
  }

  return (count ?? 0) > 0
}

export async function ensureDefaultAdmin() {
  if (await hasActiveManagers()) {
    return { created: false }
  }

  const pinHash = await hashPin(DEFAULT_ADMIN_PIN)
  const payload = {
    name: DEFAULT_ADMIN_NAME,
    role: 'manager',
    email: null,
    pin_hash: pinHash,
    pin_code: DEFAULT_ADMIN_PIN,
  }
  let { error } = await supabaseAdmin.from('employees').insert(payload)
  if (error && isMissingPinCodeColumn(error)) {
    const fallbackPayload: Omit<typeof payload, 'pin_code'> = {
      name: payload.name,
      role: payload.role,
      email: payload.email,
      pin_hash: payload.pin_hash,
    }
    const fallback = await supabaseAdmin.from('employees').insert(fallbackPayload)
    error = fallback.error
  }

  if (error) {
    throw new Error(error.message)
  }

  return { created: true }
}
