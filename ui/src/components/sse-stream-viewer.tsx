import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Radio, ChevronDown, ChevronRight, Filter, ArrowDown } from 'lucide-react'
import { cn } from '../lib/utils'
import type { SseStreamEvent } from '../lib/types'

interface SseStreamViewerProps {
  body: string | null
  isStreaming?: boolean
}

const EVENT_COLORS: Record<string, string> = {
  say: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  message: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  tool_call: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  tool_result: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  usage: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  done: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  error: 'bg-red-500/20 text-red-300 border-red-500/30',
  attempt_completion: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
}

function getEventColor(eventType: string): string {
  return EVENT_COLORS[eventType] ?? 'bg-slate-500/20 text-slate-400 border-slate-500/30'
}

function parseSseBody(body: string): SseStreamEvent[] {
  const events: SseStreamEvent[] = []
  const lines = body.split('\n')
  let currentEventType: string | null = null
  let dataLines: string[] = []
  let id = 0

  for (const line of lines) {
    if (line.startsWith('event:')) {
      if (currentEventType && dataLines.length > 0) {
        const raw = dataLines.join('\n')
        let parsed: unknown = null
        try { parsed = JSON.parse(raw) } catch { /* not JSON */ }
        events.push({
          id: id++,
          event_type: currentEventType,
          data: raw,
          parsed_data: parsed,
          timestamp: Date.now(),
        })
        dataLines = []
      }
      currentEventType = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    } else if (line === '' && currentEventType && dataLines.length > 0) {
      const raw = dataLines.join('\n')
      let parsed: unknown = null
      try { parsed = JSON.parse(raw) } catch { /* not JSON */ }
      events.push({
        id: id++,
        event_type: currentEventType,
        data: raw,
        parsed_data: parsed,
        timestamp: Date.now(),
      })
      currentEventType = null
      dataLines = []
    }
  }

  if (currentEventType && dataLines.length > 0) {
    const raw = dataLines.join('\n')
    let parsed: unknown = null
    try { parsed = JSON.parse(raw) } catch { /* not JSON */ }
    events.push({
      id: id++,
      event_type: currentEventType,
      data: raw,
      parsed_data: parsed,
      timestamp: Date.now(),
    })
  }

  return events
}

export function SseStreamViewer({ body, isStreaming = false }: SseStreamViewerProps) {
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState<string>('')
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const events = useMemo(() => body ? parseSseBody(body) : [], [body])
  const eventTypes = useMemo(
    () => [...new Set(events.map(e => e.event_type))],
    [events],
  )

  const filteredEvents = useMemo(
    () => filter ? events.filter(e => e.event_type === filter) : events,
    [events, filter],
  )

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [filteredEvents, autoScroll])

  const toggleEvent = useCallback((id: number) => {
    setExpandedEvents(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  if (!body) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2 p-8">
        <Radio className="w-5 h-5" />
        <p className="text-sm">No SSE events</p>
        <p className="text-xs">Response body does not contain SSE events</p>
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2 p-8">
        <Radio className="w-5 h-5" />
        <p className="text-sm">No SSE events detected</p>
        <p className="text-xs">Response body does not appear to contain SSE-formatted events</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/50 shrink-0">
        <div className="flex items-center gap-1.5">
          {isStreaming && (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-dot" />
              LIVE
            </span>
          )}
          <span className="text-[10px] text-slate-500 font-mono">
            {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex-1" />

        {/* Event type filter */}
        <div className="flex items-center gap-1">
          <Filter className="w-3 h-3 text-slate-500" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700/50 rounded px-1.5 py-0.5 text-[10px] text-slate-300 focus:outline-none focus:border-violet-500/50"
          >
            <option value="">All types</option>
            {eventTypes.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* Auto-scroll toggle */}
        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={cn(
            'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors',
            autoScroll
              ? 'bg-violet-500/10 text-violet-400 border-violet-500/30'
              : 'bg-slate-800 text-slate-500 border-slate-700/50',
          )}
          title={autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
        >
          <ArrowDown className="w-2.5 h-2.5" />
        </button>
      </div>

      {/* Event type summary */}
      <div className="flex flex-wrap gap-1 px-3 py-1.5 border-b border-slate-700/50 shrink-0">
        {eventTypes.map(type => {
          const count = events.filter(e => e.event_type === type).length
          return (
            <button
              key={type}
              onClick={() => setFilter(filter === type ? '' : type)}
              className={cn(
                'sse-event-badge border transition-colors',
                filter === type ? getEventColor(type) : 'bg-slate-800/50 text-slate-500 border-slate-700/50',
              )}
            >
              {type} ({count})
            </button>
          )
        })}
      </div>

      {/* Event list */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        {filteredEvents.map((event, i) => {
          const isExpanded = expandedEvents.has(event.id)
          return (
            <div
              key={event.id}
              className={cn(
                'border-b border-slate-800/50 transition-colors',
                i % 2 === 0 ? 'bg-slate-900/30' : 'bg-slate-900/10',
              )}
            >
              {/* Event header */}
              <div
                className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-slate-800/30"
                onClick={() => toggleEvent(event.id)}
              >
                {isExpanded
                  ? <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" />
                  : <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
                }
                <span className="text-[10px] text-slate-600 font-mono w-5 text-right shrink-0">
                  {event.id}
                </span>
                <span className={cn('sse-event-badge border', getEventColor(event.event_type))}>
                  {event.event_type}
                </span>
                <span className="text-[10px] text-slate-600 truncate flex-1 font-mono">
                  {event.data.length > 80 ? event.data.slice(0, 80) + '...' : event.data}
                </span>
              </div>

              {/* Expanded data */}
              {isExpanded && (
                <div className="px-3 pb-2 ml-8">
                  {event.parsed_data != null ? (
                    <pre className="bg-slate-900/50 border border-slate-700/50 rounded p-2 text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(event.parsed_data, null, 2)}
                    </pre>
                  ) : (
                    <pre className="bg-slate-900/50 border border-slate-700/50 rounded p-2 text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap">
                      {event.data}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
