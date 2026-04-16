import { Employee, EodReport, ShiftClock, TaskCompletion, TipDistribution } from '@/lib/types'
import { getEffectiveClockHours } from '@/lib/clockUtils'
import { formatCurrency, getPercent } from '@/lib/reporting'

export interface EmployeeMonthPerformance {
  emp: Employee
  tasks: number
  hours: number
  totalTips: number
  taskCompletionRate: number   // avg daily share: my tasks / total tasks that day, across days worked
  taskRate: number             // tasks per hour
  tipRate: number              // tips per hour
  taskCompletionRateRank: number
  taskRateRank: number
  tipRateRank: number
  score: number
}

export interface PerformanceRow {
  emp: Employee
  done: number
  monthly?: EmployeeMonthPerformance
}

function getRankMap<T>(items: T[], getValue: (item: T) => number, getId: (item: T) => string) {
  const sorted = [...items].sort((a, b) => getValue(b) - getValue(a))
  return new Map(sorted.map((item, index) => [getId(item), index + 1]))
}

export function scoreFromRank(rank: number, count: number) {
  if (count <= 1) return 100
  return ((count - rank) / (count - 1)) * 100
}

interface BuildPerformanceRowsArgs {
  employees: Employee[]
  completions: TaskCompletion[]
  eodReports: (EodReport & { tip_distributions?: (TipDistribution & { employee?: Employee })[] })[]
  clockRecords: ShiftClock[]
  startDate: string
  endDate: string
  monthStart: string
  monthEnd: string
}

export function buildPerformanceRows({
  employees,
  completions,
  eodReports,
  clockRecords,
  startDate,
  endDate,
  monthStart,
  monthEnd,
}: BuildPerformanceRowsArgs) {
  const filteredEmployeeIds = new Set(employees.map(employee => employee.id))

  const filteredCompletions = completions.filter(
    completion =>
      completion.session_date >= startDate &&
      completion.session_date <= endDate &&
      filteredEmployeeIds.has(completion.employee_id) &&
      completion.status !== 'incomplete'
  )

  const monthCompletions = completions.filter(
    completion =>
      completion.session_date >= monthStart &&
      completion.session_date <= monthEnd &&
      filteredEmployeeIds.has(completion.employee_id) &&
      completion.status !== 'incomplete'
  )
  const monthEods = eodReports.filter(report => report.session_date >= monthStart && report.session_date <= monthEnd)
  const monthClockRecords = clockRecords.filter(
    record => record.session_date >= monthStart && record.session_date <= monthEnd && filteredEmployeeIds.has(record.employee_id)
  )

  const monthHoursByEmp = new Map<string, number>()
  const monthTipsByEmp = new Map<string, number>()
  const workingDatesByEmp = new Map<string, Set<string>>()

  for (const record of monthClockRecords) {
    monthHoursByEmp.set(record.employee_id, (monthHoursByEmp.get(record.employee_id) ?? 0) + getEffectiveClockHours(record))
    if (!workingDatesByEmp.has(record.employee_id)) workingDatesByEmp.set(record.employee_id, new Set())
    workingDatesByEmp.get(record.employee_id)!.add(record.session_date)
  }

  for (const eod of monthEods) {
    for (const distribution of eod.tip_distributions ?? []) {
      if (!filteredEmployeeIds.has(distribution.employee_id)) continue
      monthTipsByEmp.set(
        distribution.employee_id,
        (monthTipsByEmp.get(distribution.employee_id) ?? 0) + Number(distribution.net_tip)
      )
    }
  }

  // Build daily total task map: date → total tasks completed by all employees that day
  const dailyTotalTaskMap = new Map<string, number>()
  for (const completion of monthCompletions) {
    dailyTotalTaskMap.set(completion.session_date, (dailyTotalTaskMap.get(completion.session_date) ?? 0) + 1)
  }

  // Per employee: avg(my tasks that day / total tasks that day) across days worked
  function getTaskCompletionRate(empId: string): number {
    const workingDates = workingDatesByEmp.get(empId)
    if (!workingDates || workingDates.size === 0) return 0
    let total = 0
    for (const date of workingDates) {
      const myTasks = monthCompletions.filter(c => c.employee_id === empId && c.session_date === date).length
      const dayTotal = dailyTotalTaskMap.get(date) ?? 0
      total += dayTotal > 0 ? myTasks / dayTotal : 0
    }
    return total / workingDates.size
  }

  const baseStats = employees
    .map(emp => {
      const tasks = monthCompletions.filter(completion => completion.employee_id === emp.id).length
      const hours = monthHoursByEmp.get(emp.id) ?? 0
      const totalTips = monthTipsByEmp.get(emp.id) ?? 0
      const taskCompletionRate = getTaskCompletionRate(emp.id)
      return {
        emp,
        tasks,
        hours,
        totalTips,
        taskCompletionRate,
        taskRate: hours > 0 ? tasks / hours : 0,
        tipRate: hours > 0 ? totalTips / hours : 0,
      }
    })
    .filter(item => item.tasks > 0 || item.hours > 0 || item.totalTips > 0)

  const taskCompletionRateRankMap = getRankMap(
    baseStats.filter(item => (workingDatesByEmp.get(item.emp.id)?.size ?? 0) > 0),
    item => item.taskCompletionRate,
    item => item.emp.id,
  )
  const taskRateRankMap = getRankMap(baseStats.filter(item => item.hours > 0), item => item.taskRate, item => item.emp.id)
  const tipRateRankMap = getRankMap(baseStats.filter(item => item.hours > 0), item => item.tipRate, item => item.emp.id)

  const employeeMonthStats: EmployeeMonthPerformance[] = baseStats.map(item => {
    const taskCompletionRateRank = taskCompletionRateRankMap.get(item.emp.id) ?? 1
    const taskRateRank = taskRateRankMap.get(item.emp.id) ?? 1
    const tipRateRank = tipRateRankMap.get(item.emp.id) ?? 1
    return {
      ...item,
      taskCompletionRateRank,
      taskRateRank,
      tipRateRank,
      score: Math.round(
        scoreFromRank(taskCompletionRateRank, Math.max(taskCompletionRateRankMap.size, 1)) * 0.40 +
        scoreFromRank(taskRateRank, Math.max(taskRateRankMap.size, 1)) * 0.35 +
        scoreFromRank(tipRateRank, Math.max(tipRateRankMap.size, 1)) * 0.25
      ),
    }
  })

  const perfRows: PerformanceRow[] = employees
    .map(emp => {
      const done = filteredCompletions.filter(completion => completion.employee_id === emp.id).length
      const monthly = employeeMonthStats.find(item => item.emp.id === emp.id)
      return { emp, done, monthly }
    })
    .sort((a, b) => (b.monthly?.score ?? -1) - (a.monthly?.score ?? -1) || b.done - a.done)

  const totalTasks = perfRows.reduce((sum, row) => sum + row.done, 0)

  return { filteredCompletions, employeeMonthStats, perfRows, totalTasks }
}

