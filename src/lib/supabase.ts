import { createClient } from '@supabase/supabase-js'

const SUPABASE_PUBLIC_URL = 'https://gnaubgccxjbgxrtmffhp.supabase.co'
const SUPABASE_PUBLIC_ANON_KEY = 'sb_publishable_tD-mN2QxadNnXWGjXgPPxQ_ySHVzaUt'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? SUPABASE_PUBLIC_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? SUPABASE_PUBLIC_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
