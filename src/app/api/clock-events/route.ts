import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyPin } from '@/lib/pin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isValidPin } from '@/lib/validation'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'
import { CLOCK_PHOTO_BUCKET, calculateClockHours, calculateClockHoursAfterBreak, dataUrlToArrayBuffer, getClockBreakMinutes, getMealBreakState, getSessionCutoffIso, getUnpaidBreakState, setMealBreakManagerNote, setUnpaidBreakManagerNote } from '@/lib/clockUtils'
import { ShiftClock } from '@/lib/types'

export const runtime = 'nodejs'

let clockPhotoBucketReady = false

async function requireAdmin() {
  const cookieStore = await cookies()
  return isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)
}

function isMissingPinCodeColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? ''
  return message.includes('pin_code') || message.includes('schema cache')
}

async function verifyEmployeeByPin(pin: string) {
  const directResult = await supabaseAdmin
    .from('employees')
    .select('id, name, role, pin_hash, pin_code')
    .eq('is_active', true)
    .eq('pin_code', pin)
    .maybeSingle()

  if (directResult.data) return directResult.data
  if (directResult.error && !isMissingPinCodeColumn(directResult.error)) {
    throw new Error(directResult.error.message)
  }

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
  if (clockPhotoBucketReady) return
  const { data } = await supabaseAdmin.storage.getBucket(CLOCK_PHOTO_BUCKET)
  if (data) {
    clockPhotoBucketReady = true
    return
  }
  await supabaseAdmin.storage.createBucket(CLOCK_PHOTO_BUCKET, {
    public: false,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/heic', 'image/webp'],
    fileSizeLimit: 10 * 1024 * 1024,
  })
  clockPhotoBucketReady = true
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

const MEAL_BREAK_MINUTES = 30

function getClockStatus(record: ShiftClock | null) {
  if (!record?.clock_in_at) {
    return {
      state: 'clocked_out',
      can_clock_in: true,
      can_clock_out: false,
      can_start_break: false,
      can_end_break: false,
      break_used: false,
    }
  }

  const breakState = getMealBreakState(record)
  const unpaidBreakState = getUnpaidBreakState(record)
  const onMealBreak = Boolean(breakState.startedAt && !breakState.endedAt)
  const onUnpaidBreak = Boolean(unpaidBreakState.startedAt && !unpaidBreakState.endedAt)
  const onBreak = onMealBreak || onUnpaidBreak
  const breakUsed = Boolean(breakState.startedAt && breakState.endedAt)
  const unpaidBreakUsed = Boolean(unpaidBreakState.startedAt && unpaidBreakState.endedAt)

  return {
    state: onBreak ? 'on_break' : 'clocked_in',
    break_type: onMealBreak ? 'meal' : onUnpaidBreak ? 'unpaid' : null,
    can_clock_in: false,
    can_clock_out: !onBreak,
    can_start_break: !onBreak && !breakUsed,
    can_end_break: onMealBreak,
    can_start_unpaid_break: !onBreak && !unpaidBreakUsed,
    can_end_unpaid_break: onUnpaidBreak,
    break_used: breakUsed,
    unpaid_break_used: unpaidBreakUsed,
    clock_in_at: record.clock_in_at,
    break_started_at: breakState.startedAt,
    break_ended_at: breakState.endedAt,
    break_minutes: breakState.minutes,
    unpaid_break_started_at: unpaidBreakState.startedAt,
    unpaid_break_ended_at: unpaidBreakState.endedAt,
    unpaid_break_minutes: unpaidBreakState.minutes,
  }
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

async function getOpenClockRecord(employeeId: string, sessionDate: string) {
  const { data, error } = await supabaseAdmin
    .from('shift_clocks')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('session_date', sessionDate)
    .is('clock_out_at', null)
    .order('clock_in_at', { ascending: false })
    .limit(1)

  if (error) throw new Error(error.message)
  return ((data ?? [])[0] ?? null) as ShiftClock | null
}

async function getClockRecordById(id: string) {
  const { data, error } = await supabaseAdmin
    .from('shift_clocks')
    .select('*, employee:employees!shift_clocks_employee_id_fkey(*)')
    .eq('id', id)
    .single()

  if (error) throw new Error(error.message)
  return data as ShiftClock
}

async function createManualClockRecord(payload: {
  employee_id?: string
  session_date?: string
  clock_in_at?: string | null
  clock_out_at?: string | null
  manager_note?: string | null
}) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { employee_id, session_date, clock_in_at, clock_out_at, manager_note } = payload
  if (!employee_id || !session_date || !clock_in_at || !clock_out_at) {
    return NextResponse.json({ error: 'Employee, date, clock in, and clock out are required' }, { status: 400 })
  }
  if (!isValidSessionDate(session_date)) {
    return NextResponse.json({ error: 'Invalid session_date format' }, { status: 400 })
  }
  if (new Date(clock_out_at).getTime() <= new Date(clock_in_at).getTime()) {
    return NextResponse.json({ error: 'Clock out must be after clock in' }, { status: 400 })
  }

  const { data: employee, error: employeeError } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('id', employee_id)
    .eq('is_active', true)
    .single()

  if (employeeError || !employee) {
    return NextResponse.json({ error: employeeError?.message ?? 'Employee not found' }, { status: 404 })
  }

  const nowIso = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('shift_clocks')
    .insert({
      session_date,
      employee_id,
      clock_in_at,
      clock_out_at,
      clock_in_photo_path: '',
      clock_out_photo_path: null,
      auto_clock_out: false,
      approval_status: 'adjusted',
      approved_hours: calculateClockHours(clock_in_at, clock_out_at),
      manager_note: manager_note?.trim() || 'Manual hours added by manager.',
      manager_approved_by: null,
      manager_approved_at: nowIso,
      updated_at: nowIso,
    })
    .select('id')
    .single()

  if (error || !data?.id) {
    return NextResponse.json({ error: error?.message ?? 'Failed to add clock record' }, { status: 500 })
  }

  try {
    const record = await getClockRecordById(data.id)
    return NextResponse.json({ success: true, record })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to reload clock record' }, { status: 500 })
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
  const payload = await req.json() as {
    action?: 'clock_in' | 'clock_out' | 'manual_add' | 'start_break' | 'end_break' | 'toggle_break' | 'start_unpaid_break' | 'end_unpaid_break' | 'toggle_unpaid_break' | 'lookup_status'
    pin?: string
    session_date?: string
    employee_id?: string
    clock_in_at?: string | null
    clock_out_at?: string | null
    manager_note?: string | null
    photo_data_url?: string
    task_id?: string
    skip_photo?: boolean
  }
  const { action, pin, session_date, photo_data_url, task_id, skip_photo } = payload

  if (action === 'manual_add') {
    return createManualClockRecord(payload)
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

  if (action !== 'lookup_status') {
    await processOverdueClockRecords()
  }

  const employee = await verifyEmployeeByPin(pin)
  if (!employee) {
    return NextResponse.json({ error: 'Incorrect PIN' }, { status: 401 })
  }

  let existingRecord: ShiftClock | null = null
  try {
    existingRecord = await getOpenClockRecord(employee.id, session_date)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load clock record' }, { status: 500 })
  }

  if (action === 'lookup_status') {
    return NextResponse.json({ success: true, employee, status: getClockStatus(existingRecord) })
  }

  const nowIso = new Date().toISOString()
  const ext = photo_data_url ? getPhotoExtension(photo_data_url) : 'jpg'
  const photoPath = `${session_date}/${employee.id}/${action}-${Date.now()}.${ext}`
  const allowPhotoSkip = action === 'clock_in' && skip_photo === true && employee.role === 'manager'

  if (action === 'start_break' || action === 'end_break' || action === 'toggle_break' || action === 'start_unpaid_break' || action === 'end_unpaid_break' || action === 'toggle_unpaid_break') {
    if (!existingRecord?.clock_in_at) {
      return NextResponse.json({ error: 'No active clock-in found for this employee today' }, { status: 400 })
    }
    if (existingRecord.clock_out_at) {
      return NextResponse.json({ error: 'This shift is already clocked out' }, { status: 400 })
    }

    const breakState = getMealBreakState(existingRecord)
    const unpaidBreakState = getUnpaidBreakState(existingRecord)
    const onMealBreak = Boolean(breakState.startedAt && !breakState.endedAt)
    const onUnpaidBreak = Boolean(unpaidBreakState.startedAt && !unpaidBreakState.endedAt)

    if ((action === 'start_break' || action === 'toggle_break') && onUnpaidBreak) {
      return NextResponse.json({ error: 'End regular break before starting meal break' }, { status: 400 })
    }
    if ((action === 'start_unpaid_break' || action === 'toggle_unpaid_break') && onMealBreak) {
      return NextResponse.json({ error: 'End meal break before starting regular break' }, { status: 400 })
    }

    const isUnpaidBreakAction = action === 'start_unpaid_break' || action === 'end_unpaid_break' || action === 'toggle_unpaid_break'
    const selectedState = isUnpaidBreakAction ? unpaidBreakState : breakState
    const breakAction = action === 'toggle_break' || action === 'toggle_unpaid_break'
      ? selectedState.startedAt && !selectedState.endedAt
        ? (isUnpaidBreakAction ? 'end_unpaid_break' : 'end_break')
        : (isUnpaidBreakAction ? 'start_unpaid_break' : 'start_break')
      : action

    if (breakAction === 'start_break') {
      if (breakState.startedAt && !breakState.endedAt) {
        return NextResponse.json({ error: 'You are already on meal break' }, { status: 400 })
      }
      if (breakState.startedAt && breakState.endedAt) {
        return NextResponse.json({ error: 'Meal break has already been used for this shift' }, { status: 400 })
      }

      const { error } = await supabaseAdmin
        .from('shift_clocks')
        .update({
          manager_note: setMealBreakManagerNote(existingRecord.manager_note, { startedAt: nowIso, minutes: 0 }),
          updated_at: nowIso,
        })
        .eq('id', existingRecord.id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true, employee, break_action: 'start_break', break_started_at: nowIso })
    }

    if (breakAction === 'start_unpaid_break') {
      if (unpaidBreakState.startedAt && !unpaidBreakState.endedAt) {
        return NextResponse.json({ error: 'You are already on regular break' }, { status: 400 })
      }
      if (unpaidBreakState.startedAt && unpaidBreakState.endedAt) {
        return NextResponse.json({ error: 'Regular break has already been used for this shift' }, { status: 400 })
      }

      const { error } = await supabaseAdmin
        .from('shift_clocks')
        .update({
          manager_note: setUnpaidBreakManagerNote(existingRecord.manager_note, { startedAt: nowIso, minutes: 0 }),
          updated_at: nowIso,
        })
        .eq('id', existingRecord.id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true, employee, break_action: 'start_unpaid_break', unpaid_break_started_at: nowIso })
    }

    if (breakAction === 'end_unpaid_break') {
      if (!unpaidBreakState.startedAt || unpaidBreakState.endedAt) {
        return NextResponse.json({ error: 'No active regular break found' }, { status: 400 })
      }

      const elapsedMinutes = Math.floor((new Date(nowIso).getTime() - new Date(unpaidBreakState.startedAt).getTime()) / 60_000)
      const { error } = await supabaseAdmin
        .from('shift_clocks')
        .update({
          manager_note: setUnpaidBreakManagerNote(existingRecord.manager_note, {
            startedAt: unpaidBreakState.startedAt,
            endedAt: nowIso,
            minutes: elapsedMinutes,
          }),
          updated_at: nowIso,
        })
        .eq('id', existingRecord.id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true, employee, break_action: 'end_unpaid_break', unpaid_break_minutes: elapsedMinutes })
    }

    if (!breakState.startedAt || breakState.endedAt) {
      return NextResponse.json({ error: 'No active meal break found' }, { status: 400 })
    }

    const elapsedMinutes = Math.floor((new Date(nowIso).getTime() - new Date(breakState.startedAt).getTime()) / 60_000)
    if (elapsedMinutes < MEAL_BREAK_MINUTES) {
      const availableAt = new Date(new Date(breakState.startedAt).getTime() + MEAL_BREAK_MINUTES * 60_000).toISOString()
      return NextResponse.json({
        error: `Meal break must be at least ${MEAL_BREAK_MINUTES} minutes.`,
        available_at: availableAt,
      }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('shift_clocks')
      .update({
        manager_note: setMealBreakManagerNote(existingRecord.manager_note, {
          startedAt: breakState.startedAt,
          endedAt: nowIso,
          minutes: elapsedMinutes,
        }),
        updated_at: nowIso,
      })
      .eq('id', existingRecord.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true, employee, break_action: 'end_break', break_minutes: elapsedMinutes })
  }

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
  const mealBreakState = getMealBreakState(existingRecord)
  const unpaidBreakState = getUnpaidBreakState(existingRecord)
  if (mealBreakState.startedAt && !mealBreakState.endedAt) {
    return NextResponse.json({ error: 'End meal break before clocking out' }, { status: 400 })
  }
  if (unpaidBreakState.startedAt && !unpaidBreakState.endedAt) {
    return NextResponse.json({ error: 'End regular break before clocking out' }, { status: 400 })
  }

  const approvedHours = calculateClockHoursAfterBreak(existingRecord.clock_in_at, nowIso, getClockBreakMinutes(existingRecord))
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

  const { id, approved_hours, manager_note, clock_in_at, clock_out_at, session_date } = await req.json() as {
    id?: string
    approved_hours?: number | string | null
    manager_note?: string | null
    clock_in_at?: string | null
    clock_out_at?: string | null
    session_date?: string | null
  }

  if (!id) {
    return NextResponse.json({ error: 'Missing clock record id' }, { status: 400 })
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

  const nextSessionDate = session_date?.trim() ? session_date : existing.session_date
  const nextClockInAt = clock_in_at?.trim() ? clock_in_at : existing.clock_in_at
  const nextClockOutAt = clock_out_at?.trim() ? clock_out_at : existing.clock_out_at

  if (!isValidSessionDate(nextSessionDate)) {
    return NextResponse.json({ error: 'Invalid session_date format' }, { status: 400 })
  }
  if (!nextClockInAt) {
    return NextResponse.json({ error: 'Clock in time is required' }, { status: 400 })
  }
  if (nextClockOutAt && new Date(nextClockOutAt).getTime() <= new Date(nextClockInAt).getTime()) {
    return NextResponse.json({ error: 'Clock out must be after clock in' }, { status: 400 })
  }

  const fallbackHours = nextClockOutAt
    ? calculateClockHoursAfterBreak(nextClockInAt, nextClockOutAt, getClockBreakMinutes(existing as ShiftClock))
    : 0
  const update = {
    session_date: nextSessionDate,
    approval_status: 'approved',
    approved_hours: numericHours ?? fallbackHours,
    manager_note: setMealBreakManagerNote(manager_note?.trim() || null, getMealBreakState(existing as ShiftClock)) || null,
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

  try {
    const record = await getClockRecordById(id)
    return NextResponse.json({ success: true, record })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to reload clock record' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await req.json() as { id?: string }
  if (!id) {
    return NextResponse.json({ error: 'Missing clock record id' }, { status: 400 })
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('shift_clocks')
    .select('*')
    .eq('id', id)
    .single()

  if (existingError || !existing) {
    return NextResponse.json({ error: existingError?.message ?? 'Clock record not found' }, { status: 404 })
  }

  const { error } = await supabaseAdmin
    .from('shift_clocks')
    .delete()
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, session_date: existing.session_date })
}
