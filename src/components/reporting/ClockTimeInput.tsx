'use client'

import { Input } from '@/components/ui/input'
import { formatClockTime, getClockTimeOptions, timeInputToIso, type ClockTimeOccurrence } from '@/lib/clockUtils'

export function ClockTimeInput({ sessionDate, value, originalIso, occurrence, onChange, onOccurrenceChange, label, className }: {
  sessionDate: string
  value: string
  originalIso?: string | null
  occurrence?: ClockTimeOccurrence
  onChange: (value: string) => void
  onOccurrenceChange: (value: ClockTimeOccurrence) => void
  label: string
  className?: string
}) {
  const options = getClockTimeOptions(sessionDate, value)
  const selected = timeInputToIso(sessionDate, value, originalIso, occurrence)
  return (
    <div className="space-y-1">
      <Input type="time" aria-label={label} className={className} value={value} onChange={event => onChange(event.target.value)} />
      {options.length > 1 && (
        <select
          aria-label={`${label} daylight saving occurrence`}
          className="w-full rounded border bg-background px-2 py-1 text-xs"
          value={selected && Date.parse(selected) >= Date.parse(options[1]) ? 'later' : 'earlier'}
          onChange={event => onOccurrenceChange(event.target.value as ClockTimeOccurrence)}
        >
          <option value="earlier">{formatClockTime(options[0])} — first</option>
          <option value="later">{formatClockTime(options[1])} — second</option>
        </select>
      )}
      {value && options.length === 0 && <p role="alert" className="text-xs text-red-600">This Chicago time does not exist. Choose a valid time.</p>}
    </div>
  )
}
