import { useState } from 'react'
import { cn } from '../lib/utils'
import { RequestPanel } from './request-panel'
import { ResponsePanel } from './response-panel'
import { VariablePanel } from './variable-panel'
import type { StepDefinition, StepResult } from '../lib/types'

type Tab = 'request' | 'response' | 'variables'

interface StepViewerProps {
  step: StepDefinition
  result: StepResult | null
  allSteps: StepDefinition[]
  variables: Record<string, unknown>
  runtimeVars: Record<string, string>
}

export function StepViewer({ step, result, allSteps, variables, runtimeVars }: StepViewerProps) {
  const [tab, setTab] = useState<Tab>('request')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'request', label: 'Request' },
    { key: 'response', label: 'Response' },
    { key: 'variables', label: 'Variables' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex gap-0 border-b border-slate-700/50 px-1">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-4 py-2.5 text-xs font-medium transition-colors relative',
              tab === t.key
                ? 'text-violet-400'
                : 'text-slate-500 hover:text-slate-300',
            )}
          >
            {t.label}
            {tab === t.key && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'request' && (
          <RequestPanel definition={step.request} actual={result?.request} />
        )}
        {tab === 'response' && (
          <ResponsePanel result={result} />
        )}
        {tab === 'variables' && (
          <VariablePanel
            initialVars={variables}
            runtimeVars={runtimeVars}
            steps={allSteps}
          />
        )}
      </div>

      {/* Expect section for request tab */}
      {tab === 'request' && step.expect && (
        <div className="border-t border-slate-700/50 p-4">
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Assertions</h4>
          <div className="flex flex-wrap gap-2">
            <span className="px-2 py-1 text-xs font-mono rounded bg-slate-900/50 border border-slate-700/50 text-slate-400">
              status = {step.expect.status}
            </span>
            {step.expect.json != null && (
              <span className="px-2 py-1 text-xs font-mono rounded bg-slate-900/50 border border-slate-700/50 text-slate-400">
                json body check
              </span>
            )}
          </div>
          {step.save && Object.keys(step.save).length > 0 && (
            <div className="mt-2">
              <span className="text-[10px] uppercase tracking-wider text-slate-600 font-semibold">Saves:</span>
              {Object.entries(step.save).map(([k, v]) => (
                <span key={k} className="ml-2 px-2 py-0.5 text-xs font-mono rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {k} &larr; {v}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
