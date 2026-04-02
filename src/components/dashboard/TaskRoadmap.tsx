'use client'

import { DailySession, SessionPhase } from '@/lib/types'
import { CheckCircle2, Circle, Clock } from 'lucide-react'

interface Props {
  session: DailySession | null
  taskCounts: { pre_shift: [number, number]; operation: [number, number]; closing: [number, number] }
}

type ActivePhase = 'pre_shift' | 'operation' | 'closing'
const PHASES: { key: ActivePhase; label: string }[] = [
  { key: 'pre_shift', label: 'Pre-Shift' },
  { key: 'operation', label: 'Operations' },
  { key: 'closing', label: 'Closing' },
]

export function TaskRoadmap({ session, taskCounts }: Props) {
  const currentPhase = session?.current_phase ?? 'pre_shift'
  const phaseOrder: SessionPhase[] = ['pre_shift', 'operation', 'closing', 'complete']
  const currentIdx = phaseOrder.indexOf(currentPhase)

  return (
    <div className="flex items-center gap-2">
      {PHASES.map((p, idx) => {
        const [done, total] = taskCounts[p.key]
        const isActive = p.key === currentPhase
        const isDone = idx < currentIdx || currentPhase === 'complete'
        return (
          <div key={p.key} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm border ${
              isDone ? 'bg-green-50 border-green-200 text-green-700' :
              isActive ? 'bg-amber-50 border-amber-300 text-amber-700' :
              'bg-gray-50 border-gray-200 text-gray-400'
            }`}>
              {isDone ? <CheckCircle2 className="w-4 h-4" /> : isActive ? <Clock className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
              <span className="font-medium">{p.label}</span>
              <span className="text-xs">{done}/{total}</span>
            </div>
            {idx < PHASES.length - 1 && (
              <div className={`h-px w-4 ${isDone ? 'bg-green-300' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
