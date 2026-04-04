import { NextRequest, NextResponse } from 'next/server'
import { verifyPin } from '@/lib/pin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isValidPin } from '@/lib/validation'

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
    const { data: clockRecord, error: clockError } = await supabaseAdmin
      .from('shift_clocks')
      .select('clock_in_at, clock_out_at')
      .eq('employee_id', employeeId)
      .eq('session_date', session_date)
      .maybeSingle()

    if (clockError) {
      return NextResponse.json({ error: clockError.message }, { status: 500 })
    }
    if (!clockRecord?.clock_in_at) {
      return NextResponse.json({ error: 'Clock in with photo before using your PIN for tasks' }, { status: 403 })
    }
    if (title !== 'clock out' && clockRecord.clock_out_at) {
      return NextResponse.json({ error: 'You are already clocked out for this shift' }, { status: 403 })
    }
  }

  const { error } = await supabaseAdmin.from('task_completions').insert({
    task_id,
    employee_id: employeeId,
    session_date,
    status: status ?? 'complete',
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
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

  const { data: clockRecord } = await supabaseAdmin
    .from('shift_clocks')
    .select('clock_in_at, clock_out_at')
    .eq('employee_id', employeeId)
    .eq('session_date', completion.session_date)
    .maybeSingle()

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
  const { pin, completion_id, status } = await req.json()

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

  const { data: clockRecord } = await supabaseAdmin
    .from('shift_clocks')
    .select('clock_in_at, clock_out_at')
    .eq('employee_id', employeeId)
    .eq('session_date', completion.session_date)
    .maybeSingle()

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
