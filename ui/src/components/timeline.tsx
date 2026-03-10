import { cn, formatDuration } from '../lib/utils'
import type { StepResult, StepStatus } from '../lib/types'

interface TimelineProps {
  steps: { name: string }[]
  statuses: StepStatus[]
  results: (StepResult | null)[]
  totalDuration: number | null
}

export function Timeline({ steps, statuses, results, totalDuration }: TimelineProps) {
  const durations = results.map(r => r?.duration_ms ?? 0)
  const maxDuration = Math.max(...durations, 1)

  return (
    <div className="border-t border-slate-700/50 bg-slate-800/30 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Execution Timeline
        </h4>
        {totalDuration != null && (
          <span className="text-[10px] text-slate-500 font-mono">
            Total: {formatDuration(totalDuration)}
          </span>
        )}
      </div>
      <div className="flex gap-1 h-6">
        {steps.map((step, i) => {
          const status = statuses[i] ?? 'pending'
          const duration = durations[i] ?? 0
          const width = duration > 0
            ? Math.max((duration / maxDuration) * 100, 8)
            : statuses.some(s => s !== 'pending') ? 4 : 100 / steps.length

          return (
            <div
              key={i}
              className="relative group"
              style={{ width: `${width}%`, minWidth: '16px' }}
            >
              <div
                className={cn(
                  'h-full rounded-sm transition-colors',
                  status === 'passed' && 'bg-emerald-500/30',
                  status === 'failed' && 'bg-red-500/30',
                  status === 'running' && 'bg-blue-500/30 animate-pulse-dot',
                  status === 'pending' && 'bg-slate-700/30',
                )}
              />
              {/* Tooltip */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10">
                <div className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-300 whitespace-nowrap shadow-xl">
                  <span className="font-medium">{step.name}</span>
                  {duration > 0 && <span className="text-slate-500 ml-1">{formatDuration(duration)}</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
