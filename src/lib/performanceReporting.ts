import { Employee, EodReport, ShiftClock, TaskCompletion, TipDistribution } from '@/lib/types'
import { getEffectiveClockHours } from '@/lib/clockUtils'
import { formatCurrency, getPercent } from '@/lib/reporting'

export interface EmployeeMonthPerformance {
  emp: Employee
  tasks: number
  hours: number
  totalTips: number
  taskRate: number
  tipRate: number
  taskRank: number
  taskRateRank: number
  tipRateRank: number
  hoursRank: number
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

  for (const record of monthClockRecords) {
    monthHoursByEmp.set(record.employee_id, (monthHoursByEmp.get(record.employee_id) ?? 0) + getEffectiveClockHours(record))
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

  const baseStats = employees
    .map(emp => {
      const tasks = monthCompletions.filter(completion => completion.employee_id === emp.id).length
      const hours = monthHoursByEmp.get(emp.id) ?? 0
      const totalTips = monthTipsByEmp.get(emp.id) ?? 0
      return {
        emp,
        tasks,
        hours,
        totalTips,
        taskRate: hours > 0 ? tasks / hours : 0,
        tipRate: hours > 0 ? totalTips / hours : 0,
      }
    })
    .filter(item => item.tasks > 0 || item.hours > 0 || item.totalTips > 0)

  const taskRankMap = getRankMap(baseStats, item => item.tasks, item => item.emp.id)
  const taskRateRankMap = getRankMap(baseStats.filter(item => item.hours > 0), item => item.taskRate, item => item.emp.id)
  const tipRateRankMap = getRankMap(baseStats.filter(item => item.hours > 0), item => item.tipRate, item => item.emp.id)
  const hoursRankMap = getRankMap(baseStats, item => item.hours, item => item.emp.id)

  const employeeMonthStats: EmployeeMonthPerformance[] = baseStats.map(item => {
    const taskRank = taskRankMap.get(item.emp.id) ?? 1
    const taskRateRank = taskRateRankMap.get(item.emp.id) ?? 1
    const tipRateRank = tipRateRankMap.get(item.emp.id) ?? 1
    const hoursRank = hoursRankMap.get(item.emp.id) ?? 1
    return {
      ...item,
      taskRank,
      taskRateRank,
      tipRateRank,
      hoursRank,
      score: Math.round(
        scoreFromRank(taskRank, Math.max(taskRankMap.size, 1)) * 0.3 +
        scoreFromRank(taskRateRank, Math.max(taskRateRankMap.size, 1)) * 0.3 +
        scoreFromRank(tipRateRank, Math.max(tipRateRankMap.size, 1)) * 0.25 +
        scoreFromRank(hoursRank, Math.max(hoursRankMap.size, 1)) * 0.15
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
  const taskScore = monthly ? Math.round(scoreFromRank(monthly.taskRank, rankCount) * 0.3) : 0
  const taskRateScore = monthly ? Math.round(scoreFromRank(monthly.taskRateRank, rankCount) * 0.3) : 0
  const tipRateScore = monthly ? Math.round(scoreFromRank(monthly.tipRateRank, rankCount) * 0.25) : 0
  const hoursScore = monthly ? Math.round(scoreFromRank(monthly.hoursRank, rankCount) * 0.15) : 0

  const leaderboardHtml = perfRows.map((perfRow, index) => {
    const isFocused = perfRow.emp.id === employeeId
    return `<tr style="${isFocused ? 'background:#fef3c7;font-weight:600;' : ''}">
      <td>${index + 1}</td>
      <td>${perfRow.emp.name}${isFocused ? ' ◀' : ''}</td>
      <td class="right">${perfRow.monthly?.score ?? '—'}</td>
      <td class="right">${perfRow.done}</td>
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
      <div class="card"><strong>Performance Score</strong><div class="metric">${monthly?.score ?? '—'}</div><div class="muted">Monthly weighted KPI</div></div>
      <div class="card"><strong>Tasks This Period</strong><div class="metric">${row.done}</div><div class="muted">Share ${share}</div></div>
      <div class="card"><strong>Total Tips</strong><div class="metric">${monthly ? formatCurrency(monthly.totalTips) : '—'}</div><div class="muted">This month</div></div>
    </div>
    <p>
      ${row.emp.name} is ranked #${overallRank} of ${staffCount} in ${departmentLabel}.
      Monthly pace: ${monthly ? monthly.taskRate.toFixed(2) : '0.00'} tasks/hr — ${monthly?.hours.toFixed(2) ?? '0.00'} hrs worked — ${monthly ? formatCurrency(monthly.tipRate) : '$0.00'} tips/hr.
    </p>
    <div class="report-grid">
      <div>
        <h3>KPI Breakdown</h3>
        <table class="compact-table">
          <thead><tr><th>KPI</th><th class="right">Weight</th><th class="right">Rank</th><th class="right">Component</th></tr></thead>
          <tbody>
            <tr><td>Completed Tasks</td><td class="right">30%</td><td class="right">${monthly ? `#${monthly.taskRank}` : '—'}</td><td class="right">${taskScore}</td></tr>
            <tr><td>Tasks / Hr</td><td class="right">30%</td><td class="right">${monthly ? `#${monthly.taskRateRank}` : '—'}</td><td class="right">${taskRateScore}</td></tr>
            <tr><td>Tips / Hr</td><td class="right">25%</td><td class="right">${monthly ? `#${monthly.tipRateRank}` : '—'}</td><td class="right">${tipRateScore}</td></tr>
            <tr><td>Hours Worked</td><td class="right">15%</td><td class="right">${monthly ? `#${monthly.hoursRank}` : '—'}</td><td class="right">${hoursScore}</td></tr>
            <tr style="font-weight:700;border-top:2px solid #d1d5db"><td>Total Score</td><td></td><td></td><td class="right">${monthly?.score ?? '—'}</td></tr>
          </tbody>
        </table>
        <h3>Daily Activity</h3>
        <table class="compact-table">
          <thead><tr><th>Date</th><th class="right">Tasks</th><th class="right">Day Share</th></tr></thead>
          <tbody>${dailyHtml}</tbody>
        </table>
      </div>
      <div>
        <h3>Team Leaderboard</h3>
        <table class="compact-table">
          <thead><tr><th>#</th><th>Name</th><th class="right">Score</th><th class="right">Tasks</th><th class="right">Tasks/Hr</th><th class="right">Tips/Hr</th></tr></thead>
          <tbody>${leaderboardHtml}</tbody>
        </table>
      </div>
    </div>
  `
}
