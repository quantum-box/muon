export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHr = Math.floor(diffMs / 3_600_000)
  const diffDay = Math.floor(diffMs / 86_400_000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay < 7) return `${diffDay}d ago`
  return d.toLocaleDateString()
}

export function formatJson(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  return JSON.stringify(value, null, 2)
}

export function highlightJson(json: string): string {
  return json.replace(
    /("(?:\\.|[^"\\])*")\s*:/g,
    '<span class="json-key">$1</span>:',
  ).replace(
    /:\s*("(?:\\.|[^"\\])*")/g,
    ': <span class="json-string">$1</span>',
  ).replace(
    /:\s*(\d+\.?\d*)/g,
    ': <span class="json-number">$1</span>',
  ).replace(
    /:\s*(true|false)/g,
    ': <span class="json-boolean">$1</span>',
  ).replace(
    /:\s*(null)/g,
    ': <span class="json-null">$1</span>',
  )
}

export function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET': return 'text-emerald-400 bg-emerald-400/10'
    case 'POST': return 'text-blue-400 bg-blue-400/10'
    case 'PUT': return 'text-amber-400 bg-amber-400/10'
    case 'PATCH': return 'text-orange-400 bg-orange-400/10'
    case 'DELETE': return 'text-red-400 bg-red-400/10'
    default: return 'text-slate-400 bg-slate-400/10'
  }
}

export function statusColor(status: number): string {
  if (status >= 200 && status < 300) return 'text-emerald-400 bg-emerald-400/10'
  if (status >= 300 && status < 400) return 'text-blue-400 bg-blue-400/10'
  if (status >= 400 && status < 500) return 'text-amber-400 bg-amber-400/10'
  return 'text-red-400 bg-red-400/10'
}
