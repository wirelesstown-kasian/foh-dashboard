import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getEffectiveClockHours, isClockPending } from '@/lib/clockUtils'
import { resetWageReportSheetInGoogleSheet, WageSheetRow } from '@/lib/eodGoogleSheet'
import { getRoleLabel } from '@/lib/organization'
import { getAppSettings } from '@/lib/appSettings'
import { calculateTips } from '@/lib/tipCalc'
import { isTipEligibleEmployee } from '@/lib/tipEligibility'
import type { Employee, EodReport, ShiftClock } from '@/lib/types'

type DailyTipPreview = { hours: number; tips: number }
type SavedDailyTip = { hours: number; tips: number }

function getSavedDailyTips(report: EodReport) {
  const savedTips = new Map<string, SavedDailyTip>()

  for (const distribution of report.tip_distributions ?? []) {
    const current = savedTips.get(distribution.employee_id) ?? { hours: 0, tips: 0 }
    savedTips.set(distribution.employee_id, {
      hours: current.hours + Number(distribution.hours_worked ?? 0),
      tips: current.tips + Number(distribution.net_tip ?? 0),
    })
  }

  return savedTips
}

function calculateDailyTipPreview({
  employees,
  clockRecords,
  report,
}: {
  employees: Employee[]
  clockRecords: ShiftClock[]
  report: EodReport
}) {
  const employeeById = new Map(employees.map(employee => [employee.id, employee]))
  const hoursByEmployee = new Map<string, number>()

  for (const record of clockRecords) {
    if (record.session_date !== report.session_date) continue
    const employee = employeeById.get(record.employee_id)
    if (!employee || !isTipEligibleEmployee(employee)) continue

    const hours = getEffectiveClockHours(record)
    if (hours <= 0) continue
    hoursByEmployee.set(record.employee_id, (hoursByEmployee.get(record.employee_id) ?? 0) + hours)
  }

  const tipEntries = [...hoursByEmployee.entries()].map(([employeeId, hours]) => {
    const employee = employeeById.get(employeeId)
    return {
      employee_id: employeeId,
      hours_worked: hours,
      tip_pool_hourly_rate: employee?.tip_pool_hourly_rate ?? null,
    }
  })
  const tipResults = calculateTips(Number(report.tip_total ?? 0), tipEntries)

  return new Map(
    tipResults.map(result => [result.employee_id, {
      hours: result.hours_worked,
      tips: result.net_tip,
    }])
  )
}

function shouldRecalculateTips(
  savedTips: Map<string, SavedDailyTip>,
  calculatedTips: Map<string, DailyTipPreview>
) {
  if (calculatedTips.size === 0) return false

  for (const [employeeId, calculated] of calculatedTips) {
    const saved = savedTips.get(employeeId)
    if (!saved) return true
    if (Math.abs(saved.hours - calculated.hours) > 0.01) return true
  }

  return false
}

export async function POST(req: NextRequest) {
  try {
    const { start_date, end_date, view } = await req.json() as {
      start_date?: string
      end_date?: string
      view?: 'earnings' | 'tips'
    }

    if (!start_date || !end_date) {
      return NextResponse.json({ error: 'Missing start_date or end_date' }, { status: 400 })
    }

    const [{ data: employees, error: employeesError }, { data: eodReports, error: eodError }, { data: clockRecords, error: clockError }, settings] = await Promise.all([
      supabaseAdmin.from('employees').select('*').eq('is_active', true),
      supabaseAdmin.from('eod_reports').select('*, tip_distributions(*)').gte('session_date', start_date).lte('session_date', end_date),
      supabaseAdmin.from('shift_clocks').select('*').gte('session_date', start_date).lte('session_date', end_date),
      getAppSettings(),
    ])

    if (employeesError) return NextResponse.json({ error: employeesError.message }, { status: 500 })
    if (eodError) return NextResponse.json({ error: eodError.message }, { status: 500 })
    if (clockError) return NextResponse.json({ error: clockError.message }, { status: 500 })

    const employeeRows = (employees ?? []) as Employee[]
    const clockRows = (clockRecords ?? []) as ShiftClock[]
    const reportRows = (eodReports ?? []) as EodReport[]

    const roleDefinitions = settings.role_definitions
    const reportByDate = new Map(reportRows.map(report => [report.session_date, report]))
    const savedTipsByDate = new Map(reportRows.map(report => [report.session_date, getSavedDailyTips(report)]))
    const calculatedTipsByDate = new Map(
      reportRows.map(report => [report.session_date, calculateDailyTipPreview({ employees: employeeRows, clockRecords: clockRows, report })])
    )

    const sheetRows: WageSheetRow[] = employeeRows.map(employee => {
      const employeeClockRows = clockRows.filter(record => record.employee_id === employee.id)
      const employeeDates = Array.from(new Set([
        ...employeeClockRows.map(record => record.session_date),
        ...reportRows
          .filter(report => savedTipsByDate.get(report.session_date)?.has(employee.id) || calculatedTipsByDate.get(report.session_date)?.has(employee.id))
          .map(report => report.session_date),
      ]))

      let hours = 0
      let tips = 0
      for (const date of employeeDates) {
        const report = reportByDate.get(date)
        const savedTips = savedTipsByDate.get(date) ?? new Map<string, SavedDailyTip>()
        const calculatedTips = calculatedTipsByDate.get(date) ?? new Map<string, DailyTipPreview>()
        const useCalculatedTips = report ? shouldRecalculateTips(savedTips, calculatedTips) : false
        const clockHours = employeeClockRows
          .filter(record => record.session_date === date)
          .reduce((sum, record) => sum + getEffectiveClockHours(record), 0)
        const dayHours = useCalculatedTips
          ? (clockHours > 0 ? clockHours : (calculatedTips.get(employee.id)?.hours ?? 0))
          : ((savedTips.get(employee.id)?.hours ?? 0) > 0 ? (savedTips.get(employee.id)?.hours ?? 0) : clockHours)
        const dayTips = report
          ? (useCalculatedTips ? (calculatedTips.get(employee.id)?.tips ?? 0) : (savedTips.get(employee.id)?.tips ?? 0))
          : 0

        hours += dayHours
        tips += dayTips
      }

      const baseWages = hours * Number(employee.hourly_wage ?? 0)
      const guaranteedTarget = hours * Number(employee.guaranteed_hourly ?? 0)
      const guaranteeTopUp = Math.max(0, guaranteedTarget - (baseWages + tips))
      const totalEarnings = baseWages + tips + guaranteeTopUp
      const tipRate = hours > 0 ? tips / hours : null
      const matchingClocks = employeeClockRows
      const status = matchingClocks.some(record => !record.clock_out_at || isClockPending(record))
        ? 'Clock Out Needed'
        : matchingClocks.some(record => record.auto_clock_out)
          ? 'Auto Clock-Out'
          : 'Verified'

      return {
        periodStart: start_date,
        periodEnd: end_date,
        view: view ?? 'earnings',
        employeeName: employee.name,
        role: getRoleLabel(employee.role, roleDefinitions),
        hours,
        tips,
        tipRate,
        tipCap: employee.tip_pool_hourly_rate,
        baseWages,
        guaranteeTopUp,
        totalEarnings,
        status,
        rowKey: `${start_date}:${end_date}:${view ?? 'earnings'}:${employee.id}`,
      }
    }).filter(row => row.hours > 0 || row.tips > 0 || row.baseWages > 0)

    const result = await resetWageReportSheetInGoogleSheet(sheetRows)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync wage report to Google Sheets' },
      { status: 500 }
    )
  }
}
