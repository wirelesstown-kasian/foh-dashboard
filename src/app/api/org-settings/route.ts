import { NextResponse } from 'next/server'
import { getAppSettings } from '@/lib/appSettings'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const settings = await getAppSettings()
    return NextResponse.json({
      role_definitions: settings.role_definitions,
      primary_department_definitions: settings.primary_department_definitions,
      eod_send_timing: settings.eod_send_timing,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load org settings' }, { status: 500 })
  }
}
