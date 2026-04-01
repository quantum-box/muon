import { useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, Play, Loader2, AlertCircle, RotateCcw } from 'lucide-react'
import { useScenario } from '../hooks/use-scenarios'
import { useProject } from '../contexts/project-context'
import { useRun } from '../hooks/use-run'
import { StepList } from '../components/step-list'
import { StepViewer } from '../components/step-viewer'
import { ResponseViewer } from '../components/response-viewer'
import { SplitPane } from '../components/split-pane'
import { Timeline } from '../components/timeline'
import { StatusBadge } from '../components/status-badge'
import { cn, formatDuration } from '../lib/utils'

export function ScenarioDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { projectPath } = useProject()
  const { data: scenario, isLoading, error } = useScenario(id!, projectPath)
  const { state: runState, execute, reset } = useRun()
  const [selectedStep, setSelectedStep] = useState(0)

  const handleRun = useCallback(() => {
    if (!scenario) return
    reset()
    setSelectedStep(0)
    execute(scenario.id, scenario.scenario.steps.length)
  }, [scenario, execute, reset])

  // Auto-run if ?autorun=true
  useEffect(() => {
    if (searchParams.get('autorun') === 'true' && scenario && runState.status === 'idle') {
      setSearchParams({}, { replace: true })
      handleRun()
    }
  }, [scenario, searchParams, setSearchParams, runState.status, handleRun])

  // Auto-select running step
  useEffect(() => {
    if (runState.currentStepIndex != null) {
      setSelectedStep(runState.currentStepIndex)
    }
  }, [runState.currentStepIndex])

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
        <p className="text-xs text-slate-600 font-mono">{error?.message ?? 'Not found'}</p>
        <Link to="/" className="text-xs text-violet-400 hover:text-violet-300 mt-2">
          &larr; Back to scenarios
        </Link>
      </div>
    )
  }

  const steps = scenario.scenario.steps
  const isRunning = runState.status === 'running'
  const isCompleted = runState.status === 'completed'
  const isError = runState.status === 'error'
  const selectedStepDef = steps[selectedStep]
  const selectedResult = runState.stepResults[selectedStep] ?? null
  const hasResult = selectedResult != null

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Header bar */}
      <div className="border-b border-slate-700/50 bg-slate-800/30 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              to="/"
              className="text-slate-500 hover:text-slate-300 transition-colors shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-semibold text-slate-100 truncate">{scenario.name}</h1>
                {scenario.tags.map(tag => (
                  <span
                    key={tag}
                    className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-violet-500/10 text-violet-400 border border-violet-500/20 shrink-0"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              {scenario.description && (
                <p className="text-xs text-slate-500 truncate mt-0.5">{scenario.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {isCompleted && runState.result && (
              <div className="flex items-center gap-2">
                <StatusBadge
                  status={runState.result.success ? 'passed' : 'failed'}
                  size="sm"
                />
                <span className="text-xs text-slate-500 font-mono">
                  {formatDuration(runState.result.duration_ms)}
                </span>
              </div>
            )}
            {isError && (
              <span className="text-xs text-red-400">{runState.error}</span>
            )}
            {isCompleted || isError ? (
              <button
                onClick={handleRun}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Re-run
              </button>
            ) : (
              <button
                onClick={handleRun}
                disabled={isRunning}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                  isRunning
                    ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                    : 'bg-violet-600 hover:bg-violet-500 text-white shadow-sm shadow-violet-500/20',
                )}
              >
                {isRunning ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Play className="w-3 h-3" />
                )}
                {isRunning ? 'Running...' : 'Run'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - Step list */}
        <div className="w-56 border-r border-slate-700/50 overflow-y-auto py-3 shrink-0">
          <StepList
            steps={steps}
            statuses={runState.stepStatuses.length > 0 ? runState.stepStatuses : steps.map(() => 'pending')}
            selectedIndex={selectedStep}
            onSelect={setSelectedStep}
          />
        </div>

        {/* Right content - Step detail + Response viewer split */}
        <div className="flex-1 overflow-hidden">
          {selectedStepDef ? (
            hasResult ? (
              <SplitPane direction="vertical" defaultSize={50} minSize={25} maxSize={75}>
                <div className="h-full overflow-hidden">
                  <StepViewer
                    step={selectedStepDef}
                    result={selectedResult}
                    allSteps={steps}
                    variables={scenario.scenario.vars}
                    runtimeVars={runState.variables}
                  />
                </div>
                <div className="h-full overflow-hidden">
                  <ResponseViewer result={selectedResult} isStreaming={isRunning} />
                </div>
              </SplitPane>
            ) : (
              <div className="h-full overflow-hidden">
                <StepViewer
                  step={selectedStepDef}
                  result={null}
                  allSteps={steps}
                  variables={scenario.scenario.vars}
                  runtimeVars={runState.variables}
                />
              </div>
            )
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-slate-600">
              Select a step to view details
            </div>
          )}
        </div>
      </div>

      {/* Bottom timeline */}
      {(isRunning || isCompleted) && (
        <Timeline
          steps={steps}
          statuses={runState.stepStatuses}
          results={runState.stepResults}
          totalDuration={runState.result?.duration_ms ?? null}
        />
      )}
    </div>
  )
}
