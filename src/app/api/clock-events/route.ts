import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyPin } from '@/lib/pin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isValidPin } from '@/lib/validation'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { CLOCK_PHOTO_BUCKET, calculateClockHours, dataUrlToArrayBuffer, getSessionCutoffIso } from '@/lib/clockUtils'
import { ShiftClock } from '@/lib/types'

export const runtime = 'nodejs'

async function requireAdmin() {
  const cookieStore = await cookies()
  return isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)
}

async function verifyEmployeeByPin(pin: string) {
  const { data: employees, error } = await supabaseAdmin
    .from('employees')
    .select('id, name, role, pin_hash')
    .eq('is_active', true)

  if (error) throw new Error(error.message)

  for (const employee of employees ?? []) {
    if (await verifyPin(pin, employee.pin_hash)) return employee
  }

  return null
}

async function ensureClockPhotoBucket() {
  const { data } = await supabaseAdmin.storage.getBucket(CLOCK_PHOTO_BUCKET)
  if (data) return
  await supabaseAdmin.storage.createBucket(CLOCK_PHOTO_BUCKET, {
    public: false,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/heic', 'image/webp'],
    fileSizeLimit: 10 * 1024 * 1024,
  })
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

function getPhotoExtension(dataUrl: string): string {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/)
  const mime = match?.[1] ?? 'image/jpeg'
  return MIME_TO_EXT[mime] ?? 'jpg'
}

function isValidSessionDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

async function uploadPhoto(dataUrl: string, path: string) {
  await ensureClockPhotoBucket()
  const binary = await dataUrlToArrayBuffer(dataUrl)
  const contentTypeMatch = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/)
  const contentType = contentTypeMatch?.[1] ?? 'image/jpeg'
  const { error } = await supabaseAdmin.storage.from(CLOCK_PHOTO_BUCKET).upload(path, binary, {
    contentType,
    upsert: true,
  })
  if (error) throw new Error(error.message)
  return path
}

async function addSignedUrls(records: ShiftClock[]) {
  return Promise.all(records.map(async record => {
    let clockInUrl: string | null = null
    let clockOutUrl: string | null = null

    if (record.clock_in_photo_path) {
      const result = await supabaseAdmin.storage.from(CLOCK_PHOTO_BUCKET).createSignedUrl(record.clock_in_photo_path, 60 * 30)
      clockInUrl = result.data?.signedUrl ?? null
    }
    if (record.clock_out_photo_path) {
      const result = await supabaseAdmin.storage.from(CLOCK_PHOTO_BUCKET).createSignedUrl(record.clock_out_photo_path, 60 * 30)
      clockOutUrl = result.data?.signedUrl ?? null
    }

    return {
      ...record,
      clock_in_photo_url: clockInUrl,
      clock_out_photo_url: clockOutUrl,
    }
  }))
}

async function processOverdueClockRecords() {
  const { data, error } = await supabaseAdmin
    .from('shift_clocks')
    .select('*')
    .is('clock_out_at', null)

  if (error || !data) return

  const now = new Date()
  for (const record of data as ShiftClock[]) {
    const cutoffIso = getSessionCutoffIso(record.session_date)
    if (new Date(cutoffIso) > now) continue

    await supabaseAdmin
      .from('shift_clocks')
      .update({
        clock_out_at: cutoffIso,
        auto_clock_out: true,
        approval_status: 'pending_review',
        approved_hours: null,
        manager_note: 'Auto clock-out triggered at business cutoff. Manager approval required.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', record.id)
  }
}

async function upsertClockTaskCompletion(taskId: string | null | undefined, employeeId: string, sessionDate: string) {
  if (!taskId) return
  const { data: existing } = await supabaseAdmin
    .from('task_completions')
    .select('id')
    .eq('task_id', taskId)
    .eq('session_date', sessionDate)
    .maybeSingle()

  if (existing?.id) {
    await supabaseAdmin
      .from('task_completions')
      .update({ employee_id: employeeId, status: 'complete' })
      .eq('id', existing.id)
    return
  }

  await supabaseAdmin
    .from('task_completions')
    .insert({ task_id: taskId, employee_id: employeeId, session_date: sessionDate, status: 'complete' })
}

export async function GET(req: NextRequest) {
  const includePhotos = req.nextUrl.searchParams.get('include_photos') === '1'
  const sessionDate = req.nextUrl.searchParams.get('session_date')
  const startDate = req.nextUrl.searchParams.get('start_date')
  const endDate = req.nextUrl.searchParams.get('end_date')

  let query = supabaseAdmin
    .from('shift_clocks')
    .select('*, employee:employees!shift_clocks_employee_id_fkey(*)')
    .order('session_date', { ascending: false })
    .order('clock_in_at', { ascending: false })

  if (sessionDate) query = query.eq('session_date', sessionDate)
  if (startDate) query = query.gte('session_date', startDate)
  if (endDate) query = query.lte('session_date', endDate)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const records = (data ?? []) as ShiftClock[]
  if (includePhotos) {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ records: await addSignedUrls(records) })
  }

  return NextResponse.json({ records })
}

