'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ReportPeriod, getReportLabel, shiftReportDate } from '@/lib/reporting'

interface ReportingToolbarProps {
  period: ReportPeriod
  refDate: Date
  customStart: string
  customEnd: string
  onPeriodChange: (period: ReportPeriod) => void
  onRefDateChange: (date: Date) => void
  onCustomStartChange: (value: string) => void
  onCustomEndChange: (value: string) => void
  leftSlot?: React.ReactNode
  rightSlot?: React.ReactNode
}

export function ReportingToolbar({
  period,
  refDate,
  customStart,
  customEnd,
  onPeriodChange,
  onRefDateChange,
  onCustomStartChange,
  onCustomEndChange,
  leftSlot,
  rightSlot,
}: ReportingToolbarProps) {
  const goToToday = () => {
    onPeriodChange('daily')
    onRefDateChange(new Date())
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {leftSlot}
      <Button variant="outline" size="sm" onClick={goToToday}>Today</Button>
      <Select value={period} onValueChange={(value: string | null) => value && onPeriodChange(value as ReportPeriod)}>
        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="daily">Daily</SelectItem>
          <SelectItem value="weekly">Weekly</SelectItem>
          <SelectItem value="monthly">Monthly</SelectItem>
          <SelectItem value="custom">Custom</SelectItem>
        </SelectContent>
      </Select>

      {period === 'custom' ? (
        <div className="flex items-center gap-2">
          <Input type="date" value={customStart} onChange={event => onCustomStartChange(event.target.value)} className="h-9 w-40" />
          <span className="text-sm text-muted-foreground">to</span>
          <Input type="date" value={customEnd} onChange={event => onCustomEndChange(event.target.value)} className="h-9 w-40" />
        </div>
      ) : (
        <>
          <Button variant="outline" size="sm" onClick={() => onRefDateChange(shiftReportDate(period, refDate, 'prev'))}>←</Button>
          <span className="min-w-56 text-center text-sm font-medium">{getReportLabel(period, refDate, customStart, customEnd)}</span>
          <Button variant="outline" size="sm" onClick={() => onRefDateChange(shiftReportDate(period, refDate, 'next'))}>→</Button>
        </>
      )}

      {rightSlot && <div className="ml-auto flex flex-wrap items-center gap-2">{rightSlot}</div>}
    </div>
  )
}
