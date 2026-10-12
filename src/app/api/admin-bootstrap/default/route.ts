import { NextResponse } from 'next/server'
export async function POST() {
  return NextResponse.json({ error: 'Default manager setup is disabled' }, { status: 410 })
}
