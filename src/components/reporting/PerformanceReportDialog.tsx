'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { exportReportToPdf } from '@/lib/reportExport'
import { formatCurrency, getPercent } from '@/lib/reporting'
import { EmployeeMonthPerformance, PerformanceRow, scoreFromRank } from '@/lib/performanceReporting'
import { TaskCompletion } from '@/lib/types'
import { getRoleLabel } from '@/lib/organization'
import { RoleDefinition } from '@/lib/appSettings'
import { Trophy } from 'lucide-react'

interface PerformanceReportDialogProps {
  detailTarget: PerformanceRow | null
  perfRows: PerformanceRow[]
  employeeMonthStats: EmployeeMonthPerformance[]
  filteredCompletions: TaskCompletion[]
  totalTasks: number
  roleDefinitions: RoleDefinition[]
  buildReportHtml: (employeeId: string) => string
  emailingEmployeeId: string | null
  onClose: () => void
  onEmailReport: (employeeId: string) => void | Promise<void>
}

export function PerformanceReportDialog({
  detailTarget,
  perfRows,
  employeeMonthStats,
  filteredCompletions,
  totalTasks,
  roleDefinitions,
  buildReportHtml,
  emailingEmployeeId,
  onClose,
  onEmailReport,
}: PerformanceReportDialogProps) {
  return (
    <Dialog open={!!detailTarget} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="w-[80vw] max-w-none sm:max-w-none max-h-[60vh] overflow-y-auto p-7">
        <DialogHeader>
          <DialogTitle>{detailTarget?.emp.name} Performance Report</DialogTitle>
        </DialogHeader>
        {detailTarget && (
          <div className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[1.45fr_0.95fr]">
              <div className="rounded-2xl border bg-gradient-to-br from-amber-50 via-white to-sky-50 p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Performance Summary</div>
                <div className="mt-3 flex flex-wrap items-end gap-6">
                  <div>
                    <div className="text-sm text-muted-foreground">Performance Score</div>
                    <div className="text-5xl font-bold text-slate-950">{detailTarget.monthly?.score ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Overall Rank</div>
                    <div className="text-2xl font-semibold text-slate-900">
                      #{perfRows.findIndex(item => item.emp.id === detailTarget.emp.id) + 1}
                      <span className="ml-2 text-sm font-medium text-muted-foreground">of {perfRows.length}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border bg-amber-50 p-3">
                    <div className="text-xs text-amber-700 font-medium">Task Completion Rate</div>
                    <div className="mt-1 text-xl font-bold text-amber-900">{detailTarget.monthly ? (detailTarget.monthly.taskCompletionRate * 100).toFixed(1) + '%' : '—'}</div>
                    <div className="text-[10px] text-amber-700 mt-0.5">Avg daily share of tasks completed</div>
                  </div>
                  <div className="rounded-xl border bg-white p-3">
                    <div className="text-xs text-muted-foreground">Tasks / Hr</div>
                    <div className="mt-1 text-xl font-semibold">{detailTarget.monthly ? detailTarget.monthly.taskRate.toFixed(2) : '—'}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">Efficiency per hour worked</div>
                  </div>
                  <div className="rounded-xl border bg-white p-3">
                    <div className="text-xs text-muted-foreground">Tips / Hr</div>
                    <div className="mt-1 text-xl font-semibold">{detailTarget.monthly ? formatCurrency(detailTarget.monthly.tipRate) : '—'}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">Customer service proxy</div>
                  </div>
                  <div className="rounded-xl border bg-white p-3">
                    <div className="text-xs text-muted-foreground">Total Tips</div>
                    <div className="mt-1 text-xl font-semibold">{detailTarget.monthly ? formatCurrency(detailTarget.monthly.totalTips) : '—'}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">This month</div>
                  </div>
                  <div className="rounded-xl border bg-white p-3">
                    <div className="text-xs text-muted-foreground">Tasks This Period</div>
                    <div className="mt-1 text-xl font-semibold">{detailTarget.done}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">Share {totalTasks > 0 ? getPercent((detailTarget.done / totalTasks) * 100) : '0.0%'}</div>
                  </div>
                  <div className="rounded-xl border bg-white p-3">
                    <div className="text-xs text-muted-foreground">Hours Worked</div>
                    <div className="mt-1 text-xl font-semibold">{detailTarget.monthly?.hours.toFixed(1) ?? '0.0'} hrs</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">This month</div>
                  </div>
                  <div className="rounded-xl border bg-white p-3">
                    <div className="text-xs text-muted-foreground">Monthly Tasks</div>
                    <div className="mt-1 text-xl font-semibold">{detailTarget.monthly?.tasks ?? 0}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">Total completed</div>
                  </div>
                  <div className="rounded-xl border bg-white p-3">
                    <div className="text-xs text-muted-foreground">Role</div>
                    <div className="mt-1 text-xl font-semibold">{getRoleLabel(detailTarget.emp.role, roleDefinitions)}</div>
                  </div>
                </div>
                <div className="mt-5 rounded-2xl border border-amber-200 bg-white/90 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">How Score Is Calculated</div>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    Score = <strong>Task Completion Rate (40%)</strong> + <strong>Tasks/Hr (35%)</strong> + <strong>Tips/Hr (25%)</strong>.
                    Each KPI is ranked relative to the team — #1 gets 100 pts, last gets 0. Scores are shift-adjusted so part-time and full-time staff compete on equal footing.
                    {detailTarget.monthly && (
                      <> {detailTarget.emp.name} is ranked #{perfRows.findIndex(item => item.emp.id === detailTarget.emp.id) + 1} of {perfRows.length} overall,
                      with a {(detailTarget.monthly.taskCompletionRate * 100).toFixed(1)}% avg task completion rate across shifts worked.</>
                    )}
                  </p>
                </div>
              </div>
              <div className="rounded-2xl border bg-white p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">KPI Ranking</div>
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3">
                    <span className="text-sm font-medium">Overall Rank</span>
                    <span className="text-sm font-semibold">#{perfRows.findIndex(item => item.emp.id === detailTarget.emp.id) + 1}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                    <span className="text-sm font-medium">Task Completion Rate Rank</span>
                    <span className="text-sm font-semibold">#{detailTarget.monthly?.taskCompletionRateRank ?? '—'}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                    <span className="text-sm font-medium">Tasks / Hr Rank</span>
                    <span className="text-sm font-semibold">#{detailTarget.monthly?.taskRateRank ?? '—'}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                    <span className="text-sm font-medium">Tips / Hr Rank</span>
                    <span className="text-sm font-semibold">#{detailTarget.monthly?.tipRateRank ?? '—'}</span>
                  </div>
                </div>
              </div>
            </div>

            {detailTarget.monthly && (() => {
              const monthly = detailTarget.monthly
              const rankCount = Math.max(employeeMonthStats.length, 1)
              const rows = [
                { label: 'Task Completion Rate', weight: '40%', rank: monthly.taskCompletionRateRank, score: Math.round(scoreFromRank(monthly.taskCompletionRateRank, rankCount) * 0.40) },
                { label: 'Tasks / Hr', weight: '35%', rank: monthly.taskRateRank, score: Math.round(scoreFromRank(monthly.taskRateRank, rankCount) * 0.35) },
                { label: 'Tips / Hr', weight: '25%', rank: monthly.tipRateRank, score: Math.round(scoreFromRank(monthly.tipRateRank, rankCount) * 0.25) },
              ]
              return (
                <div className="rounded-2xl border bg-white p-5">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Score Breakdown</div>
                  <p className="mt-1 text-xs text-muted-foreground">Each KPI ranked within team → converted to 0–100 → weighted sum</p>
                  <Table className="mt-3">
                    <TableHeader>
                      <TableRow>
                        <TableHead>KPI</TableHead>
                        <TableHead className="text-right">Weight</TableHead>
                        <TableHead className="text-right">Rank</TableHead>
                        <TableHead className="text-right">Component Score</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map(row => (
                        <TableRow key={row.label}>
                          <TableCell>{row.label}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{row.weight}</TableCell>
                          <TableCell className="text-right">#{row.rank}</TableCell>
                          <TableCell className="text-right font-semibold">{row.score}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2 font-bold">
                        <TableCell colSpan={3}>Total Score</TableCell>
                        <TableCell className="text-right text-amber-700">{monthly.score}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )
            })()}

            <div className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-2xl border bg-white p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Daily Activity — This Period</div>
                {(() => {
                  const empCompletions = filteredCompletions.filter(completion => completion.employee_id === detailTarget.emp.id)
                  const dailyMap = new Map<string, number>()
                  for (const completion of empCompletions) dailyMap.set(completion.session_date, (dailyMap.get(completion.session_date) ?? 0) + 1)
                  const dayTotalMap = new Map<string, number>()
                  for (const completion of filteredCompletions) dayTotalMap.set(completion.session_date, (dayTotalMap.get(completion.session_date) ?? 0) + 1)
                  const dailyRows = Array.from(dailyMap.entries()).sort(([a], [b]) => b.localeCompare(a))
                  if (dailyRows.length === 0) return <p className="mt-3 text-sm text-muted-foreground">No tasks in selected period.</p>
                  return (
                    <Table className="mt-3">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead className="text-right">Tasks</TableHead>
                          <TableHead className="text-right">Day Share</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dailyRows.map(([date, count]) => {
                          const dayTotal = dayTotalMap.get(date) ?? 0
                          return (
                            <TableRow key={date}>
                              <TableCell>{date}</TableCell>
                              <TableCell className="text-right font-semibold">{count}</TableCell>
                              <TableCell className="text-right text-muted-foreground">{dayTotal > 0 ? getPercent((count / dayTotal) * 100) : '—'}</TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  )
                })()}
              </div>

              <div className="rounded-2xl border bg-white p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Team Leaderboard</div>
                <Table className="mt-3">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Tasks/Hr</TableHead>
                      <TableHead className="text-right">Tips/Hr</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {perfRows.map((row, index) => {
                      const isFocused = row.emp.id === detailTarget.emp.id
                      return (
                        <TableRow key={row.emp.id} className={isFocused ? 'bg-amber-50 font-semibold' : ''}>
                          <TableCell>{index === 0 ? <Trophy className="h-4 w-4 text-amber-500" /> : index + 1}</TableCell>
                          <TableCell>{row.emp.name}{isFocused ? ' ◀' : ''}</TableCell>
                          <TableCell className="text-right">{row.monthly?.score ?? '—'}</TableCell>
                          <TableCell className="text-right">{row.monthly ? (row.monthly.taskCompletionRate * 100).toFixed(0) + '%' : '—'}</TableCell>
                          <TableCell className="text-right">{row.monthly ? row.monthly.taskRate.toFixed(1) : '—'}</TableCell>
                          <TableCell className="text-right">{row.monthly ? formatCurrency(row.monthly.tipRate) : '—'}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => exportReportToPdf(`${detailTarget.emp.name} Performance Report`, buildReportHtml(detailTarget.emp.id))}>
                PDF Export
              </Button>
              <Button onClick={() => void onEmailReport(detailTarget.emp.id)} disabled={emailingEmployeeId === detailTarget.emp.id}>
                {emailingEmployeeId === detailTarget.emp.id ? 'Sending…' : 'Email Report'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
