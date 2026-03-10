import { Link } from 'react-router-dom'
import { Play, FileText, Clock } from 'lucide-react'
import { StatusBadge } from './status-badge'
import { formatDuration, formatTimestamp, cn } from '../lib/utils'
import type { ScenarioSummary } from '../lib/types'

interface ScenarioCardProps {
  scenario: ScenarioSummary
  onRun: (id: string) => void
  isRunning: boolean
}

export function ScenarioCard({ scenario, onRun, isRunning }: ScenarioCardProps) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg hover:border-slate-600/50 transition-colors group">
      <div className="p-4 flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <Link
              to={`/scenarios/${scenario.id}`}
              className="text-sm font-semibold text-slate-100 hover:text-violet-400 transition-colors truncate"
            >
              {scenario.name}
            </Link>
            {scenario.tags.map(tag => (
              <span
                key={tag}
                className="px-1.5 py-0.5 text-[10px] font-mono font-medium rounded bg-violet-500/10 text-violet-400 border border-violet-500/20"
              >
                {tag}
              </span>
            ))}
          </div>
          {scenario.description && (
            <p className="text-xs text-slate-400 mb-2 line-clamp-1">{scenario.description}</p>
          )}
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <FileText className="w-3 h-3" />
              {scenario.step_count} step{scenario.step_count !== 1 ? 's' : ''}
            </span>
            {scenario.last_run && (
              <>
                <StatusBadge
                  status={scenario.last_run.success ? 'passed' : 'failed'}
                  size="sm"
                />
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDuration(scenario.last_run.duration_ms)}
                </span>
                <span className="text-slate-600">{formatTimestamp(scenario.last_run.timestamp)}</span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={(e) => { e.preventDefault(); onRun(scenario.id) }}
          disabled={isRunning}
          className={cn(
            'shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
            isRunning
              ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
              : 'bg-violet-600 hover:bg-violet-500 text-white shadow-sm shadow-violet-500/20',
          )}
        >
          <Play className="w-3 h-3" />
          {isRunning ? 'Running...' : 'Run'}
        </button>
      </div>
    </div>
  )
}
