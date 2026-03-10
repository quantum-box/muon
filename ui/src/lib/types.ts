export interface ScenarioSummary {
  id: string
  name: string
  description: string
  tags: string[]
  step_count: number
  file_path: string
  last_run: LastRun | null
}

export interface LastRun {
  id: string
  success: boolean
  duration_ms: number
  timestamp: string
}

export interface ScenarioDetail {
  id: string
  name: string
  description: string
  tags: string[]
  file_path: string
  scenario: ScenarioDefinition
}

export interface ScenarioDefinition {
  name: string
  steps: StepDefinition[]
  vars: Record<string, unknown>
  config: ScenarioConfig
}

export interface ScenarioConfig {
  base_url: string
  timeout: number
}

export interface StepDefinition {
  name: string
  request: StepRequest
  expect: StepExpect
  save?: Record<string, string>
}

export interface StepRequest {
  method: string
  url: string
  headers: Record<string, string>
  query: Record<string, string>
  body?: unknown
}

export interface StepExpect {
  status: number
  json?: unknown
  headers?: Record<string, string>
}

export interface StepResult {
  name: string
  success: boolean
  error: string | null
  request: {
    method: string
    url: string
    headers: Record<string, string>
    body: string | null
  }
  response: {
    status: number
    headers: Record<string, string>
    body: string | null
  }
  duration_ms: number
}

export interface ScenarioResult {
  name: string
  success: boolean
  steps: StepResult[]
  duration_ms: number
}

// SSE event types
export type RunEvent =
  | { type: 'scenario_started'; name: string; step_count: number }
  | { type: 'step_started'; index: number; name: string }
  | { type: 'step_completed'; index: number; result: StepResult }
  | { type: 'variable_updated'; key: string; value: string }
  | { type: 'scenario_completed'; result: ScenarioResult }

export type StepStatus = 'pending' | 'running' | 'passed' | 'failed'

export interface RunState {
  status: 'idle' | 'running' | 'completed' | 'error'
  stepStatuses: StepStatus[]
  stepResults: (StepResult | null)[]
  variables: Record<string, string>
  result: ScenarioResult | null
  error: string | null
  currentStepIndex: number | null
}

export interface RunHistoryEntry {
  id: string
  scenario_id: string
  status: string
  started_at: string
  result: ScenarioResult | null
}
