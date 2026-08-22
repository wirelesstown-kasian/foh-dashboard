import { createClient } from '@supabase/supabase-js'

const supabaseAdminKeyCandidates = [
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  process.env.SUPABASE_SECRET_KEY,
  process.env.SUPABASE_SERVICE_KEY,
  process.env.SUPABASE_SERVICE_ROLE,
].filter((value): value is string => Boolean(value?.trim()))

function isPublicSupabaseKey(value: string) {
  return (
    value.startsWith('sb_publishable_') ||
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && value === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  )
}

const supabaseAdminKey = supabaseAdminKeyCandidates.find(value => !isPublicSupabaseKey(value)) ?? null

export function getSupabaseAdminConfigError() {
  if (supabaseAdminKey) return null
  if (supabaseAdminKeyCandidates.some(isPublicSupabaseKey)) {
    return 'Supabase admin key is using only public/publishable keys. Add a secret/service-role key for server clock writes.'
  }
  return 'Supabase service role key is missing'
}

// Intentionally no public-key fallback — if no secret/service-role key is present
// at runtime, requests will fail with an authentication error rather than
// silently bypassing RLS by using the public anon key.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
  supabaseAdminKey ?? 'placeholder'
)
