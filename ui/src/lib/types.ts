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

// Environment types (backend API)
export interface Environment {
	name: string
	variables: Record<string, string>
}

export interface EnvironmentListItem {
	name: string
	variable_count: number
}

// ── Client-side Environment Management ─────────────
export interface MuonEnvironment {
	id: string
	name: string
	variables: EnvironmentVariable[]
	created_at: string
	updated_at: string
}

export interface EnvironmentVariable {
	key: string
	value: string
	enabled: boolean
}

// Validation
export interface ValidationResult {
	valid: boolean
	errors: string[]
}

// Key-value pair for editors
export interface KeyValuePair {
	key: string
	value: string
	enabled: boolean
}

// HTTP methods
export const HTTP_METHODS = [
	'GET',
	'POST',
	'PUT',
	'DELETE',
	'PATCH',
	'HEAD',
	'OPTIONS',
] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

// Content types for body
export const CONTENT_TYPES = [
	'application/json',
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain',
	'application/xml',
] as const

// ── Ad-hoc HTTP Request Builder ──────────────────────

export interface HttpRequestConfig {
	method: HttpMethod
	url: string
	headers: KeyValuePair[]
	params: KeyValuePair[]
	bodyType: 'none' | 'json' | 'form' | 'raw'
	bodyContent: string
	formData: KeyValuePair[]
	timeoutSecs: number
}

export interface HttpResponseData {
	status: number
	status_text: string
	headers: Record<string, string>
	body: string
	duration_ms: number
	size_bytes: number
}

export interface SavedRequest {
	id: string
	name: string
	config: HttpRequestConfig
	timestamp: string
}

// ── Request History ─────────────────────────────────

export interface RequestHistoryEntry {
	id: string
	config: HttpRequestConfig
	response: HttpResponseData | null
	error: string | null
	timestamp: string
}

export const DEFAULT_REQUEST: HttpRequestConfig = {
	method: 'GET',
	url: '',
	headers: [{ key: '', value: '', enabled: true }],
	params: [{ key: '', value: '', enabled: true }],
	bodyType: 'none',
	bodyContent: '',
	formData: [{ key: '', value: '', enabled: true }],
	timeoutSecs: 30,
}

// ── Collections ─────────────────────────────────────

export interface Collection {
	id: string
	name: string
	description: string
	items: CollectionItem[]
	variables: Record<string, string>
	created_at: string
	updated_at: string
}

export type CollectionItem = CollectionFolder | CollectionRequest

export interface CollectionFolder {
	type: 'folder'
	id: string
	name: string
	items: CollectionItem[]
}

export interface CollectionRequest {
	type: 'request'
	id: string
	name: string
	config: HttpRequestConfig
	response?: HttpResponseData | null
}

export interface BatchRunResult {
	request_id: string
	name: string
	response: HttpResponseData | null
	error: string | null
	duration_ms: number
}

// Step editor tab types
export type StepEditorTab =
	| 'params'
	| 'headers'
	| 'body'
	| 'auth'
	| 'tests'
	| 'variables'
export type ResponseViewerTab =
	| 'pretty'
	| 'tree'
	| 'raw'
	| 'headers'
	| 'tests'
	| 'sse'

// SSE streaming types
export interface SseStreamEvent {
	id: number
	event_type: string
	data: string
	parsed_data: unknown | null
	timestamp: number
}

// Test assertion result
export interface AssertionResult {
	expression: string
	expected: unknown
	actual: unknown
	passed: boolean
}
