import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { findInvite } from '@/lib/onboarding'
import { prefillOnboardingForm } from '@/lib/onboardingForms'

export async function POST(req: NextRequest) {
  const { token, kind } = await req.json() as { token?: string; kind?: string }
  const row = await findInvite(token ?? '')
  if (!row || row.status === 'invited') return NextResponse.json({ error: 'Complete your application first' }, { status: 403 })
  if (kind !== 'w4' && kind !== 'i9') return NextResponse.json({ error: 'Invalid form' }, { status: 400 })
  if (!(row.selected_documents ?? []).includes(kind)) return NextResponse.json({ error: 'This form was not assigned to you' }, { status: 403 })
  if (kind === 'w4' && new Date().getUTCFullYear() !== 2026) return NextResponse.json({ error: 'The bundled W-4 needs the current-year update. Use the IRS link below until a manager updates the template.' }, { status: 409 })
  if (kind === 'i9' && new Date() > new Date('2027-05-31T23:59:59Z')) return NextResponse.json({ error: 'The bundled I-9 needs review against the current USCIS version.' }, { status: 409 })
  const normalizedSsn = row.ssn ?? ''
  if (normalizedSsn && !/^\d{9}$/.test(normalizedSsn)) return NextResponse.json({ error: 'SSN must contain nine digits' }, { status: 400 })
  const employer = row.company_snapshot as { legal_name: string; street: string; city: string; state: string; postal_code: string; ein: string }
  const template = await readFile(path.join(process.cwd(), 'public', 'forms', kind === 'w4' ? 'w4-2026.pdf' : 'i9.pdf'))
  const bytes = await prefillOnboardingForm(kind, template, row, employer, normalizedSsn)
  return new NextResponse(new Uint8Array(bytes), { headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="prefilled-${kind}.pdf"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  } })
}
