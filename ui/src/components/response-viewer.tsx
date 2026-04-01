import { useState, useMemo } from 'react'
import { CheckCircle2, XCircle, Copy, Check } from 'lucide-react'
import { cn, statusColor, formatDuration, formatJson, highlightJson } from '../lib/utils'
import { JsonTreeView } from './json-tree-view'
import { SseStreamViewer } from './sse-stream-viewer'
import type { StepResult, ResponseViewerTab } from '../lib/types'

interface ResponseViewerProps {
  result: StepResult | null
  isStreaming?: boolean
}

export function ResponseViewer({ result, isStreaming = false }: ResponseViewerProps) {
  const [activeTab, setActiveTab] = useState<ResponseViewerTab>('pretty')
  const [copied, setCopied] = useState(false)

  const bodyStr = result?.response.body ?? ''

  const hasSseContent = useMemo(() => {
    return bodyStr.includes('event:') && bodyStr.includes('data:')
  }, [bodyStr])

  const parsedJson = useMemo(() => {
    if (!bodyStr) return null
    try { return JSON.parse(bodyStr) } catch { return null }
  }, [bodyStr])

  const tabs: { id: ResponseViewerTab; label: string; show: boolean }[] = [
    { id: 'pretty', label: 'Pretty', show: true },
    { id: 'tree', label: 'Tree', show: true },
    { id: 'raw', label: 'Raw', show: true },
    { id: 'headers', label: 'Headers', show: true },
    { id: 'tests', label: 'Tests', show: true },
    { id: 'sse', label: 'SSE', show: hasSseContent },
  ]

  const visibleTabs = tabs.filter(t => t.show)

  const bodyStr = result?.response.body ?? ''

  const parsedJson = useMemo(() => {
    try { return JSON.parse(bodyStr) } catch { return null }
  }, [bodyStr])

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2 p-8">
        <p className="text-sm">No response yet</p>
        <p className="text-xs">Run the scenario to see response data</p>
      </div>
    )
  }

  const formattedBody = formatJson(bodyStr)
  const bodySize = new Blob([bodyStr]).size

  function handleCopy() {
    navigator.clipboard.writeText(formattedBody)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Status bar */}
      <div className="border-b border-slate-700/50 px-4 py-2.5 flex items-center gap-3 shrink-0">
        <span
          className={cn(
            'px-2.5 py-1 rounded text-xs font-bold font-mono',
            statusColor(result.response.status),
          )}
        >
          {result.response.status}
        </span>
        <span className="text-xs text-slate-500 font-mono">
          {formatDuration(result.duration_ms)}
        </span>
        <span className="text-xs text-slate-600 font-mono">
          {bodySize > 1024 ? `${(bodySize / 1024).toFixed(1)} KB` : `${bodySize} B`}
        </span>
        {result.success ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 ml-auto" />
        ) : (
          <XCircle className="w-3.5 h-3.5 text-red-400 ml-auto" />
        )}
        {result.error && (
          <span className="text-xs text-red-400 bg-red-500/10 px-2 py-0.5 rounded">
            {result.error}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-700/50 flex px-4 shrink-0">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-3 py-2 text-xs font-medium transition-colors relative',
              activeTab === tab.id
                ? 'text-violet-400'
                : 'text-slate-500 hover:text-slate-300',
            )}
          >
            {tab.label}
            {tab.id === 'sse' && isStreaming && (
              <span className="ml-1 w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse-dot" />
            )}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'pretty' && (
          <div className="relative p-4">
            <button
              onClick={handleCopy}
              className="absolute top-6 right-6 p-1.5 rounded bg-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors z-10"
              title="Copy response"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <pre
              className="bg-slate-900/50 border border-slate-700/50 rounded-md p-3 text-xs font-mono overflow-x-auto leading-relaxed max-h-[calc(100vh-16rem)] overflow-y-auto"
              dangerouslySetInnerHTML={{ __html: highlightJson(formattedBody) }}
            />
          </div>
        )}

        {activeTab === 'tree' && (
          <div className="p-4">
            {parsedJson != null ? (
              <JsonTreeView data={parsedJson} defaultExpanded={3} />
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-slate-600 gap-1">
                <p className="text-sm">Not valid JSON</p>
                <p className="text-xs">Tree view requires a valid JSON response body</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'raw' && (
          <div className="relative p-4">
            <button
              onClick={handleCopy}
              className="absolute top-6 right-6 p-1.5 rounded bg-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors z-10"
              title="Copy response"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <pre className="bg-slate-900/50 border border-slate-700/50 rounded-md p-3 text-xs font-mono overflow-x-auto leading-relaxed max-h-[calc(100vh-16rem)] overflow-y-auto text-slate-300 whitespace-pre-wrap break-all">
              {bodyStr}
            </pre>
          </div>
        )}

        {activeTab === 'headers' && (
          <div className="p-4">
            {Object.keys(result.response.headers).length > 0 ? (
              <div className="bg-slate-900/50 border border-slate-700/50 rounded-md overflow-hidden">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="border-b border-slate-700/50">
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-1/3">
                        Name
                      </th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(result.response.headers).map(([k, v]) => (
                      <tr key={k} className="border-b border-slate-800 last:border-0 hover:bg-slate-800/30">
                        <td className="px-3 py-2 text-violet-400 whitespace-nowrap font-medium">
                          {k}
                        </td>
                        <td className="px-3 py-2 text-slate-300 break-all">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-slate-600">No response headers</p>
            )}
          </div>
        )}

        {activeTab === 'tests' && (
          <div className="p-4 space-y-2">
            {result.success ? (
              <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-md">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-xs text-emerald-300">All assertions passed</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-md">
                <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span className="text-xs text-red-300">
                  {result.error ?? 'One or more assertions failed'}
                </span>
              </div>
            )}
            <div className="mt-3">
              <div className="flex items-center gap-2 p-2.5 bg-slate-800/50 border border-slate-700/50 rounded-md">
                <span className={cn(
                  'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold',
                  result.success ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400',
                )}>
                  {result.success ? '✓' : '✗'}
                </span>
                <span className="text-xs text-slate-300 font-mono">
                  Status == {result.response.status}
                </span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'sse' && (
          <SseStreamViewer body={bodyStr} isStreaming={isStreaming} />
        )}
      </div>
    </div>
  )
}
