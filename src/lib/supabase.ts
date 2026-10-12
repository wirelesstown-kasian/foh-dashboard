import { createClient } from '@supabase/supabase-js'

const SUPABASE_PUBLIC_URL = 'https://gnaubgccxjbgxrtmffhp.supabase.co'
const SUPABASE_PUBLIC_ANON_KEY = 'sb_publishable_tD-mN2QxadNnXWGjXgPPxQ_ySHVzaUt'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? SUPABASE_PUBLIC_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? SUPABASE_PUBLIC_ANON_KEY

// Browser database requests use our session-checked application endpoint. The
// publishable key remains only for constructing the Supabase client; it grants
// no direct table access after the RLS cutover.
const dashboardFetch: typeof fetch = (input, init) => {
  const requestUrl = new URL(input instanceof Request ? input.url : String(input))
  if (typeof window !== 'undefined' && requestUrl.origin === new URL(supabaseUrl).origin
    && requestUrl.pathname.startsWith('/rest/v1/')) {
    const table = requestUrl.pathname.slice('/rest/v1/'.length)
    if (!/^[a-z_]+$/.test(table)) return Promise.reject(new Error('Unsupported database path'))
    const headers = new Headers(init?.headers)
    headers.delete('apikey')
    headers.delete('authorization')
    return fetch(`/api/dashboard-data/${table}${requestUrl.search}`, {
      ...init,
      headers,
      credentials: 'same-origin',
    })
  }
  return fetch(input, init)
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: dashboardFetch },
})
