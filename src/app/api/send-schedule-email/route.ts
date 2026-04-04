import { NextRequest, NextResponse } from 'next/server'
import { sendWeeklyScheduleEmails } from '@/lib/scheduleEmail'

export async function POST(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
  const { week_start, week_end } = await req.json()
  if (!week_start || !week_end) return NextResponse.json({ error: 'Missing week_start or week_end' }, { status: 400 })

  const result = await sendWeeklyScheduleEmails({
    weekStart: week_start,
    weekEnd: week_end,
    appUrl,
  })

  if (!result.success) {
    return NextResponse.json(result, { status: 207 })
  }

  return NextResponse.json(result)
}
