import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { calculateLegacyFohPayroll } from '@/lib/legacyDashboardPayroll'
import type { DailyTipReport } from '@/lib/dailyTips'
import type { HistoricalPayroll } from '@/lib/historicalDashboardTotals'
import type { Employee, Schedule, ShiftClock } from '@/lib/types'

// A range on every source prevents PostgREST's row limit from silently
// truncating older clocks, schedules, or tip distributions.
export async function readAllLegacyRows<T>(query: (from: number, to: number) => PromiseLike<{
  data: unknown[] | null; error: { message: string } | null
}>) {
  const rows: T[] = []
  const pageSize = 500
  for (let from = 0; ; from += pageSize) {
    const result = await query(from, from + pageSize - 1)
    if (result.error) throw new Error(result.error.message)
    const page = (result.data ?? []) as T[]
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

export async function loadLegacyDashboardPayroll(imports: HistoricalPayroll[]) {
  // Match Wage Report's completed worksheet rollout boundary. No newer
  // unsaved earnings or imported Kitchen/Owner amounts are inferred as legacy FOH pay.
  const { data: runs, error } = await supabaseAdmin.from('payroll_runs')
    .select('start_date, payroll_run_items!inner(id)')
    .lte('pay_date', new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()))
    .order('start_date').limit(1)
  if (error) throw new Error(error.message)
  const cutoff = runs?.[0]?.start_date as string | undefined
  if (!cutoff) return []
  const [employees, clocks, schedules, reports, tips] = await Promise.all([
    readAllLegacyRows<Employee>((from, to) => supabaseAdmin.from('employees')
      .select('id,name,role,primary_department,schedule_departments,hourly_wage,guaranteed_hourly,tip_pool_hourly_rate,tip_eligible,is_active')
      .order('id').range(from, to)),
    readAllLegacyRows<ShiftClock>((from, to) => supabaseAdmin.from('shift_clocks')
      .select('id,employee_id,session_date,clock_in_at,clock_out_at,approval_status,approved_hours,manager_note,break_minutes,break_started_at,break_ended_at,unpaid_break_minutes,unpaid_break_started_at,unpaid_break_ended_at')
      .lt('session_date', cutoff).order('id').range(from, to)),
    readAllLegacyRows<Schedule>((from, to) => supabaseAdmin.from('schedules')
      .select('id,employee_id,date,start_time,end_time,department')
      .lt('date', cutoff).order('id').range(from, to)),
    readAllLegacyRows<DailyTipReport & { id: string }>((from, to) => supabaseAdmin.from('eod_reports')
      .select('id,session_date,tip_total').lt('session_date', cutoff).order('id').range(from, to)),
    readAllLegacyRows<{ eod_report_id: string; employee_id: string; hours_worked: number; net_tip: number }>((from, to) => supabaseAdmin.from('tip_distributions')
      .select('eod_report_id,employee_id,hours_worked,net_tip,eod_reports!inner(session_date)')
      .lt('eod_reports.session_date', cutoff).order('id').range(from, to)),
  ])
  const tipsByReport = new Map<string, typeof tips>()
  for (const tip of tips) tipsByReport.set(tip.eod_report_id, [...(tipsByReport.get(tip.eod_report_id) ?? []), tip])
  return calculateLegacyFohPayroll({ employees, clocks, schedules, cutoff, imports,
    reports: reports.map(report => ({ ...report, tip_distributions: tipsByReport.get(report.id) ?? [] })) })
}
