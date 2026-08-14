import { createClient } from '@supabase/supabase-js'

const supabaseAdminUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL

export function getSupabaseAdminConfigError() {
  if (!supabaseAdminUrl) return 'NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL is missing'
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return 'SUPABASE_SERVICE_ROLE_KEY is missing'
  return null
}

// Intentionally no anon key fallback — if SUPABASE_SERVICE_ROLE_KEY is missing
// at runtime, requests will fail with an authentication error rather than
// silently bypassing RLS by using the public anon key.
export const supabaseAdmin = createClient(
  supabaseAdminUrl ?? 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'placeholder'
)
