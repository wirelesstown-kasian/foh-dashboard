import { NextRequest, NextResponse } from 'next/server'
import { managerId } from '@/lib/onboarding'
import { decryptRecord } from '@/lib/onboardingArchive'

export async function POST(req: NextRequest) {
  if (!await managerId()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File) || file.size > 30 * 1024 * 1024) return NextResponse.json({ error: 'Choose an onboarding .nvrecord file under 30 MB' }, { status: 400 })
  try {
    const files = decryptRecord(Buffer.from(await file.arrayBuffer()))
    return NextResponse.json({ files }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ error: 'Could not open archive. Check the archive key and file.' }, { status: 400 }) }
}
