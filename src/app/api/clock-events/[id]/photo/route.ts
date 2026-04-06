import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { CLOCK_PHOTO_BUCKET } from '@/lib/clockUtils'

export const runtime = 'nodejs'

async function requireAdmin() {
  const cookieStore = await cookies()
  return isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const kind = req.nextUrl.searchParams.get('kind') === 'out' ? 'out' : 'in'

  const { data: record, error } = await supabaseAdmin
    .from('shift_clocks')
    .select('clock_in_photo_path, clock_out_photo_path')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!record) {
    return NextResponse.json({ error: 'Clock record not found' }, { status: 404 })
  }

  const path = kind === 'out' ? record.clock_out_photo_path : record.clock_in_photo_path
  if (!path) {
    return NextResponse.json({ error: 'Photo not available' }, { status: 404 })
  }

  const { data, error: signedUrlError } = await supabaseAdmin
    .storage
    .from(CLOCK_PHOTO_BUCKET)
    .createSignedUrl(path, 60 * 10)

  if (signedUrlError || !data?.signedUrl) {
    return NextResponse.json({ error: signedUrlError?.message ?? 'Failed to open photo' }, { status: 500 })
  }

  return NextResponse.redirect(data.signedUrl)
}