interface BuildPerformanceReportHtmlArgs {
  employeeId: string
  perfRows: PerformanceRow[]
  employeeMonthStats: EmployeeMonthPerformance[]
  filteredCompletions: TaskCompletion[]
  totalTasks: number
  startDate: string
  endDate: string
  departmentLabel: string
}

export function buildPerformanceReportHtml({
  employeeId,
  perfRows,
  employeeMonthStats,
  filteredCompletions,
  totalTasks,
  startDate,
  endDate,
  departmentLabel,
}: BuildPerformanceReportHtmlArgs) {
  const row = perfRows.find(item => item.emp.id === employeeId)
  if (!row) return ''

  const overallRank = perfRows.findIndex(item => item.emp.id === employeeId) + 1
  const staffCount = perfRows.length
  const monthly = row.monthly
  const share = totalTasks > 0 ? getPercent((row.done / totalTasks) * 100) : '0.0%'

  const empCompletions = filteredCompletions.filter(completion => completion.employee_id === employeeId)
  const dailyMap = new Map<string, number>()
  for (const completion of empCompletions) {
    dailyMap.set(completion.session_date, (dailyMap.get(completion.session_date) ?? 0) + 1)
  }
  const dailyRows = Array.from(dailyMap.entries()).sort(([a], [b]) => b.localeCompare(a))
  const dayTotalMap = new Map<string, number>()
  for (const completion of filteredCompletions) {
    dayTotalMap.set(completion.session_date, (dayTotalMap.get(completion.session_date) ?? 0) + 1)
  }

  const rankCount = Math.max(employeeMonthStats.length, 1)
  const taskCompletionRateScore = monthly ? Math.round(scoreFromRank(monthly.taskCompletionRateRank, rankCount) * 0.40) : 0
  const taskRateScore = monthly ? Math.round(scoreFromRank(monthly.taskRateRank, rankCount) * 0.35) : 0
  const tipRateScore = monthly ? Math.round(scoreFromRank(monthly.tipRateRank, rankCount) * 0.25) : 0

  const leaderboardHtml = perfRows.map((perfRow, index) => {
    const isFocused = perfRow.emp.id === employeeId
    return `<tr style="${isFocused ? 'background:#fef3c7;font-weight:600;' : ''}">
      <td>${index + 1}</td>
      <td>${perfRow.emp.name}${isFocused ? ' ◀' : ''}</td>
      <td class="right">${perfRow.monthly?.score ?? '—'}</td>
      <td class="right">${perfRow.done}</td>
      <td class="right">${perfRow.monthly ? (perfRow.monthly.taskCompletionRate * 100).toFixed(1) + '%' : '—'}</td>
      <td class="right">${perfRow.monthly ? perfRow.monthly.taskRate.toFixed(2) : '—'}</td>
      <td class="right">${perfRow.monthly ? formatCurrency(perfRow.monthly.tipRate) : '—'}</td>
    </tr>`
  }).join('')

  const dailyHtml = dailyRows.length > 0
    ? dailyRows.map(([date, count]) => {
        const dayTotal = dayTotalMap.get(date) ?? 0
        const pct = dayTotal > 0 ? getPercent((count / dayTotal) * 100) : '—'
        return `<tr><td>${date}</td><td class="right">${count}</td><td class="right">${pct}</td></tr>`
      }).join('')
    : '<tr><td colspan="3" style="color:#6b7280">No tasks in period</td></tr>'

  return `
    <h1>${row.emp.name} Performance Report</h1>
    <p class="muted">${startDate === endDate ? startDate : `${startDate} - ${endDate}`}</p>
    <div class="summary">
      <div class="card"><strong>Overall Rank</strong><div class="metric">#${overallRank}</div><div class="muted">of ${staffCount}</div></div>
      <div class="card"><strong>Performance Score</strong><div class="metric">${monthly?.score ?? '—'}</div><div class="muted">Shift-adjusted KPI</div></div>
      <div class="card"><strong>Tasks This Period</strong><div class="metric">${row.done}</div><div class="muted">Share ${share}</div></div>
      <div class="card"><strong>Total Tips</strong><div class="metric">${monthly ? formatCurrency(monthly.totalTips) : '—'}</div><div class="muted">This month</div></div>
    </div>
    <p>
      ${row.emp.name} is ranked #${overallRank} of ${staffCount} in ${departmentLabel}.
      Avg task share per shift: ${monthly ? (monthly.taskCompletionRate * 100).toFixed(1) + '%' : '—'} —
      ${monthly ? monthly.taskRate.toFixed(2) : '0.00'} tasks/hr —
      ${monthly ? formatCurrency(monthly.tipRate) : '$0.00'} tips/hr.
    </p>
    <div class="report-grid">
      <div>
        <h3>KPI Breakdown</h3>
        <table class="compact-table">
          <thead><tr><th>KPI</th><th class="right">Weight</th><th class="right">Rank</th><th class="right">Component</th></tr></thead>
          <tbody>
            <tr><td>Task Completion Rate</td><td class="right">40%</td><td class="right">${monthly ? `#${monthly.taskCompletionRateRank}` : '—'}</td><td class="right">${taskCompletionRateScore}</td></tr>
            <tr><td>Tasks / Hr</td><td class="right">35%</td><td class="right">${monthly ? `#${monthly.taskRateRank}` : '—'}</td><td class="right">${taskRateScore}</td></tr>
            <tr><td>Tips / Hr</td><td class="right">25%</td><td class="right">${monthly ? `#${monthly.tipRateRank}` : '—'}</td><td class="right">${tipRateScore}</td></tr>
            <tr style="font-weight:700;border-top:2px solid #d1d5db"><td>Total Score</td><td></td><td></td><td class="right">${monthly?.score ?? '—'}</td></tr>
          </tbody>
        </table>
        <p style="font-size:11px;color:#6b7280;margin-top:6px">Task Completion Rate = avg daily share of tasks completed, across shifts worked. Fair for any schedule type.</p>
        <h3>Daily Activity</h3>
        <table class="compact-table">
          <thead><tr><th>Date</th><th class="right">Tasks</th><th class="right">Day Share</th></tr></thead>
          <tbody>${dailyHtml}</tbody>
        </table>
      </div>
      <div>
        <h3>Team Leaderboard</h3>
        <table class="compact-table">
          <thead><tr><th>#</th><th>Name</th><th class="right">Score</th><th class="right">Tasks</th><th class="right">Rate</th><th class="right">Tasks/Hr</th><th class="right">Tips/Hr</th></tr></thead>
          <tbody>${leaderboardHtml}</tbody>
        </table>
      </div>
    </div>
  `
}
