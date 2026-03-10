import { Plus, Trash2 } from 'lucide-react'
import type { KeyValuePair } from '../lib/types'

interface KeyValueEditorProps {
  pairs: KeyValuePair[]
  onChange: (pairs: KeyValuePair[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
  readOnly?: boolean
}

export function KeyValueEditor({
  pairs,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  readOnly = false,
}: KeyValueEditorProps) {
  function updatePair(index: number, field: keyof KeyValuePair, value: string | boolean) {
    const updated = pairs.map((p, i) =>
      i === index ? { ...p, [field]: value } : p,
    )
    onChange(updated)
  }

  function addPair() {
    onChange([...pairs, { key: '', value: '', enabled: true }])
  }

  function removePair(index: number) {
    onChange(pairs.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-1">
      {pairs.map((pair, i) => (
        <div key={i} className="flex items-center gap-2 group">
          <label className="flex items-center shrink-0">
            <input
              type="checkbox"
              checked={pair.enabled}
              onChange={(e) => updatePair(i, 'enabled', e.target.checked)}
              disabled={readOnly}
              className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 text-violet-500 focus:ring-violet-500/30"
            />
          </label>
          <input
            type="text"
            value={pair.key}
            onChange={(e) => updatePair(i, 'key', e.target.value)}
            placeholder={keyPlaceholder}
            readOnly={readOnly}
            className="flex-1 bg-slate-800/50 border border-slate-700/50 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"
          />
          <input
            type="text"
            value={pair.value}
            onChange={(e) => updatePair(i, 'value', e.target.value)}
            placeholder={valuePlaceholder}
            readOnly={readOnly}
            className="flex-1 bg-slate-800/50 border border-slate-700/50 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"
          />
          {!readOnly && (
            <button
              onClick={() => removePair(i)}
              className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all p-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button
          onClick={addPair}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-violet-400 transition-colors mt-2 px-1"
        >
          <Plus className="w-3.5 h-3.5" />
          Add row
        </button>
      )}
    </div>
  )
}
