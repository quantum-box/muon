import { methodColor, formatJson, highlightJson } from '../lib/utils'
import type { StepRequest, StepResult } from '../lib/types'

interface RequestPanelProps {
  definition: StepRequest
  actual?: StepResult['request'] | null
}

export function RequestPanel({ definition, actual }: RequestPanelProps) {
  const method = actual?.method ?? definition.method
  const url = actual?.url ?? definition.url
  const headers = actual?.headers ?? definition.headers
  const body = actual?.body ?? definition.body

  return (
    <div className="space-y-4">
      {/* Method + URL */}
      <div className="flex items-center gap-2">
        <span className={`px-2 py-0.5 rounded text-xs font-bold font-mono ${methodColor(method)}`}>
          {method.toUpperCase()}
        </span>
        <code className="text-sm text-slate-300 font-mono break-all">{url}</code>
      </div>

      {/* Headers */}
      {Object.keys(headers).length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Headers</h4>
          <div className="bg-slate-900/50 border border-slate-700/50 rounded-md overflow-hidden">
            <table className="w-full text-xs font-mono">
              <tbody>
                {Object.entries(headers).map(([k, v]) => (
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

      {/* Query params */}
      {definition.query && Object.keys(definition.query).length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Query Parameters</h4>
          <div className="bg-slate-900/50 border border-slate-700/50 rounded-md overflow-hidden">
            <table className="w-full text-xs font-mono">
              <tbody>
                {Object.entries(definition.query).map(([k, v]) => (
                  <tr key={k} className="border-b border-slate-800 last:border-0">
                    <td className="px-3 py-1.5 text-amber-400 whitespace-nowrap">{k}</td>
                    <td className="px-3 py-1.5 text-slate-300 break-all">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Body */}
      {body != null && (
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Body</h4>
          <pre
            className="bg-slate-900/50 border border-slate-700/50 rounded-md p-3 text-xs font-mono overflow-x-auto leading-relaxed"
            dangerouslySetInnerHTML={{ __html: highlightJson(formatJson(body)) }}
          />
        </div>
      )}

      {/* Empty state */}
      {Object.keys(headers).length === 0 && !body && (!definition.query || Object.keys(definition.query).length === 0) && (
        <p className="text-xs text-slate-600 italic">No headers, query params, or body defined</p>
      )}
    </div>
  )
}
