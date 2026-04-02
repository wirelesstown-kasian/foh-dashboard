import { hashPin } from '@/lib/pin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const DEFAULT_ADMIN_NAME = 'Default Admin'
export const DEFAULT_ADMIN_PIN = '1234'

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
  const { error } = await supabaseAdmin.from('employees').insert({
    name: DEFAULT_ADMIN_NAME,
    role: 'manager',
    email: null,
    pin_hash: pinHash,
  })

  if (error) {
    throw new Error(error.message)
  }

  return { created: true }
}
