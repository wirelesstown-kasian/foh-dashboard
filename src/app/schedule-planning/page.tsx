import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { PlanningGrid } from '@/components/schedule-planning/PlanningGrid'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default function SchedulePlanningPage() {
  return (
    <div className="p-6">
      <AdminSubpageHeader title="Schedule Planning" subtitle="Build, adjust, and publish the weekly schedule." />
      <Tabs defaultValue="foh">
        <TabsList className="mb-6 mt-3 grid w-full max-w-xl grid-cols-2 gap-2 bg-transparent p-0">
          <TabsTrigger value="foh" className="h-auto min-h-0 rounded-xl border bg-white px-4 py-3 text-left data-active:border-blue-500 data-active:bg-blue-50">
            <span className="flex flex-col items-start">
              <span className="text-sm font-semibold">FOH Planning</span>
              <span className="text-[11px] text-muted-foreground">Servers, bussers, runners, managers</span>
            </span>
          </TabsTrigger>
          <TabsTrigger value="boh" className="h-auto min-h-0 rounded-xl border bg-white px-4 py-3 text-left data-active:border-emerald-500 data-active:bg-emerald-50">
            <span className="flex flex-col items-start">
              <span className="text-sm font-semibold">BOH Planning</span>
              <span className="text-[11px] text-muted-foreground">Kitchen staff only</span>
            </span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="foh">
          <PlanningGrid department="foh" />
        </TabsContent>
        <TabsContent value="boh">
          <PlanningGrid department="boh" />
        </TabsContent>
      </Tabs>
    </div>
  )
}
