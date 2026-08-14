import { createClient } from '@supabase/supabase-js'

const supabaseAdminKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? process.env.SUPABASE_SECRET_KEY
  ?? process.env.SUPABASE_SERVICE_KEY
  ?? process.env.SUPABASE_SERVICE_ROLE
  ?? null

export function getSupabaseAdminConfigError() {
  if (!supabaseAdminKey) return 'Supabase service role key is missing'
  if (supabaseAdminKey.startsWith('sb_publishable_')) {
    return 'Supabase admin key is using a publishable key. Use a secret/service-role key for server clock writes.'
  }
  if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && supabaseAdminKey === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return 'Supabase admin key matches the public anon key. Use a service-role key for server clock writes.'
  }
  return null
}

// Intentionally no anon key fallback — if SUPABASE_SERVICE_ROLE_KEY is missing
// at runtime, requests will fail with an authentication error rather than
// silently bypassing RLS by using the public anon key.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
  supabaseAdminKey ?? 'placeholder'
)
