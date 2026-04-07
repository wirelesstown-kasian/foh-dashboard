import { NextResponse } from 'next/server'
import { getAppSettings } from '@/lib/appSettings'

export async function GET() {
  try {
    const settings = await getAppSettings()
    return NextResponse.json({
      role_definitions: settings.role_definitions,
      primary_department_definitions: settings.primary_department_definitions,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load org settings' }, { status: 500 })
  }
}
