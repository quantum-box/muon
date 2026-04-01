import { useState, useCallback, memo } from 'react'
import { ChevronRight, ChevronDown, Copy, Check } from 'lucide-react'

interface JsonTreeViewProps {
  data: unknown
  defaultExpanded?: number
}

export function JsonTreeView({ data, defaultExpanded = 2 }: JsonTreeViewProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [data])

  return (
    <div className="relative">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded bg-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors z-10"
        title="Copy JSON"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      <div className="bg-slate-900/50 border border-slate-700/50 rounded-md p-3 text-xs font-mono overflow-auto max-h-[calc(100vh-16rem)]">
        <TreeNode value={data} depth={0} defaultExpanded={defaultExpanded} path="root" />
      </div>
    </div>
  )
}

interface TreeNodeProps {
  keyName?: string
  value: unknown
  depth: number
  defaultExpanded: number
  isLast?: boolean
  path: string
}

const TreeNode = memo(function TreeNode({
  keyName,
  value,
  depth,
  defaultExpanded,
  isLast = true,
  path,
}: TreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < defaultExpanded)

  if (value === null) {
    return (
      <div className="leading-relaxed" style={{ paddingLeft: depth > 0 ? 16 : 0 }}>
        {keyName != null && (
          <span className="json-key">"{keyName}"</span>
        )}
        {keyName != null && <span className="text-slate-500">: </span>}
        <span className="json-null">null</span>
        {!isLast && <span className="text-slate-500">,</span>}
      </div>
    )
  }

  if (typeof value === 'boolean') {
    return (
      <div className="leading-relaxed" style={{ paddingLeft: depth > 0 ? 16 : 0 }}>
        {keyName != null && <span className="json-key">"{keyName}"</span>}
        {keyName != null && <span className="text-slate-500">: </span>}
        <span className="json-boolean">{String(value)}</span>
        {!isLast && <span className="text-slate-500">,</span>}
      </div>
    )
  }

  if (typeof value === 'number') {
    return (
      <div className="leading-relaxed" style={{ paddingLeft: depth > 0 ? 16 : 0 }}>
        {keyName != null && <span className="json-key">"{keyName}"</span>}
        {keyName != null && <span className="text-slate-500">: </span>}
        <span className="json-number">{value}</span>
        {!isLast && <span className="text-slate-500">,</span>}
      </div>
    )
  }

  if (typeof value === 'string') {
    const displayValue = value.length > 200 ? value.slice(0, 200) + '...' : value
    return (
      <div className="leading-relaxed" style={{ paddingLeft: depth > 0 ? 16 : 0 }}>
        {keyName != null && <span className="json-key">"{keyName}"</span>}
        {keyName != null && <span className="text-slate-500">: </span>}
        <span className="json-string">"{displayValue}"</span>
        {!isLast && <span className="text-slate-500">,</span>}
      </div>
    )
  }

  if (Array.isArray(value)) {
    const count = value.length
    if (count === 0) {
      return (
        <div className="leading-relaxed" style={{ paddingLeft: depth > 0 ? 16 : 0 }}>
          {keyName != null && <span className="json-key">"{keyName}"</span>}
          {keyName != null && <span className="text-slate-500">: </span>}
          <span className="json-tree-bracket">[]</span>
          {!isLast && <span className="text-slate-500">,</span>}
        </div>
      )
    }

    return (
      <div style={{ paddingLeft: depth > 0 ? 16 : 0 }}>
        <div
          className="json-tree-toggle leading-relaxed flex items-center gap-0.5"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" />
            : <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
          }
          {keyName != null && <span className="json-key">"{keyName}"</span>}
          {keyName != null && <span className="text-slate-500">: </span>}
          <span className="json-tree-bracket">[</span>
          {!expanded && (
            <>
              <span className="json-tree-ellipsis">...</span>
              <span className="json-tree-bracket">]</span>
              <span className="json-tree-count">({count})</span>
            </>
          )}
        </div>
        {expanded && (
          <>
            {value.map((item, i) => (
              <TreeNode
                key={`${path}[${i}]`}
                keyName={String(i)}
                value={item}
                depth={depth + 1}
                defaultExpanded={defaultExpanded}
                isLast={i === count - 1}
                path={`${path}[${i}]`}
              />
            ))}
            <div className="leading-relaxed" style={{ paddingLeft: 0 }}>
              <span className="json-tree-bracket">]</span>
              {!isLast && <span className="text-slate-500">,</span>}
            </div>
          </>
        )}
      </div>
    )
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    const count = entries.length
    if (count === 0) {
      return (
        <div className="leading-relaxed" style={{ paddingLeft: depth > 0 ? 16 : 0 }}>
          {keyName != null && <span className="json-key">"{keyName}"</span>}
          {keyName != null && <span className="text-slate-500">: </span>}
          <span className="json-tree-bracket">{'{}'}</span>
          {!isLast && <span className="text-slate-500">,</span>}
        </div>
      )
    }

    return (
      <div style={{ paddingLeft: depth > 0 ? 16 : 0 }}>
        <div
          className="json-tree-toggle leading-relaxed flex items-center gap-0.5"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" />
            : <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
          }
          {keyName != null && <span className="json-key">"{keyName}"</span>}
          {keyName != null && <span className="text-slate-500">: </span>}
          <span className="json-tree-bracket">{'{'}</span>
          {!expanded && (
            <>
              <span className="json-tree-ellipsis">...</span>
              <span className="json-tree-bracket">{'}'}</span>
              <span className="json-tree-count">({count})</span>
            </>
          )}
        </div>
        {expanded && (
          <>
            {entries.map(([k, v], i) => (
              <TreeNode
                key={`${path}.${k}`}
                keyName={k}
                value={v}
                depth={depth + 1}
                defaultExpanded={defaultExpanded}
                isLast={i === count - 1}
                path={`${path}.${k}`}
              />
            ))}
            <div className="leading-relaxed" style={{ paddingLeft: 0 }}>
              <span className="json-tree-bracket">{'}'}</span>
              {!isLast && <span className="text-slate-500">,</span>}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="leading-relaxed" style={{ paddingLeft: depth > 0 ? 16 : 0 }}>
      {keyName != null && <span className="json-key">"{keyName}"</span>}
      {keyName != null && <span className="text-slate-500">: </span>}
      <span className="text-slate-300">{String(value)}</span>
      {!isLast && <span className="text-slate-500">,</span>}
    </div>
  )
})
