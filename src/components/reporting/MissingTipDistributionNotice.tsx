import Link from 'next/link'
import type { EodReport } from '@/lib/types'

export function MissingTipDistributionNotice({ reports, startDate, endDate }: {
  reports: EodReport[]
  startDate: string
  endDate: string
}) {
  const dates = reports.filter(report => (
    report.session_date >= startDate && report.session_date <= endDate &&
    Number(report.tip_total ?? 0) > 0 && (report.tip_distributions?.length ?? 0) === 0
  )).map(report => report.session_date).sort()
  if (dates.length === 0) return null
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
      Employee tip distributions need review for {dates.join(', ')}. Clock-based tip amounts are estimates until reviewed and saved in{' '}
      <Link className="font-semibold underline" href="/payroll/tip-distribution-editor">Tip Distribution Editor</Link>.
    </div>
  )
}
