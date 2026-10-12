import { NextResponse } from 'next/server'

// Managers are created by an authenticated manager through the staffing API.
// Public first-manager setup could take over a project if all managers become inactive.
export async function GET() {
  return NextResponse.json({ needsSetup: false })
}

export async function POST() {
  return NextResponse.json({ error: 'Public manager setup is disabled' }, { status: 410 })
}
