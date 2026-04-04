import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { WeeklyScheduleGrid } from '@/components/schedule/WeeklyScheduleGrid'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default function SchedulePage() {
  return (
    <div className="p-6">
      <AdminSubpageHeader title="Schedule" subtitle="View weekly FOH and BOH schedules by department." />
      <Tabs defaultValue="foh">
        <TabsList className="mb-4">
          <TabsTrigger value="foh">FOH Schedule</TabsTrigger>
          <TabsTrigger value="boh">BOH Schedule</TabsTrigger>
        </TabsList>
        <TabsContent value="foh">
          <WeeklyScheduleGrid department="foh" />
        </TabsContent>
        <TabsContent value="boh">
          <WeeklyScheduleGrid department="boh" />
        </TabsContent>
      </Tabs>
    </div>
  )
}
