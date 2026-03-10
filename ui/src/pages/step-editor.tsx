import { useState, useCallback, useMemo, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Save,
  Play,
  Loader2,
  AlertCircle,
  ChevronDown,
  GitBranch,
} from 'lucide-react'
import Editor from '@monaco-editor/react'
import { useScenario } from '../hooks/use-scenarios'
import { useRun } from '../hooks/use-run'
import { updateScenario } from '../lib/api'
import { KeyValueEditor } from '../components/key-value-editor'
import { ResponseViewer } from '../components/response-viewer'
import { cn, methodColor } from '../lib/utils'
import type {
  StepEditorTab,
  KeyValuePair,
  HttpMethod,
  StepDefinition,
  StepResult,
} from '../lib/types'
import { HTTP_METHODS, CONTENT_TYPES } from '../lib/types'

const TABS: { id: StepEditorTab; label: string }[] = [
  { id: 'params', label: 'Params' },
  { id: 'headers', label: 'Headers' },
  { id: 'body', label: 'Body' },
  { id: 'auth', label: 'Auth' },
  { id: 'tests', label: 'Tests' },
  { id: 'variables', label: 'Variables' },
]

export function StepEditorPage() {
  const { id } = useParams<{ id: string }>()
  const { data: scenario, isLoading, error, refetch } = useScenario(id!)
  const { state: runState, execute, reset } = useRun()

  const [selectedStepIdx, setSelectedStepIdx] = useState(0)
  const [activeTab, setActiveTab] = useState<StepEditorTab>('params')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showMethodDropdown, setShowMethodDropdown] = useState(false)

  // Editable step state
  const [method, setMethod] = useState<HttpMethod>('GET')
  const [url, setUrl] = useState('')
  const [queryParams, setQueryParams] = useState<KeyValuePair[]>([])
  const [headers, setHeaders] = useState<KeyValuePair[]>([])
  const [bodyContent, setBodyContent] = useState('')
  const [contentType, setContentType] = useState('application/json')
  const [testsContent, setTestsContent] = useState('')
  const [saveVars, setSaveVars] = useState<KeyValuePair[]>([])

  // Running state for SSE
  const [runResult, setRunResult] = useState<StepResult | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  const steps = useMemo(
    () => scenario?.scenario.steps ?? [],
    [scenario],
  )

  const loadStep = useCallback((step: StepDefinition) => {
    setMethod((step.request.method?.toUpperCase() ?? 'GET') as HttpMethod)
    setUrl(step.request.url ?? '')
    setQueryParams(
      Object.entries(step.request.query ?? {}).map(([key, value]) => ({
        key,
        value,
        enabled: true,
      })),
    )
    setHeaders(
      Object.entries(step.request.headers ?? {}).map(([key, value]) => ({
        key,
        value,
        enabled: true,
      })),
    )
    setBodyContent(
      step.request.body != null
        ? typeof step.request.body === 'string'
          ? step.request.body
          : JSON.stringify(step.request.body, null, 2)
        : '',
    )
    const expectJson = step.expect?.json
    const expectStatus = step.expect?.status
    const lines: string[] = []
    if (expectStatus) lines.push(`response.status == ${expectStatus}`)
    if (expectJson && typeof expectJson === 'object') {
      for (const [k, v] of Object.entries(expectJson as Record<string, unknown>)) {
        lines.push(`response.body.${k} == ${JSON.stringify(v)}`)
      }
    }
    setTestsContent(lines.join('\n'))
    setSaveVars(
      Object.entries(step.save ?? {}).map(([key, value]) => ({
        key,
        value,
        enabled: true,
      })),
    )
    setRunResult(null)
  }, [])

  // Load step when scenario or selection changes
  useEffect(() => {
    const step = steps[selectedStepIdx]
    if (step) loadStep(step)
  }, [steps, selectedStepIdx, loadStep])

  // Track run results
  useEffect(() => {
    const result = runState.stepResults[selectedStepIdx]
    if (result) setRunResult(result)
  }, [runState.stepResults, selectedStepIdx])

  const handleSave = useCallback(async () => {
    if (!scenario) return
    setSaving(true)
    setSaveError(null)
    try {
      const updatedSteps = steps.map((step, i) => {
        if (i !== selectedStepIdx) return step
        const enabledParams = queryParams.filter((p) => p.enabled && p.key)
        const enabledHeaders = headers.filter((h) => h.enabled && h.key)
        const enabledVars = saveVars.filter((v) => v.enabled && v.key)
        return {
          ...step,
          request: {
            method: method.toLowerCase(),
            url,
            query: Object.fromEntries(enabledParams.map((p) => [p.key, p.value])),
            headers: Object.fromEntries(enabledHeaders.map((h) => [h.key, h.value])),
            body: bodyContent ? JSON.parse(bodyContent) : undefined,
          },
          save: enabledVars.length > 0
            ? Object.fromEntries(enabledVars.map((v) => [v.key, v.value]))
            : undefined,
        }
      })
      await updateScenario(scenario.id, { steps: updatedSteps })
      await refetch()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [scenario, steps, selectedStepIdx, method, url, queryParams, headers, bodyContent, saveVars, refetch])

  const handleRun = useCallback(() => {
    if (!scenario) return
    reset()
    setRunResult(null)
    setIsRunning(true)
    execute(scenario.id, steps.length)
  }, [scenario, steps, execute, reset])

  // Track when run completes
  useEffect(() => {
    if (runState.status === 'completed' || runState.status === 'error') {
      setIsRunning(false)
    }
  }, [runState.status])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
      </div>
    )
  }

  if (error || !scenario) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-3">
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-sm text-slate-400">Failed to load scenario</p>
        <Link to="/" className="text-xs text-violet-400 hover:text-violet-300">
          &larr; Back to scenarios
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Top bar */}
      <div className="border-b border-slate-700/50 bg-slate-800/30 px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link to={`/scenarios/${id}`} className="text-slate-500 hover:text-slate-300 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="text-sm font-semibold text-slate-200 truncate">{scenario.name}</h1>
          <Link
            to={`/scenarios/${id}/flow`}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-violet-400 transition-colors"
          >
            <GitBranch className="w-3 h-3" />
            Flow
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {saveError && <span className="text-xs text-red-400">{saveError}</span>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save
          </button>
          <button
            onClick={handleRun}
            disabled={isRunning}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              isRunning
                ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                : 'bg-violet-600 hover:bg-violet-500 text-white',
            )}
          >
            {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            {isRunning ? 'Running...' : 'Run'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Step sidebar */}
        <div className="w-48 border-r border-slate-700/50 overflow-y-auto shrink-0">
          <div className="py-2">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
              Steps
            </div>
            {steps.map((step, i) => (
              <button
                key={i}
                onClick={() => setSelectedStepIdx(i)}
                className={cn(
                  'w-full text-left px-3 py-2 text-xs transition-colors',
                  i === selectedStepIdx
                    ? 'bg-violet-500/10 text-violet-300 border-r-2 border-violet-500'
                    : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/50',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn('text-[10px] font-bold font-mono px-1 py-0.5 rounded', methodColor(step.request.method))}>
                    {step.request.method?.toUpperCase().slice(0, 3)}
                  </span>
                  <span className="truncate">{step.name}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Editor area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Method + URL bar */}
          <div className="border-b border-slate-700/50 px-4 py-3 flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setShowMethodDropdown(!showMethodDropdown)}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-bold font-mono border border-slate-700/50',
                  methodColor(method),
                )}
              >
                {method}
                <ChevronDown className="w-3 h-3" />
              </button>
              {showMethodDropdown && (
                <div className="absolute top-full left-0 mt-1 z-20 bg-slate-800 border border-slate-700 rounded-md shadow-xl py-1 min-w-[120px]">
                  {HTTP_METHODS.map((m) => (
                    <button
                      key={m}
                      onClick={() => { setMethod(m); setShowMethodDropdown(false) }}
                      className={cn(
                        'w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-slate-700/50',
                        methodColor(m),
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com/endpoint"
              className="flex-1 bg-slate-800/50 border border-slate-700/50 rounded-md px-3 py-1.5 text-sm font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"
            />
          </div>

          {/* Tabs */}
          <div className="border-b border-slate-700/50 flex px-4 shrink-0">
            {TABS.map((tab) => (
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
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500" />
                )}
              </button>
            ))}
          </div>

          {/* Tab content + response split */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left: request editor */}
            <div className="flex-1 overflow-auto p-4 border-r border-slate-700/50">
              {activeTab === 'params' && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                    Query Parameters
                  </h3>
                  <KeyValueEditor
                    pairs={queryParams}
                    onChange={setQueryParams}
                    keyPlaceholder="Parameter"
                    valuePlaceholder="Value"
                  />
                </div>
              )}

              {activeTab === 'headers' && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                    Request Headers
                  </h3>
                  <KeyValueEditor
                    pairs={headers}
                    onChange={setHeaders}
                  />
                </div>
              )}

              {activeTab === 'body' && (
                <div className="h-full flex flex-col">
                  <div className="flex items-center gap-3 mb-3">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Request Body
                    </h3>
                    <select
                      value={contentType}
                      onChange={(e) => setContentType(e.target.value)}
                      className="bg-slate-800 border border-slate-700/50 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-violet-500/50"
                    >
                      {CONTENT_TYPES.map((ct) => (
                        <option key={ct} value={ct}>{ct}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 min-h-[200px] border border-slate-700/50 rounded-md overflow-hidden">
                    <Editor
                      height="100%"
                      language="json"
                      theme="vs-dark"
                      value={bodyContent}
                      onChange={(v) => setBodyContent(v ?? '')}
                      options={{
                        minimap: { enabled: false },
                        fontSize: 12,
                        lineNumbers: 'on',
                        scrollBeyondLastLine: false,
                        padding: { top: 8, bottom: 8 },
                        tabSize: 2,
                        wordWrap: 'on',
                      }}
                    />
                  </div>
                </div>
              )}

              {activeTab === 'auth' && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                    Authentication
                  </h3>
                  <p className="text-xs text-slate-500">
                    Add authentication headers in the Headers tab, or set auth tokens in environment variables.
                  </p>
                  <div className="mt-4 space-y-3">
                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-md p-3">
                      <p className="text-xs text-slate-400 mb-2">Bearer Token</p>
                      <input
                        type="text"
                        placeholder="Enter token or use {{env.TOKEN}}"
                        className="w-full bg-slate-900/50 border border-slate-700/50 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"
                        onChange={(e) => {
                          const token = e.target.value
                          if (token) {
                            const existing = headers.findIndex((h) => h.key.toLowerCase() === 'authorization')
                            if (existing >= 0) {
                              const updated = [...headers]
                              updated[existing] = { ...updated[existing]!, value: `Bearer ${token}` }
                              setHeaders(updated)
                            } else {
                              setHeaders([...headers, { key: 'Authorization', value: `Bearer ${token}`, enabled: true }])
                            }
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'tests' && (
                <div className="h-full flex flex-col">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                    Test Assertions (CEL expressions)
                  </h3>
                  <div className="flex-1 min-h-[200px] border border-slate-700/50 rounded-md overflow-hidden">
                    <Editor
                      height="100%"
                      language="plaintext"
                      theme="vs-dark"
                      value={testsContent}
                      onChange={(v) => setTestsContent(v ?? '')}
                      options={{
                        minimap: { enabled: false },
                        fontSize: 12,
                        lineNumbers: 'on',
                        scrollBeyondLastLine: false,
                        padding: { top: 8, bottom: 8 },
                        tabSize: 2,
                        wordWrap: 'on',
                      }}
                    />
                  </div>
                </div>
              )}

              {activeTab === 'variables' && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                    Save Variables (JSONPath)
                  </h3>
                  <p className="text-xs text-slate-600 mb-3">
                    Extract values from the response body using JSONPath expressions.
                  </p>
                  <KeyValueEditor
                    pairs={saveVars}
                    onChange={setSaveVars}
                    keyPlaceholder="Variable name"
                    valuePlaceholder="$.data.id"
                  />
                </div>
              )}
            </div>

            {/* Right: response viewer */}
            <div className="flex-1 overflow-auto">
              <ResponseViewer result={runResult} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