export async function POST(req: NextRequest) {
  await processOverdueClockRecords()

  const { action, pin, session_date, photo_data_url, task_id, skip_photo } = await req.json() as {
    action?: 'clock_in' | 'clock_out'
    pin?: string
    session_date?: string
    photo_data_url?: string
    task_id?: string
    skip_photo?: boolean
  }

  if (!action || !session_date) {
    return NextResponse.json({ error: 'Missing clock payload' }, { status: 400 })
  }
  if (!isValidSessionDate(session_date)) {
    return NextResponse.json({ error: 'Invalid session_date format' }, { status: 400 })
  }
  if (!isValidPin(pin)) {
    return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 })
  }

  const employee = await verifyEmployeeByPin(pin)
  if (!employee) {
    return NextResponse.json({ error: 'Incorrect PIN' }, { status: 401 })
  }

  const { data: existingRecord, error: recordError } = await supabaseAdmin
    .from('shift_clocks')
    .select('*')
    .eq('employee_id', employee.id)
    .eq('session_date', session_date)
    .maybeSingle()

  if (recordError) {
    return NextResponse.json({ error: recordError.message }, { status: 500 })
  }

  const nowIso = new Date().toISOString()
  const ext = photo_data_url ? getPhotoExtension(photo_data_url) : 'jpg'
  const photoPath = `${session_date}/${employee.id}/${action}-${Date.now()}.${ext}`
  const allowPhotoSkip = action === 'clock_in' && skip_photo === true && employee.role === 'manager'

  if (!allowPhotoSkip && !photo_data_url) {
    return NextResponse.json({ error: 'Photo is required for clock events' }, { status: 400 })
  }

  if (photo_data_url) {
    try {
      await uploadPhoto(photo_data_url, photoPath)
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to upload photo' }, { status: 500 })
    }
  }

  if (action === 'clock_in') {
    if (existingRecord?.clock_in_at) {
      return NextResponse.json({ error: 'You are already clocked in for this business day' }, { status: 400 })
    }

    const { error } = await supabaseAdmin.from('shift_clocks').insert({
      session_date,
      employee_id: employee.id,
      clock_in_at: nowIso,
      clock_in_photo_path: photo_data_url ? photoPath : '',
      approval_status: 'open',
      manager_note: allowPhotoSkip ? 'Manager clock-in without photo.' : null,
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await upsertClockTaskCompletion(task_id, employee.id, session_date)
    return NextResponse.json({ success: true, employee })
  }

  if (!existingRecord?.clock_in_at) {
    return NextResponse.json({ error: 'No clock-in found for this employee today' }, { status: 400 })
  }
  if (existingRecord.clock_out_at) {
    return NextResponse.json({ error: 'This shift is already clocked out' }, { status: 400 })
  }

  const approvedHours = calculateClockHours(existingRecord.clock_in_at, nowIso)
  const { error } = await supabaseAdmin
    .from('shift_clocks')
    .update({
      clock_out_at: nowIso,
      clock_out_photo_path: photoPath,
      auto_clock_out: false,
      approval_status: 'approved',
      approved_hours: approvedHours,
      updated_at: nowIso,
    })
    .eq('id', existingRecord.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await upsertClockTaskCompletion(task_id, employee.id, session_date)
  return NextResponse.json({ success: true, employee, approved_hours: approvedHours })
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id, approved_hours, manager_note, action, clock_in_at, clock_out_at } = await req.json() as {
    id?: string
    approved_hours?: number | string | null
    manager_note?: string | null
    action?: 'approve' | 'adjust'
    clock_in_at?: string | null
    clock_out_at?: string | null
  }

  if (!id || !action) {
    return NextResponse.json({ error: 'Missing manager approval payload' }, { status: 400 })
  }

  const numericHours = typeof approved_hours === 'number'
    ? approved_hours
    : typeof approved_hours === 'string' && approved_hours.trim()
      ? Number(approved_hours)
      : null

  if (numericHours !== null && Number.isNaN(numericHours)) {
    return NextResponse.json({ error: 'Invalid approved hours' }, { status: 400 })
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('shift_clocks')
    .select('*')
    .eq('id', id)
    .single()

  if (existingError || !existing) {
    return NextResponse.json({ error: existingError?.message ?? 'Clock record not found' }, { status: 404 })
  }

  const nextClockInAt = clock_in_at?.trim() ? clock_in_at : existing.clock_in_at
  const nextClockOutAt = clock_out_at?.trim() ? clock_out_at : existing.clock_out_at

  if (!nextClockInAt) {
    return NextResponse.json({ error: 'Clock in time is required' }, { status: 400 })
  }
  if (nextClockOutAt && new Date(nextClockOutAt).getTime() <= new Date(nextClockInAt).getTime()) {
    return NextResponse.json({ error: 'Clock out must be after clock in' }, { status: 400 })
  }

  const fallbackHours = nextClockOutAt ? calculateClockHours(nextClockInAt, nextClockOutAt) : 0
  const update = {
    approval_status: 'approved',
    approved_hours: numericHours ?? fallbackHours,
    manager_note: manager_note?.trim() || null,
    clock_in_at: nextClockInAt,
    clock_out_at: nextClockOutAt,
    auto_clock_out: false,
    manager_approved_by: null,
    manager_approved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabaseAdmin.from('shift_clocks').update(update).eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
