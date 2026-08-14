import { NextResponse } from 'next/server'
import { ensureDefaultAdmin, DEFAULT_ADMIN_NAME, DEFAULT_ADMIN_PIN } from '@/lib/adminBootstrap'
import { getSupabaseAdminConfigError } from '@/lib/supabaseAdmin'

export async function POST() {
  const configError = getSupabaseAdminConfigError()
  if (configError) {
    return NextResponse.json({ error: `Supabase admin is not configured: ${configError}` }, { status: 500 })
  }

  try {
    const result = await ensureDefaultAdmin()
    return NextResponse.json({
      success: true,
      created: result.created,
      name: DEFAULT_ADMIN_NAME,
      pin: DEFAULT_ADMIN_PIN,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create default admin' }, { status: 500 })
  }
}
