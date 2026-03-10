import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  History,
  Search,
  Trash2,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertCircle,
  X,
  Clock,
} from 'lucide-react'
import { cn, formatDuration, formatTimestamp } from '../lib/utils'
import { type RunHistoryItem, getRunHistory, clearRunHistory } from '../lib/tauri-api'

type StatusFilter = 'all' | 'passed' | 'failed' | 'error'

export function RunHistoryPage() {
  const navigate = useNavigate()
  const [history, setHistory] = useState<RunHistoryItem[]>(getRunHistory)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const filtered = useMemo(() => {
    let items = history
    if (statusFilter !== 'all') {
      items = items.filter((h) => h.status === statusFilter)
    }
    if (search) {
      const q = search.toLowerCase()
      items = items.filter((h) => h.scenario_name.toLowerCase().includes(q))
    }
    return items
  }, [history, search, statusFilter])

  function handleClear() {
    clearRunHistory()
    setHistory([])
    setShowClearConfirm(false)
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const statusIcon = {
    passed: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
    failed: <XCircle className="w-4 h-4 text-red-400" />,
    error: <AlertCircle className="w-4 h-4 text-amber-400" />,
  }

  const statusBg = {
    passed: 'bg-emerald-400/10 text-emerald-400',
    failed: 'bg-red-400/10 text-red-400',
    error: 'bg-amber-400/10 text-amber-400',
  }

  const statusFilters: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'passed', label: 'Passed' },
    { value: 'failed', label: 'Failed' },
    { value: 'error', label: 'Error' },
  ]

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-100 flex items-center gap-2">
            <History className="w-5 h-5 text-violet-400" />
            Run History
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {history.length} total runs
          </p>
        </div>
        {history.length > 0 && (
          <div>
            {showClearConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Clear all history?</span>
                <button
                  onClick={handleClear}
                  className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-500"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="px-2 py-1 text-xs border border-slate-700 text-slate-400 rounded hover:bg-slate-800"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 border border-slate-700/50 rounded-md hover:bg-slate-800/50 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear History
              </button>
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by scenario name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-slate-800/50 border border-slate-700/50 rounded-md text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500/50"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 bg-slate-800/50 border border-slate-700/50 rounded-md p-0.5">
          {statusFilters.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={cn(
                'px-2.5 py-1 text-xs rounded transition-colors',
                statusFilter === value
                  ? 'bg-slate-700 text-slate-200'
                  : 'text-slate-500 hover:text-slate-300',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <Clock className="w-12 h-12 text-slate-700 mx-auto mb-4" />
          <h3 className="text-sm font-medium text-slate-400 mb-1">
            {history.length === 0 ? 'No run history yet' : 'No matching runs'}
          </h3>
          <p className="text-xs text-slate-600">
            {history.length === 0
              ? 'Run a scenario to see results here'
              : 'Try adjusting your filters'}
          </p>
        </div>
      ) : (
        <div className="border border-slate-700/50 rounded-lg overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[auto_1fr_100px_80px_100px] gap-4 px-4 py-2.5 bg-slate-800/50 border-b border-slate-700/50 text-xs font-medium text-slate-500 uppercase tracking-wider">
            <div className="w-5" />
            <div>Scenario</div>
            <div>Status</div>
            <div>Duration</div>
            <div>Timestamp</div>
          </div>

          {/* Rows */}
          {filtered.map((entry) => (
            <div key={entry.id}>
              <div
                className="grid grid-cols-[auto_1fr_100px_80px_100px] gap-4 px-4 py-3 border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer items-center"
                onClick={() => toggleExpanded(entry.id)}
              >
                <div className="w-5 flex items-center justify-center text-slate-600">
                  {expanded.has(entry.id) ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </div>
                <div className="text-sm text-slate-200 truncate">
                  {entry.scenario_name}
                </div>
                <div className="flex items-center gap-1.5">
                  {statusIcon[entry.status]}
                  <span className={cn('text-xs px-1.5 py-0.5 rounded', statusBg[entry.status])}>
                    {entry.status}
                  </span>
                </div>
                <div className="text-xs text-slate-400 font-mono">
                  {formatDuration(entry.duration_ms)}
                </div>
                <div className="text-xs text-slate-500">
                  {formatTimestamp(entry.timestamp)}
                </div>
              </div>

              {/* Expanded detail */}
              {expanded.has(entry.id) && (
                <div className="px-4 py-3 bg-slate-800/20 border-b border-slate-800/50">
                  <div className="ml-9 space-y-2">
                    <div className="text-xs text-slate-400">
                      Steps: {entry.steps_passed}/{entry.step_count} passed
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            entry.status === 'passed' ? 'bg-emerald-400' : 'bg-red-400',
                          )}
                          style={{
                            width: `${entry.step_count > 0 ? (entry.steps_passed / entry.step_count) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <span className="text-xs text-slate-500">
                        {entry.step_count > 0
                          ? Math.round((entry.steps_passed / entry.step_count) * 100)
                          : 0}%
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(`/scenarios/${entry.scenario_id}`)
                      }}
                      className="text-xs text-violet-400 hover:text-violet-300"
                    >
                      View Scenario
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
