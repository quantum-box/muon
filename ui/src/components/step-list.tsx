import { cn } from '../lib/utils'
import { StepStatusDot } from './status-badge'
import type { StepDefinition, StepStatus } from '../lib/types'

interface StepListProps {
  steps: StepDefinition[]
  statuses: StepStatus[]
  selectedIndex: number
  onSelect: (index: number) => void
}

export function StepList({ steps, statuses, selectedIndex, onSelect }: StepListProps) {
  return (
    <nav className="flex flex-col gap-0.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-3 mb-1">
        Steps
      </h3>
      {steps.map((step, i) => {
        const status = statuses[i] ?? 'pending'
        const isSelected = selectedIndex === i
        return (
          <button
            key={i}
            onClick={() => onSelect(i)}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 text-left rounded-md text-sm transition-colors',
              isSelected
                ? 'bg-slate-700/60 text-slate-100'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-300',
            )}
          >
            <StepStatusDot status={status} />
            <span className="text-[10px] text-slate-600 font-mono w-4 shrink-0">{i + 1}</span>
            <span className="truncate">{step.name}</span>
          </button>
        )
      })}
    </nav>
  )
}
