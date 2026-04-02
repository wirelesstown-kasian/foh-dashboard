import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { PlanningGrid } from '@/components/schedule-planning/PlanningGrid'

export default function SchedulePlanningPage() {
  return (
    <div className="p-6">
      <AdminSubpageHeader title="Schedule Planning" subtitle="Build, adjust, and publish the weekly schedule." />
      <PlanningGrid />
    </div>
  )
}
