import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    GOOGLE_OAUTH_CLIENT_ID: !!process.env.GOOGLE_OAUTH_CLIENT_ID?.trim(),
    GOOGLE_OAUTH_CLIENT_SECRET: !!process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
    GOOGLE_OAUTH_REFRESH_TOKEN: !!process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim(),
    GOOGLE_BUSINESS_LOCATION_ID: !!process.env.GOOGLE_BUSINESS_LOCATION_ID?.trim(),
    will_use_business_profile: !!(
      process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() &&
      process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim() &&
      process.env.GOOGLE_BUSINESS_LOCATION_ID?.trim()
    ),
  })
}
