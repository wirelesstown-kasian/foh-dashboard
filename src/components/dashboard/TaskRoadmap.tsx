'use client'

import { DailySession, SessionPhase } from '@/lib/types'
import { CheckCircle2, Circle, Clock } from 'lucide-react'

interface Props {
  session: DailySession | null
  taskCounts: { pre_shift: [number, number]; operation: [number, number]; closing: [number, number] }
}

const PHASE_ORDER: SessionPhase[] = ['register_open', 'pre_shift', 'operation', 'closing', 'complete']

type StepDef =
  | { key: 'clock_in' | 'register_open' | 'eod'; label: string; type: 'simple' }
  | { key: 'pre_shift' | 'operation' | 'closing'; label: string; type: 'task' }

const STEPS: StepDef[] = [
  { key: 'clock_in',     label: 'Clock In',   type: 'simple' },
  { key: 'register_open', label: 'Register',  type: 'simple' },
  { key: 'pre_shift',    label: 'Pre-Shift',  type: 'task' },
  { key: 'operation',    label: 'Operations', type: 'task' },
  { key: 'closing',      label: 'Closing',    type: 'task' },
  { key: 'eod',          label: 'EOD',        type: 'simple' },
]

export function TaskRoadmap({ session, taskCounts }: Props) {
  const currentPhase = session?.current_phase ?? 'register_open'
  const currentIdx = PHASE_ORDER.indexOf(currentPhase)

  const isStepDone = (key: string): boolean => {
    if (key === 'clock_in') return true // always assumed done once we're on the dashboard
    if (key === 'eod') return false // separate page, never "done" from here
    const phaseIdx = PHASE_ORDER.indexOf(key as SessionPhase)
    if (phaseIdx < 0) return false
    return phaseIdx < currentIdx || currentPhase === 'complete'
  }

  const isStepActive = (key: string): boolean => {
    if (key === 'clock_in') return false
    if (key === 'eod') return currentPhase === 'complete'
    return key === currentPhase
  }

  return (
    <div className="flex items-center gap-1.5">
      {STEPS.map((step, idx) => {
        const done = isStepDone(step.key)
        const active = isStepActive(step.key)
        const taskCount = step.type === 'task' ? taskCounts[step.key as 'pre_shift' | 'operation' | 'closing'] : null

        return (
          <div key={step.key} className="flex items-center gap-1.5">
            <div className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs border ${
              done   ? 'bg-green-50 border-green-200 text-green-700' :
              active ? 'bg-amber-50 border-amber-300 text-amber-700 font-semibold' :
                       'bg-gray-50 border-gray-200 text-gray-400'
            }`}>
              {done   ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> :
               active ? <Clock className="w-3.5 h-3.5 shrink-0" /> :
                        <Circle className="w-3.5 h-3.5 shrink-0" />}
              <span>{step.label}</span>
              {taskCount && <span className="opacity-70">{taskCount[0]}/{taskCount[1]}</span>}
            </div>
            {idx < STEPS.length - 1 && (
              <div className={`h-px w-3 shrink-0 ${done ? 'bg-green-300' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
