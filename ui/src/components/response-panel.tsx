import { statusColor, formatDuration, formatJson, highlightJson } from '../lib/utils'
import type { StepResult } from '../lib/types'

interface ResponsePanelProps {
  result: StepResult | null
}

export function ResponsePanel({ result }: ResponsePanelProps) {
  if (!result) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-slate-600">
        Run the scenario to see response data
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Status + Duration */}
      <div className="flex items-center gap-3">
        <span className={`px-2 py-0.5 rounded text-xs font-bold font-mono ${statusColor(result.response.status)}`}>
          {result.response.status}
        </span>
        <span className="text-xs text-slate-500">{formatDuration(result.duration_ms)}</span>
        {result.error && (
          <span className="text-xs text-red-400 bg-red-500/10 px-2 py-0.5 rounded">{result.error}</span>
        )}
      </div>

      {/* Headers */}
      {Object.keys(result.response.headers).length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Response Headers</h4>
          <div className="bg-slate-900/50 border border-slate-700/50 rounded-md overflow-hidden">
            <table className="w-full text-xs font-mono">
              <tbody>
                {Object.entries(result.response.headers).map(([k, v]) => (
                  <tr key={k} className="border-b border-slate-800 last:border-0">
                    <td className="px-3 py-1.5 text-violet-400 whitespace-nowrap">{k}</td>
                    <td className="px-3 py-1.5 text-slate-300 break-all">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Body */}
      {result.response.body != null && (
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Response Body</h4>
          <pre
            className="bg-slate-900/50 border border-slate-700/50 rounded-md p-3 text-xs font-mono overflow-x-auto leading-relaxed max-h-[400px] overflow-y-auto"
            dangerouslySetInnerHTML={{ __html: highlightJson(formatJson(result.response.body)) }}
          />
        </div>
      )}
    </div>
  )
}
