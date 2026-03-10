import { useState, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Play,
  Loader2,
  AlertCircle,
  Eye,
  Code2,
  Pencil,
} from 'lucide-react'
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import Editor from '@monaco-editor/react'
import { useScenario } from '../hooks/use-scenarios'
import { useRun } from '../hooks/use-run'
import { StepNode, type StepNodeData } from '../components/step-node'
import { cn } from '../lib/utils'

type ViewMode = 'visual' | 'yaml'

const nodeTypes = { step: StepNode }

export function FlowEditorPage() {
  const { id } = useParams<{ id: string }>()
  const { data: scenario, isLoading, error } = useScenario(id!)
  const { state: runState, execute, reset } = useRun()
  const [viewMode, setViewMode] = useState<ViewMode>('visual')
  const [yamlContent, setYamlContent] = useState('')

  const steps = useMemo(
    () => scenario?.scenario.steps ?? [],
    [scenario],
  )

  // Generate nodes from steps
  const nodes: Node<StepNodeData>[] = useMemo(() => {
    return steps.map((step, i) => {
      let status: StepNodeData['status'] = 'pending'
      if (runState.stepStatuses[i]) {
        status = runState.stepStatuses[i]!
      }
      return {
        id: `step-${i}`,
        type: 'step',
        position: { x: 250, y: i * 140 },
        data: {
          label: step.name,
          method: step.request.method,
          url: step.request.url,
          status,
          index: i,
          saveVars: Object.keys(step.save ?? {}),
        },
      }
    })
  }, [steps, runState.stepStatuses])

  // Generate edges between sequential steps
  const edges: Edge[] = useMemo(() => {
    return steps.slice(0, -1).map((step, i) => {
      const sourceVars = Object.keys(step.save ?? {})
      const hasVarFlow = sourceVars.length > 0

      return {
        id: `edge-${i}-${i + 1}`,
        source: `step-${i}`,
        target: `step-${i + 1}`,
        type: 'smoothstep',
        animated: runState.status === 'running' && runState.currentStepIndex === i,
        style: {
          stroke: hasVarFlow ? '#8b5cf6' : '#475569',
          strokeWidth: hasVarFlow ? 2 : 1,
        },
        label: hasVarFlow ? sourceVars.join(', ') : undefined,
        labelStyle: { fill: '#8b5cf6', fontSize: 10, fontFamily: 'monospace' },
        labelBgStyle: { fill: '#1e293b', fillOpacity: 0.9 },
        labelBgPadding: [6, 4] as [number, number],
        labelBgBorderRadius: 4,
      }
    })
  }, [steps, runState.status, runState.currentStepIndex])

  // Generate rough YAML representation
  const generatedYaml = useMemo(() => {
    if (!scenario) return ''
    const lines: string[] = [
      `name: ${scenario.name}`,
      `config:`,
      `  base_url: ${scenario.scenario.config.base_url}`,
      `  timeout: ${scenario.scenario.config.timeout}`,
      `steps:`,
    ]
    for (const step of steps) {
      lines.push(`  - name: ${step.name}`)
      lines.push(`    request:`)
      lines.push(`      method: ${step.request.method}`)
      lines.push(`      url: ${step.request.url}`)
      if (Object.keys(step.request.headers).length > 0) {
        lines.push(`      headers:`)
        for (const [k, v] of Object.entries(step.request.headers)) {
          lines.push(`        ${k}: ${v}`)
        }
      }
      if (step.request.body != null) {
        lines.push(`      body: ${JSON.stringify(step.request.body)}`)
      }
      if (step.expect) {
        lines.push(`    expect:`)
        lines.push(`      status: ${step.expect.status}`)
      }
      if (step.save && Object.keys(step.save).length > 0) {
        lines.push(`    save:`)
        for (const [k, v] of Object.entries(step.save)) {
          lines.push(`      ${k}: "${v}"`)
        }
      }
    }
    return lines.join('\n')
  }, [scenario, steps])

  const handleRun = useCallback(() => {
    if (!scenario) return
    reset()
    execute(scenario.id, steps.length)
  }, [scenario, steps, execute, reset])

  const isRunning = runState.status === 'running'

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
          <Link
            to={`/scenarios/${id}`}
            className="text-slate-500 hover:text-slate-300 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="text-sm font-semibold text-slate-200 truncate">
            {scenario.name}
          </h1>
          <span className="text-xs text-slate-600">Flow Editor</span>
          <Link
            to={`/scenarios/${id}/edit`}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-violet-400 transition-colors"
          >
            <Pencil className="w-3 h-3" />
            Edit
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center bg-slate-800 rounded-md border border-slate-700/50 p-0.5">
            <button
              onClick={() => setViewMode('visual')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors',
                viewMode === 'visual'
                  ? 'bg-violet-500/20 text-violet-300'
                  : 'text-slate-500 hover:text-slate-300',
              )}
            >
              <Eye className="w-3 h-3" />
              Visual
            </button>
            <button
              onClick={() => {
                setViewMode('yaml')
                setYamlContent(generatedYaml)
              }}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors',
                viewMode === 'yaml'
                  ? 'bg-violet-500/20 text-violet-300'
                  : 'text-slate-500 hover:text-slate-300',
              )}
            >
              <Code2 className="w-3 h-3" />
              YAML
            </button>
          </div>
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

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'visual' ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
            className="bg-slate-900"
          >
            <Background variant={BackgroundVariant.Dots} color="#334155" gap={20} size={1} />
            <Controls
              className="!bg-slate-800 !border-slate-700 !rounded-md !shadow-lg [&>button]:!bg-slate-800 [&>button]:!border-slate-700 [&>button]:!text-slate-400 [&>button:hover]:!bg-slate-700"
            />
          </ReactFlow>
        ) : (
          <Editor
            height="100%"
            language="yaml"
            theme="vs-dark"
            value={yamlContent || generatedYaml}
            onChange={(v) => setYamlContent(v ?? '')}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              padding: { top: 16, bottom: 16 },
              tabSize: 2,
              wordWrap: 'on',
              readOnly: false,
            }}
          />
        )}
      </div>

      {/* Legend / info bar */}
      {viewMode === 'visual' && (
        <div className="border-t border-slate-700/50 bg-slate-800/30 px-4 py-2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4 text-[10px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-600" /> Pending
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse-dot" /> Running
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" /> Passed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-400" /> Failed
            </span>
            <span className="flex items-center gap-1.5 ml-2 border-l border-slate-700 pl-4">
              <span className="w-4 h-0.5 bg-violet-500 rounded" /> Variable flow
            </span>
          </div>
          <span className="text-[10px] text-slate-600">{steps.length} steps</span>
        </div>
      )}
    </div>
  )
}
