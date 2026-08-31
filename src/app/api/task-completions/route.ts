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

function isMissingPointsColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? ''
  return message.includes('points_awarded') || message.includes('points')
}

function getTaskPoints(task: { points?: unknown } | null | undefined) {
  const points = Number(task?.points ?? 0)
  return Number.isFinite(points) ? Math.max(0, Math.round(points)) : 0
}

async function updateTaskCompletion(
  id: string,
  payload: Record<string, unknown>,
) {
  let result = await supabaseAdmin.from('task_completions').update(payload).eq('id', id)
  if (result.error && isMissingPointsColumn(result.error) && 'points_awarded' in payload) {
    const fallbackPayload = { ...payload }
    delete fallbackPayload.points_awarded
    result = await supabaseAdmin.from('task_completions').update(fallbackPayload).eq('id', id)
  }
  return result
}

async function insertTaskCompletion(payload: Record<string, unknown>) {
  let result = await supabaseAdmin.from('task_completions').insert(payload)
  if (result.error && isMissingPointsColumn(result.error) && 'points_awarded' in payload) {
    const fallbackPayload = { ...payload }
    delete fallbackPayload.points_awarded
    result = await supabaseAdmin.from('task_completions').insert(fallbackPayload)
  }
  return result
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

  let taskResult = await supabaseAdmin
    .from('tasks')
    .select('title, points')
    .eq('id', task_id)
    .single()
  if (taskResult.error && isMissingPointsColumn(taskResult.error)) {
    taskResult = await supabaseAdmin
      .from('tasks')
      .select('title')
      .eq('id', task_id)
      .single()
  }
  const { data: task, error: taskError } = taskResult

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
    const { error } = await updateTaskCompletion(existing.id, {
      employee_id: employeeId,
      status: status ?? 'complete',
      points_awarded: status === 'incomplete' ? 0 : getTaskPoints(task),
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await insertTaskCompletion({
      task_id,
      employee_id: employeeId,
      session_date,
      status: status ?? 'complete',
      points_awarded: status === 'incomplete' ? 0 : getTaskPoints(task),
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
      let completionTaskId = task_id
      if (!completionTaskId) {
        const { data: existingCompletion } = await supabaseAdmin
          .from('task_completions')
          .select('task_id')
          .eq('id', existingCompletionId)
          .maybeSingle()
        completionTaskId = existingCompletion?.task_id
      }
      const { data: task } = completionTaskId
        ? await supabaseAdmin.from('tasks').select('points').eq('id', completionTaskId).maybeSingle()
        : { data: null }
      const { error } = await updateTaskCompletion(existingCompletionId, {
        employee_id,
        status,
        completed_at: new Date().toISOString(),
        points_awarded: status === 'incomplete' ? 0 : getTaskPoints(task),
      })

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

    const { data: task } = await supabaseAdmin.from('tasks').select('points').eq('id', task_id).maybeSingle()
    let insertResult = await supabaseAdmin
      .from('task_completions')
      .insert({
        task_id,
        employee_id,
        session_date,
        status,
        completed_at: new Date().toISOString(),
        points_awarded: status === 'incomplete' ? 0 : getTaskPoints(task),
      })
      .select('id')
      .single()
    if (insertResult.error && isMissingPointsColumn(insertResult.error)) {
      insertResult = await supabaseAdmin
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
    }
    const { data: inserted, error } = insertResult

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
  const { error } = await updateTaskCompletion(completion_id, payload)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
