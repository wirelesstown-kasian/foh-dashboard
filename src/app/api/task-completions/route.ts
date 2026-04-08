import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyPin } from '@/lib/pin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isValidPin } from '@/lib/validation'
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/adminSession'

async function requireAdmin() {
  const cookieStore = await cookies()
  return isValidAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)
}

async function getCompletionById(id: string) {
  const { data, error } = await supabaseAdmin
    .from('task_completions')
    .select('*, employee:employees(*)')
    .eq('id', id)
    .single()

  if (error) throw new Error(error.message)
  return data
}

async function getActiveClockRecord(employeeId: string, sessionDate: string) {
  const { data, error } = await supabaseAdmin
    .from('shift_clocks')
    .select('clock_in_at, clock_out_at')
    .eq('employee_id', employeeId)
    .eq('session_date', sessionDate)
    .is('clock_out_at', null)
    .order('clock_in_at', { ascending: false })
    .limit(1)

  if (error) throw new Error(error.message)
  return (data ?? [])[0] ?? null
}

export async function POST(req: NextRequest) {
  const { pin, task_id, session_date, status } = await req.json()

  if (!isValidPin(pin)) {
    return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 })
  }
  if (typeof task_id !== 'string' || typeof session_date !== 'string') {
    return NextResponse.json({ error: 'Missing task completion payload' }, { status: 400 })
  }
  if (status !== undefined && status !== 'complete' && status !== 'incomplete') {
    return NextResponse.json({ error: 'Invalid task completion status' }, { status: 400 })
  }

  const { data: employees, error: employeeError } = await supabaseAdmin
    .from('employees')
    .select('id, pin_hash')
    .eq('is_active', true)

  if (employeeError) {
    return NextResponse.json({ error: employeeError.message }, { status: 500 })
  }

  let employeeId: string | null = null
  for (const employee of employees ?? []) {
    if (await verifyPin(pin, employee.pin_hash)) {
      employeeId = employee.id
      break
    }
  }

  if (!employeeId) {
    return NextResponse.json({ error: 'Incorrect PIN' }, { status: 401 })
  }

  const { data: task, error: taskError } = await supabaseAdmin
    .from('tasks')
    .select('title')
    .eq('id', task_id)
    .single()

  if (taskError || !task) {
    return NextResponse.json({ error: taskError?.message ?? 'Task not found' }, { status: 404 })
  }

  const title = String(task.title).trim().toLowerCase()
  if (title !== 'clock in') {
    let clockRecord
    try {
      clockRecord = await getActiveClockRecord(employeeId, session_date)
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load clock record' }, { status: 500 })
    }
    if (!clockRecord?.clock_in_at) {
      return NextResponse.json({ error: 'Clock in with photo before using your PIN for tasks' }, { status: 403 })
    }
    if (title !== 'clock out' && clockRecord.clock_out_at) {
      return NextResponse.json({ error: 'You are already clocked out for this shift' }, { status: 403 })
    }
  }

  const { data: existing } = await supabaseAdmin
    .from('task_completions')
    .select('id')
    .eq('task_id', task_id)
    .eq('session_date', session_date)
    .maybeSingle()

  if (existing?.id) {
    const { error } = await supabaseAdmin
      .from('task_completions')
      .update({ employee_id: employeeId, status: status ?? 'complete' })
      .eq('id', existing.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await supabaseAdmin.from('task_completions').insert({
      task_id,
      employee_id: employeeId,
      session_date,
      status: status ?? 'complete',
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const { pin, completion_id } = await req.json()

  if (!isValidPin(pin)) {
    return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 })
  }
  if (typeof completion_id !== 'string') {
    return NextResponse.json({ error: 'Missing completion id' }, { status: 400 })
  }

  const { data: employees, error: employeeError } = await supabaseAdmin
    .from('employees')
    .select('id, pin_hash')
    .eq('is_active', true)

  if (employeeError) {
    return NextResponse.json({ error: employeeError.message }, { status: 500 })
  }

  let employeeId: string | null = null
  for (const employee of employees ?? []) {
    if (await verifyPin(pin, employee.pin_hash)) {
      employeeId = employee.id
      break
    }
  }

  if (!employeeId) {
    return NextResponse.json({ error: 'Incorrect PIN' }, { status: 401 })
  }

  const { data: completion, error: completionError } = await supabaseAdmin
    .from('task_completions')
    .select('task_id, session_date')
    .eq('id', completion_id)
    .single()

  if (completionError || !completion) {
    return NextResponse.json({ error: completionError?.message ?? 'Completion not found' }, { status: 404 })
  }

  let clockRecord
  try {
    clockRecord = await getActiveClockRecord(employeeId, completion.session_date)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load clock record' }, { status: 500 })
  }

  if (!clockRecord?.clock_in_at) {
    return NextResponse.json({ error: 'Clock in with photo before using your PIN for tasks' }, { status: 403 })
  }

  const { error } = await supabaseAdmin
    .from('task_completions')
    .delete()
    .eq('id', completion_id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function PATCH(req: NextRequest) {
  const { pin, completion_id, task_id, session_date, employee_id, status } = await req.json() as {
    pin?: string
    completion_id?: string
    task_id?: string
    session_date?: string
    employee_id?: string | null
    status?: 'complete' | 'incomplete' | 'open'
  }

  const isAdminRequest = !pin && await requireAdmin()

  if (isAdminRequest) {
    if (status !== 'complete' && status !== 'incomplete' && status !== 'open') {
      return NextResponse.json({ error: 'Invalid task completion status' }, { status: 400 })
    }
    if (!completion_id && !(typeof task_id === 'string' && typeof session_date === 'string')) {
      return NextResponse.json({ error: 'Missing task completion target' }, { status: 400 })
    }

    let existingCompletionId = completion_id

    if (!existingCompletionId && task_id && session_date) {
      const { data: existing } = await supabaseAdmin
        .from('task_completions')
        .select('id')
        .eq('task_id', task_id)
        .eq('session_date', session_date)
        .maybeSingle()
      existingCompletionId = existing?.id
    }

    if (status === 'open') {
      if (existingCompletionId) {
        const { error } = await supabaseAdmin.from('task_completions').delete().eq('id', existingCompletionId)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true, completion: null })
    }

    if (!employee_id) {
      return NextResponse.json({ error: 'Completed by is required' }, { status: 400 })
    }

    if (existingCompletionId) {
      const { error } = await supabaseAdmin
        .from('task_completions')
        .update({
          employee_id,
          status,
          completed_at: new Date().toISOString(),
        })
        .eq('id', existingCompletionId)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      try {
        const completion = await getCompletionById(existingCompletionId)
        return NextResponse.json({ success: true, completion })
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to reload completion' }, { status: 500 })
      }
    }

    if (!task_id || !session_date) {
      return NextResponse.json({ error: 'Missing task completion payload' }, { status: 400 })
    }

    const { data: inserted, error } = await supabaseAdmin
      .from('task_completions')
      .insert({
        task_id,
        employee_id,
        session_date,
        status,
        completed_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error || !inserted) {
      return NextResponse.json({ error: error?.message ?? 'Failed to create completion' }, { status: 500 })
    }

    try {
      const completion = await getCompletionById(inserted.id)
      return NextResponse.json({ success: true, completion })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to reload completion' }, { status: 500 })
    }
  }

  if (!isValidPin(pin)) {
    return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 })
  }
  if (typeof completion_id !== 'string') {
    return NextResponse.json({ error: 'Missing completion id' }, { status: 400 })
  }
  if (status !== undefined && status !== 'complete' && status !== 'incomplete') {
    return NextResponse.json({ error: 'Invalid task completion status' }, { status: 400 })
  }

  const { data: employees, error: employeeError } = await supabaseAdmin
    .from('employees')
    .select('id, pin_hash')
    .eq('is_active', true)

  if (employeeError) {
    return NextResponse.json({ error: employeeError.message }, { status: 500 })
  }

  let employeeId: string | null = null
  for (const employee of employees ?? []) {
    if (await verifyPin(pin, employee.pin_hash)) {
      employeeId = employee.id
      break
    }
  }

  if (!employeeId) {
    return NextResponse.json({ error: 'Incorrect PIN' }, { status: 401 })
  }

  const { data: completion, error: completionError } = await supabaseAdmin
    .from('task_completions')
    .select('task_id, session_date')
    .eq('id', completion_id)
    .single()

  if (completionError || !completion) {
    return NextResponse.json({ error: completionError?.message ?? 'Completion not found' }, { status: 404 })
  }

  let clockRecord
  try {
    clockRecord = await getActiveClockRecord(employeeId, completion.session_date)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load clock record' }, { status: 500 })
  }

  if (!clockRecord?.clock_in_at) {
    return NextResponse.json({ error: 'Clock in with photo before using your PIN for tasks' }, { status: 403 })
  }

  const payload = status ? { employee_id: employeeId, status } : { employee_id: employeeId }
  const { error } = await supabaseAdmin
    .from('task_completions')
    .update(payload)
    .eq('id', completion_id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
