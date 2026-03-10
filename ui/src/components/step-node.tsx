import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps, Node } from '@xyflow/react'
import { cn, methodColor } from '../lib/utils'

export type StepNodeData = {
  label: string
  method: string
  url: string
  status: 'pending' | 'running' | 'passed' | 'failed'
  index: number
  saveVars: string[]
}

type StepNodeType = Node<StepNodeData, 'step'>

export const StepNode = memo(function StepNode({ data }: NodeProps<StepNodeType>) {
  const statusClasses: Record<string, string> = {
    pending: 'border-slate-700',
    running: 'border-amber-500/50 shadow-amber-500/10',
    passed: 'border-emerald-500/50 shadow-emerald-500/10',
    failed: 'border-red-500/50 shadow-red-500/10',
  }

  const statusDotClasses: Record<string, string> = {
    pending: 'bg-slate-600',
    running: 'bg-amber-400 animate-pulse-dot',
    passed: 'bg-emerald-400',
    failed: 'bg-red-400',
  }

  return (
    <div
      className={cn(
        'bg-slate-800 rounded-lg border px-4 py-3 min-w-[200px] shadow-lg',
        statusClasses[data.status] ?? statusClasses.pending,
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-violet-500 !w-2 !h-2 !border-0" />
      <div className="flex items-center gap-2 mb-1.5">
        <div className={cn('w-2 h-2 rounded-full shrink-0', statusDotClasses[data.status] ?? statusDotClasses.pending)} />
        <span className="text-xs font-medium text-slate-200 truncate">{data.label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={cn('text-[10px] font-bold font-mono px-1.5 py-0.5 rounded', methodColor(data.method))}>
          {data.method.toUpperCase()}
        </span>
        <span className="text-[10px] text-slate-500 font-mono truncate max-w-[180px]">
          {data.url}
        </span>
      </div>
      {data.saveVars.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {data.saveVars.map((v) => (
            <span key={v} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
              {v}
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-violet-500 !w-2 !h-2 !border-0" />
    </div>
  )
})
