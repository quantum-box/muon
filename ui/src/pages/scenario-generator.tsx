import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckSquare,
  Clock,
  Copy,
  Download,
  FileCode2,
  GripVertical,
  Loader2,
  Plus,
  Search,
  Square,
  Tag,
  Wand2,
  X,
  Zap,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { createScenario } from '../lib/api'
import {
  type GeneratedScenario,
  generateScenario,
  scenarioToYaml,
} from '../lib/scenario-generator'
import { getRequestHistory } from '../lib/tauri-api'
import type { HttpMethod, RequestHistoryEntry } from '../lib/types'
import {
  cn,
  formatDuration,
  formatTimestamp,
  methodColor,
  statusColor,
} from '../lib/utils'

type ViewMode = 'select' | 'configure' | 'preview'
type AssertionMode = 'all' | 'status-only' | 'custom'

export function ScenarioGeneratorPage() {
  const [history] = useState<RequestHistoryEntry[]>(() => getRequestHistory())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [orderedIds, setOrderedIds] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>('select')

  // Config
  const [scenarioName, setScenarioName] = useState('Generated Scenario')
  const [scenarioDesc, setScenarioDesc] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [assertionMode, setAssertionMode] = useState<AssertionMode>('all')
  const [includeBinds, setIncludeBinds] = useState(true)

  // Preview
  const [yamlOutput, setYamlOutput] = useState('')
  const [scenario, setScenario] = useState<GeneratedScenario | null>(null)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Filter
  const [search, setSearch] = useState('')
  const [methodFilter, setMethodFilter] = useState<HttpMethod | 'ALL'>('ALL')
  const [successOnly, setSuccessOnly] = useState(false)

  const filteredHistory = useMemo(() => {
    let items = history.filter((h) => h.response !== null)
    if (successOnly) {
      items = items.filter(
        (h) => h.response && h.response.status >= 200 && h.response.status < 300,
      )
    }
    if (methodFilter !== 'ALL') {
      items = items.filter((h) => h.config.method === methodFilter)
    }
    if (search) {
      const q = search.toLowerCase()
      items = items.filter((h) => h.config.url.toLowerCase().includes(q))
    }
    return items
  }, [history, search, methodFilter, successOnly])

  function toggleSelect(id: string) {
    const next = new Set(selected)
    if (next.has(id)) {
      next.delete(id)
      setOrderedIds((prev) => prev.filter((x) => x !== id))
    } else {
      next.add(id)
      setOrderedIds((prev) => [...prev, id])
    }
    setSelected(next)
  }

  function selectAll() {
    const allIds = filteredHistory.map((h) => h.id)
    const newSet = new Set(allIds)
    setSelected(newSet)
    setOrderedIds(allIds)
  }

  function clearSelection() {
    setSelected(new Set())
    setOrderedIds([])
  }

  function moveStep(index: number, direction: 'up' | 'down') {
    const newOrder = [...orderedIds]
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= newOrder.length) return
    const tmp = newOrder[index]!
    newOrder[index] = newOrder[target]!
    newOrder[target] = tmp
    setOrderedIds(newOrder)
  }

  function removeFromOrder(id: string) {
    setOrderedIds((prev) => prev.filter((x) => x !== id))
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  function addTag() {
    const t = tagInput.trim().toLowerCase()
    if (t && !tags.includes(t)) {
      setTags([...tags, t])
    }
    setTagInput('')
  }

  function removeTag(tag: string) {
    setTags(tags.filter((t) => t !== tag))
  }

  const selectedEntries = useMemo(() => {
    return orderedIds
      .map((id) => history.find((h) => h.id === id))
      .filter((h): h is RequestHistoryEntry => h != null)
  }, [orderedIds, history])

  function handleGenerate() {
    const gen = generateScenario(selectedEntries, {
      name: scenarioName,
      description: scenarioDesc,
      tags,
      includeAssertions: assertionMode !== 'status-only',
      includeBinds,
      assertionFields: assertionMode,
    })
    setScenario(gen)
    setYamlOutput(scenarioToYaml(gen))
    setViewMode('preview')
  }

  function handleCopy() {
    navigator.clipboard.writeText(yamlOutput)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSave = useCallback(async () => {
    if (!yamlOutput || !scenarioName) return
    setSaving(true)
    setSaveError(null)
    try {
      await createScenario({ name: scenarioName, yaml: yamlOutput })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [yamlOutput, scenarioName])

  function handleDownload() {
    const blob = new Blob([yamlOutput], { type: 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${scenarioName.toLowerCase().replace(/\s+/g, '-')}.yaml`
    a.click()
    URL.revokeObjectURL(url)
  }

  function extractUrlPath(url: string): string {
    try {
      const u = new URL(url)
      return u.pathname + u.search
    } catch {
      return url
    }
  }

  function extractHost(url: string): string {
    try {
      return new URL(url).host
    } catch {
      return ''
    }
  }

  return (
    <div className='h-[calc(100vh-4.25rem)] flex flex-col'>
      {/* Header */}
      <div className='border-b border-slate-700/50 p-3 flex items-center gap-3 shrink-0'>
        <div className='flex items-center gap-2'>
          <Wand2 className='w-4 h-4 text-violet-400' />
          <h1 className='text-sm font-medium text-slate-200'>
            Scenario Generator
          </h1>
        </div>

        {/* Step indicator */}
        <div className='flex items-center gap-1 ml-4'>
          {(['select', 'configure', 'preview'] as ViewMode[]).map(
            (step, i) => (
              <div key={step} className='flex items-center gap-1'>
                {i > 0 && (
                  <div className='w-6 h-px bg-slate-700' />
                )}
                <button
                  type='button'
                  onClick={() => {
                    if (step === 'select') setViewMode('select')
                    else if (step === 'configure' && selected.size > 0)
                      setViewMode('configure')
                    else if (step === 'preview' && scenario)
                      setViewMode('preview')
                  }}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
                    viewMode === step
                      ? 'text-violet-400 bg-violet-500/10'
                      : step === 'select' ||
                          (step === 'configure' && selected.size > 0) ||
                          (step === 'preview' && scenario)
                        ? 'text-slate-500 hover:text-slate-300'
                        : 'text-slate-700 cursor-not-allowed',
                  )}
                >
                  <span className='w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px]'>
                    {i + 1}
                  </span>
                  <span className='capitalize'>{step}</span>
                </button>
              </div>
            ),
          )}
        </div>

        <div className='ml-auto flex items-center gap-2'>
          {viewMode === 'select' && selected.size > 0 && (
            <button
              type='button'
              onClick={() => setViewMode('configure')}
              className='flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors'
            >
              Next: Configure
              <span className='bg-white/20 px-1.5 rounded text-[10px]'>
                {selected.size}
              </span>
            </button>
          )}
          {viewMode === 'configure' && (
            <button
              type='button'
              onClick={handleGenerate}
              disabled={selected.size === 0}
              className='flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50'
            >
              <Zap className='w-3.5 h-3.5' />
              Generate YAML
            </button>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className='flex-1 overflow-hidden'>
        {/* Step 1: Select requests */}
        {viewMode === 'select' && (
          <div className='h-full flex'>
            {/* Request list */}
            <div className='flex-1 flex flex-col overflow-hidden'>
              {/* Filters */}
              <div className='border-b border-slate-700/50 px-4 py-2.5 flex items-center gap-2 shrink-0'>
                <div className='relative flex-1 max-w-sm'>
                  <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600' />
                  <input
                    type='text'
                    placeholder='Filter by URL...'
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className='w-full pl-8 pr-3 py-1.5 bg-slate-800/50 border border-slate-700/50 rounded text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500/50'
                  />
                </div>

                <select
                  value={methodFilter}
                  onChange={(e) =>
                    setMethodFilter(e.target.value as HttpMethod | 'ALL')
                  }
                  className='bg-slate-800/50 border border-slate-700/50 rounded px-2 py-1.5 text-xs text-slate-400 focus:outline-none focus:border-violet-500/50'
                >
                  <option value='ALL'>All Methods</option>
                  {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>

                <label className='flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer'>
                  <input
                    type='checkbox'
                    checked={successOnly}
                    onChange={(e) => setSuccessOnly(e.target.checked)}
                    className='w-3 h-3 rounded bg-slate-800 border-slate-600'
                  />
                  2xx only
                </label>

                <div className='ml-auto flex items-center gap-2'>
                  <button
                    type='button'
                    onClick={selectAll}
                    className='text-[10px] text-slate-500 hover:text-violet-400 transition-colors'
                  >
                    Select All
                  </button>
                  {selected.size > 0 && (
                    <button
                      type='button'
                      onClick={clearSelection}
                      className='text-[10px] text-slate-500 hover:text-red-400 transition-colors'
                    >
                      Clear ({selected.size})
                    </button>
                  )}
                </div>
              </div>

              {/* List */}
              <div className='flex-1 overflow-auto'>
                {filteredHistory.length === 0 ? (
                  <div className='flex flex-col items-center justify-center h-full text-slate-600 gap-2'>
                    <Clock className='w-8 h-8 opacity-30' />
                    <p className='text-sm'>No request history</p>
                    <p className='text-xs'>
                      Execute some requests in the API Client first
                    </p>
                  </div>
                ) : (
                  filteredHistory.map((entry) => {
                    const isSelected = selected.has(entry.id)
                    const orderIndex = orderedIds.indexOf(entry.id)
                    return (
                      <div
                        key={entry.id}
                        role='button'
                        tabIndex={0}
                        onClick={() => toggleSelect(entry.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ')
                            toggleSelect(entry.id)
                        }}
                        className={cn(
                          'flex items-center gap-3 px-4 py-2.5 border-b border-slate-800/50 cursor-pointer transition-colors',
                          isSelected
                            ? 'bg-violet-500/5 border-l-2 border-l-violet-500'
                            : 'hover:bg-slate-800/30',
                        )}
                      >
                        {/* Checkbox */}
                        <div className='shrink-0'>
                          {isSelected ? (
                            <CheckSquare className='w-4 h-4 text-violet-400' />
                          ) : (
                            <Square className='w-4 h-4 text-slate-600' />
                          )}
                        </div>

                        {/* Order badge */}
                        {isSelected && orderIndex >= 0 && (
                          <span className='shrink-0 w-5 h-5 rounded-full bg-violet-500/20 text-violet-400 text-[10px] font-bold flex items-center justify-center'>
                            {orderIndex + 1}
                          </span>
                        )}

                        {/* Method + Status */}
                        <span
                          className={cn(
                            'text-[10px] font-bold font-mono shrink-0 px-1.5 py-0.5 rounded',
                            methodColor(entry.config.method),
                          )}
                        >
                          {entry.config.method}
                        </span>
                        {entry.response && (
                          <span
                            className={cn(
                              'text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0',
                              statusColor(entry.response.status),
                            )}
                          >
                            {entry.response.status}
                          </span>
                        )}

                        {/* URL */}
                        <div className='flex-1 min-w-0'>
                          <div
                            className='text-xs text-slate-300 font-mono truncate'
                            title={entry.config.url}
                          >
                            {extractUrlPath(entry.config.url)}
                          </div>
                          <div className='text-[10px] text-slate-600 font-mono truncate'>
                            {extractHost(entry.config.url)}
                          </div>
                        </div>

                        {/* Meta */}
                        <div className='shrink-0 text-right'>
                          {entry.response && (
                            <div className='text-[10px] text-slate-600'>
                              {formatDuration(entry.response.duration_ms)}
                            </div>
                          )}
                          <div className='text-[10px] text-slate-700'>
                            {formatTimestamp(entry.timestamp)}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* Selected steps sidebar */}
            {selected.size > 0 && (
              <div className='w-64 border-l border-slate-700/50 bg-slate-900/50 flex flex-col shrink-0'>
                <div className='border-b border-slate-700/50 px-3 py-2 flex items-center justify-between'>
                  <span className='text-xs font-medium text-slate-300'>
                    Selected Steps
                  </span>
                  <span className='text-[10px] text-slate-600 font-mono'>
                    {selected.size} requests
                  </span>
                </div>
                <div className='flex-1 overflow-auto'>
                  {orderedIds.map((id, index) => {
                    const entry = history.find((h) => h.id === id)
                    if (!entry) return null
                    return (
                      <div
                        key={id}
                        className='flex items-center gap-1.5 px-2 py-2 border-b border-slate-800/30 group'
                      >
                        <GripVertical className='w-3 h-3 text-slate-700 shrink-0' />
                        <span className='text-[10px] text-slate-600 font-mono w-4 shrink-0'>
                          {index + 1}
                        </span>
                        <span
                          className={cn(
                            'text-[9px] font-bold font-mono px-1 rounded shrink-0',
                            methodColor(entry.config.method),
                          )}
                        >
                          {entry.config.method}
                        </span>
                        <span className='text-[10px] text-slate-400 font-mono truncate flex-1'>
                          {extractUrlPath(entry.config.url)}
                        </span>
                        <div className='hidden group-hover:flex items-center gap-0.5 shrink-0'>
                          <button
                            type='button'
                            onClick={(e) => {
                              e.stopPropagation()
                              moveStep(index, 'up')
                            }}
                            disabled={index === 0}
                            className='p-0.5 text-slate-600 hover:text-slate-400 disabled:opacity-30'
                          >
                            <ArrowUp className='w-2.5 h-2.5' />
                          </button>
                          <button
                            type='button'
                            onClick={(e) => {
                              e.stopPropagation()
                              moveStep(index, 'down')
                            }}
                            disabled={index === orderedIds.length - 1}
                            className='p-0.5 text-slate-600 hover:text-slate-400 disabled:opacity-30'
                          >
                            <ArrowDown className='w-2.5 h-2.5' />
                          </button>
                          <button
                            type='button'
                            onClick={(e) => {
                              e.stopPropagation()
                              removeFromOrder(id)
                            }}
                            className='p-0.5 text-slate-600 hover:text-red-400'
                          >
                            <X className='w-2.5 h-2.5' />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Configure */}
        {viewMode === 'configure' && (
          <div className='h-full flex'>
            {/* Config form */}
            <div className='flex-1 overflow-auto p-6 max-w-2xl'>
              <div className='space-y-5'>
                {/* Name */}
                <div>
                  <label className='block text-xs text-slate-400 mb-1.5'>
                    Scenario Name
                  </label>
                  <input
                    type='text'
                    value={scenarioName}
                    onChange={(e) => setScenarioName(e.target.value)}
                    className='w-full bg-slate-800/50 border border-slate-700/50 rounded px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50'
                    placeholder='My API Scenario'
                  />
                </div>

                {/* Description */}
                <div>
                  <label className='block text-xs text-slate-400 mb-1.5'>
                    Description
                  </label>
                  <textarea
                    value={scenarioDesc}
                    onChange={(e) => setScenarioDesc(e.target.value)}
                    className='w-full bg-slate-800/50 border border-slate-700/50 rounded px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50 resize-none'
                    rows={2}
                    placeholder='Describe what this scenario tests...'
                  />
                </div>

                {/* Tags */}
                <div>
                  <label className='block text-xs text-slate-400 mb-1.5'>
                    Tags
                  </label>
                  <div className='flex flex-wrap gap-1.5 mb-2'>
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className='inline-flex items-center gap-1 px-2 py-0.5 bg-violet-500/10 text-violet-400 rounded text-[10px]'
                      >
                        <Tag className='w-2.5 h-2.5' />
                        {tag}
                        <button
                          type='button'
                          onClick={() => removeTag(tag)}
                          className='hover:text-red-400 transition-colors'
                        >
                          <X className='w-2.5 h-2.5' />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className='flex gap-2'>
                    <input
                      type='text'
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addTag()
                        }
                      }}
                      className='flex-1 bg-slate-800/50 border border-slate-700/50 rounded px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50'
                      placeholder='Add tag...'
                    />
                    <button
                      type='button'
                      onClick={addTag}
                      className='px-2 py-1.5 bg-slate-800 border border-slate-700/50 rounded text-xs text-slate-400 hover:text-violet-400 transition-colors'
                    >
                      <Plus className='w-3.5 h-3.5' />
                    </button>
                  </div>
                </div>

                {/* Assertion mode */}
                <div>
                  <label className='block text-xs text-slate-400 mb-2'>
                    Assertion Generation
                  </label>
                  <div className='space-y-2'>
                    {(
                      [
                        {
                          value: 'all',
                          label: 'Full assertions',
                          desc: 'Status code + JSON body field matching',
                        },
                        {
                          value: 'status-only',
                          label: 'Status only',
                          desc: 'Only assert HTTP status code',
                        },
                      ] as const
                    ).map(({ value, label, desc }) => (
                      <label
                        key={value}
                        className='flex items-start gap-2.5 cursor-pointer p-2 rounded hover:bg-slate-800/30 transition-colors'
                      >
                        <input
                          type='radio'
                          name='assertionMode'
                          checked={assertionMode === value}
                          onChange={() => setAssertionMode(value)}
                          className='w-3.5 h-3.5 mt-0.5 text-violet-500 bg-slate-800 border-slate-600'
                        />
                        <div>
                          <div className='text-xs text-slate-200'>{label}</div>
                          <div className='text-[10px] text-slate-500'>
                            {desc}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Variable extraction */}
                <div>
                  <label className='flex items-center gap-2 cursor-pointer p-2 rounded hover:bg-slate-800/30 transition-colors'>
                    <input
                      type='checkbox'
                      checked={includeBinds}
                      onChange={(e) => setIncludeBinds(e.target.checked)}
                      className='w-3.5 h-3.5 text-violet-500 bg-slate-800 border-slate-600 rounded'
                    />
                    <div>
                      <div className='text-xs text-slate-200'>
                        Auto-extract variables
                      </div>
                      <div className='text-[10px] text-slate-500'>
                        Detect ID fields in responses and create bind
                        expressions for cross-step references
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {/* Step preview sidebar */}
            <div className='w-80 border-l border-slate-700/50 bg-slate-900/50 flex flex-col shrink-0'>
              <div className='border-b border-slate-700/50 px-3 py-2'>
                <span className='text-xs font-medium text-slate-300'>
                  Steps Preview
                </span>
              </div>
              <div className='flex-1 overflow-auto'>
                {selectedEntries.map((entry, index) => (
                  <div
                    key={entry.id}
                    className='px-3 py-2.5 border-b border-slate-800/30'
                  >
                    <div className='flex items-center gap-1.5 mb-1'>
                      <span className='text-[10px] text-slate-600 font-mono'>
                        {index + 1}.
                      </span>
                      <span
                        className={cn(
                          'text-[9px] font-bold font-mono px-1 rounded',
                          methodColor(entry.config.method),
                        )}
                      >
                        {entry.config.method}
                      </span>
                      <span
                        className={cn(
                          'text-[9px] font-mono px-1 rounded',
                          entry.response
                            ? statusColor(entry.response.status)
                            : 'text-slate-600',
                        )}
                      >
                        {entry.response?.status ?? '---'}
                      </span>
                    </div>
                    <div className='text-[10px] text-slate-400 font-mono truncate'>
                      {extractUrlPath(entry.config.url)}
                    </div>
                    {entry.config.bodyContent &&
                      entry.config.bodyType !== 'none' && (
                        <div className='text-[9px] text-slate-600 mt-0.5'>
                          Has body ({entry.config.bodyType})
                        </div>
                      )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Preview */}
        {viewMode === 'preview' && yamlOutput && (
          <div className='h-full flex flex-col'>
            {/* Toolbar */}
            <div className='border-b border-slate-700/50 px-4 py-2 flex items-center gap-2 shrink-0'>
              <FileCode2 className='w-4 h-4 text-violet-400' />
              <span className='text-xs font-medium text-slate-300'>
                {scenarioName}.yaml
              </span>
              <span className='text-[10px] text-slate-600 font-mono'>
                {scenario?.steps.length ?? 0} steps
              </span>

              <div className='ml-auto flex items-center gap-2'>
                <button
                  type='button'
                  onClick={() => setViewMode('configure')}
                  className='px-2.5 py-1 rounded text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors'
                >
                  Back to Configure
                </button>
                <button
                  type='button'
                  onClick={handleCopy}
                  className='flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors'
                >
                  {copied ? (
                    <Check className='w-3.5 h-3.5 text-emerald-400' />
                  ) : (
                    <Copy className='w-3.5 h-3.5' />
                  )}
                  Copy
                </button>
                <button
                  type='button'
                  onClick={handleDownload}
                  className='flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors'
                >
                  <Download className='w-3.5 h-3.5' />
                  Download
                </button>
                <button
                  type='button'
                  onClick={handleSave}
                  disabled={saving}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors',
                    saveSuccess
                      ? 'bg-emerald-600 text-white'
                      : saving
                        ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                        : 'bg-violet-600 hover:bg-violet-500 text-white',
                  )}
                >
                  {saving ? (
                    <Loader2 className='w-3.5 h-3.5 animate-spin' />
                  ) : saveSuccess ? (
                    <Check className='w-3.5 h-3.5' />
                  ) : (
                    <Zap className='w-3.5 h-3.5' />
                  )}
                  {saveSuccess ? 'Saved!' : 'Save as Scenario'}
                </button>
              </div>
            </div>

            {saveError && (
              <div className='px-4 py-2 bg-red-500/10 border-b border-red-500/20'>
                <p className='text-xs text-red-400'>{saveError}</p>
              </div>
            )}

            {/* YAML + Step detail side-by-side */}
            <div className='flex-1 flex overflow-hidden'>
              {/* YAML editor */}
              <div className='flex-1 overflow-auto p-4'>
                <textarea
                  value={yamlOutput}
                  onChange={(e) => setYamlOutput(e.target.value)}
                  className='w-full h-full bg-slate-900/50 border border-slate-700/50 rounded-md p-4 text-xs font-mono text-slate-300 leading-relaxed focus:outline-none focus:border-violet-500/50 resize-none'
                  spellCheck={false}
                />
              </div>

              {/* Step summary */}
              <div className='w-72 border-l border-slate-700/50 bg-slate-900/50 flex flex-col shrink-0 overflow-auto'>
                <div className='border-b border-slate-700/50 px-3 py-2'>
                  <span className='text-xs font-medium text-slate-300'>
                    Step Summary
                  </span>
                </div>
                {scenario?.steps.map((step, index) => (
                  <div
                    key={step.id}
                    className='px-3 py-2.5 border-b border-slate-800/30'
                  >
                    <div className='flex items-center gap-1.5 mb-1'>
                      <span className='text-[10px] text-slate-600 font-mono'>
                        {index + 1}.
                      </span>
                      <span
                        className={cn(
                          'text-[9px] font-bold font-mono px-1 rounded',
                          methodColor(step.request.method),
                        )}
                      >
                        {step.request.method}
                      </span>
                      <span className='text-[10px] text-slate-300 truncate'>
                        {step.name}
                      </span>
                    </div>
                    <div className='text-[10px] text-slate-500 font-mono truncate mb-1'>
                      {step.request.url}
                    </div>
                    <div className='flex flex-wrap gap-1'>
                      <span className='text-[9px] text-emerald-500 bg-emerald-500/10 px-1 rounded'>
                        expect: {step.expect.status}
                      </span>
                      {step.expect.json && (
                        <span className='text-[9px] text-blue-400 bg-blue-400/10 px-1 rounded'>
                          json match
                        </span>
                      )}
                      {step.bind && Object.keys(step.bind).length > 0 && (
                        <span className='text-[9px] text-amber-400 bg-amber-400/10 px-1 rounded'>
                          bind: {Object.keys(step.bind).join(', ')}
                        </span>
                      )}
                      {step.request.body !== undefined && (
                        <span className='text-[9px] text-violet-400 bg-violet-400/10 px-1 rounded'>
                          has body
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
