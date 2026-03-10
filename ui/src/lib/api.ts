import type {
  ScenarioSummary,
  ScenarioDetail,
  RunEvent,
  RunHistoryEntry,
  Environment,
  EnvironmentListItem,
  ValidationResult,
} from './types'

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

// Scenario CRUD
export async function createScenario(data: {
  name: string
  yaml: string
}): Promise<ScenarioDetail> {
  const res = await fetch(`${BASE}/api/scenarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`Failed to create scenario: ${res.status}`)
  return res.json()
}

export async function updateScenario(
  id: string,
  data: Partial<{ name: string; yaml: string; steps: unknown[] }>,
): Promise<ScenarioDetail> {
  const res = await fetch(`${BASE}/api/scenarios/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`Failed to update scenario: ${res.status}`)
  return res.json()
}

export async function deleteScenario(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/scenarios/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`Failed to delete scenario: ${res.status}`)
}

// Environment CRUD
export async function listEnvironments(): Promise<EnvironmentListItem[]> {
  const res = await fetch(`${BASE}/api/environments`)
  if (!res.ok) throw new Error(`Failed to fetch environments: ${res.status}`)
  return res.json()
}

export async function getEnvironment(name: string): Promise<Environment> {
  const res = await fetch(`${BASE}/api/environments/${encodeURIComponent(name)}`)
  if (!res.ok) throw new Error(`Failed to fetch environment: ${res.status}`)
  return res.json()
}

export async function updateEnvironment(
  name: string,
  data: { variables: Record<string, string> },
): Promise<Environment> {
  const res = await fetch(`${BASE}/api/environments/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`Failed to update environment: ${res.status}`)
  return res.json()
}

export async function deleteEnvironment(name: string): Promise<void> {
  const res = await fetch(`${BASE}/api/environments/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`Failed to delete environment: ${res.status}`)
}

// Validation
export async function validateYaml(yaml: string): Promise<ValidationResult> {
  const res = await fetch(`${BASE}/api/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ yaml }),
  })
  if (!res.ok) throw new Error(`Validation request failed: ${res.status}`)
  return res.json()
}
