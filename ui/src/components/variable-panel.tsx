import type { StepDefinition } from '../lib/types'

interface VariablePanelProps {
  initialVars: Record<string, unknown>
  runtimeVars: Record<string, string>
  steps: StepDefinition[]
}

export function VariablePanel({ initialVars, runtimeVars, steps }: VariablePanelProps) {
  const savedKeys = new Set(
    steps.flatMap(s => Object.keys(s.save ?? {}))
  )

  const allVars: Record<string, { value: string; source: 'initial' | 'saved' }> = {}

  for (const [k, v] of Object.entries(initialVars)) {
    allVars[k] = { value: String(v), source: 'initial' }
  }
  for (const [k, v] of Object.entries(runtimeVars)) {
    allVars[k] = { value: v, source: savedKeys.has(k) ? 'saved' : 'initial' }
  }

  const entries = Object.entries(allVars)

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-slate-600">
        No variables defined
      </div>
    )
  }

  return (
    <div>
      <div className="bg-slate-900/50 border border-slate-700/50 rounded-md overflow-hidden">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-slate-700/50">
              <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Key</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Value</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Source</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, { value, source }]) => (
              <tr key={key} className="border-b border-slate-800 last:border-0">
                <td className="px-3 py-1.5 text-violet-400 whitespace-nowrap">{key}</td>
                <td className="px-3 py-1.5 text-slate-300 break-all max-w-xs truncate">{truncateValue(value)}</td>
                <td className="px-3 py-1.5">
                  <span className={
                    source === 'saved'
                      ? 'text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded'
                      : 'text-slate-500'
                  }>
                    {source === 'saved' ? 'step output' : 'initial'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function truncateValue(v: string): string {
  return v.length > 80 ? `${v.slice(0, 77)}...` : v
}
