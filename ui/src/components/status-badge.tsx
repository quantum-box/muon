import { cn } from '../lib/utils'
import { Check, X, Loader2, Clock } from 'lucide-react'
import type { StepStatus } from '../lib/types'

interface StatusBadgeProps {
  status: 'passed' | 'failed' | 'running' | 'pending'
  label?: string
  size?: 'sm' | 'md'
}

export function StatusBadge({ status, label, size = 'md' }: StatusBadgeProps) {
  const baseClasses = cn(
    'inline-flex items-center gap-1 font-medium rounded-full',
    size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
  )

  switch (status) {
    case 'passed':
      return (
        <span className={cn(baseClasses, 'bg-emerald-500/10 text-emerald-400')}>
          <Check className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          {label ?? 'Passed'}
        </span>
      )
    case 'failed':
      return (
        <span className={cn(baseClasses, 'bg-red-500/10 text-red-400')}>
          <X className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          {label ?? 'Failed'}
        </span>
      )
    case 'running':
      return (
        <span className={cn(baseClasses, 'bg-blue-500/10 text-blue-400')}>
          <Loader2 className={cn('animate-spin', size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
          {label ?? 'Running'}
        </span>
      )
    case 'pending':
      return (
        <span className={cn(baseClasses, 'bg-slate-500/10 text-slate-500')}>
          <Clock className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          {label ?? 'Pending'}
        </span>
      )
  }
}

export function StepStatusDot({ status }: { status: StepStatus }) {
  const base = 'w-2.5 h-2.5 rounded-full shrink-0'
  switch (status) {
    case 'passed': return <div className={cn(base, 'bg-emerald-500')} />
    case 'failed': return <div className={cn(base, 'bg-red-500')} />
    case 'running': return <div className={cn(base, 'bg-blue-500 animate-pulse-dot')} />
    case 'pending': return <div className={cn(base, 'bg-slate-600')} />
  }
}
