import type { ScenarioSummary, ScenarioDetail, RunEvent, RunHistoryEntry } from './types'

const BASE = ''

export async function fetchScenarios(): Promise<ScenarioSummary[]> {
  const res = await fetch(`${BASE}/api/scenarios`)
  if (!res.ok) throw new Error(`Failed to fetch scenarios: ${res.status}`)
  return res.json()
}

export async function fetchScenario(id: string): Promise<ScenarioDetail> {
  const res = await fetch(`${BASE}/api/scenarios/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`Failed to fetch scenario: ${res.status}`)
  return res.json()
}

export async function fetchRuns(): Promise<RunHistoryEntry[]> {
  const res = await fetch(`${BASE}/api/runs`)
  if (!res.ok) throw new Error(`Failed to fetch runs: ${res.status}`)
  return res.json()
}

export function runScenario(
  id: string,
  onEvent: (event: RunEvent) => void,
  onError: (error: string) => void,
  onDone: () => void,
): () => void {
  const controller = new AbortController()

  ;(async () => {
    try {
      const res = await fetch(`${BASE}/api/scenarios/${encodeURIComponent(id)}/run`, {
        method: 'POST',
        signal: controller.signal,
      })

      if (!res.ok) {
        onError(`Run failed: ${res.status} ${res.statusText}`)
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        onError('No response body')
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        let dataBuffer = ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            dataBuffer += line.slice(6)
          } else if (line === '' && dataBuffer) {
            try {
              const event = JSON.parse(dataBuffer) as RunEvent
              onEvent(event)
            } catch {
              // skip malformed JSON
            }
            dataBuffer = ''
          } else if (line.startsWith('event:')) {
            // event type line, reset data buffer
            dataBuffer = ''
          }
        }
      }

      onDone()
    } catch (err) {
      if (controller.signal.aborted) return
      onError(err instanceof Error ? err.message : 'Unknown error')
    }
  })()

  return () => controller.abort()
}
