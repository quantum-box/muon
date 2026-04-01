// Scenario YAML generator from ad-hoc HTTP requests
import type {
  HttpRequestConfig,
  KeyValuePair,
  RequestHistoryEntry,
} from './types'

export interface ScenarioStep {
  id: string
  name: string
  request: {
    method: string
    url: string
    headers?: Record<string, string>
    body?: unknown
  }
  expect: {
    status: number
    json?: Record<string, unknown>
    headers?: Record<string, string>
  }
  bind?: Record<string, string>
}

export interface GeneratedScenario {
  name: string
  description: string
  tags: string[]
  config: {
    base_url: string
    headers?: Record<string, string>
    timeout: number
  }
  steps: ScenarioStep[]
}

// Extract base URL from a full URL
function extractBaseUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return ''
  }
}

// Extract path from a full URL
function extractPath(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

// Convert KeyValuePair[] to Record, filtering enabled entries
function pairsToRecord(pairs: KeyValuePair[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const p of pairs) {
    if (p.enabled && p.key.trim()) {
      result[p.key] = p.value
    }
  }
  return result
}

// Generate a slug-style step ID from a name
function toStepId(name: string, index: number): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  return slug || `step_${index + 1}`
}

// Detect common ID-like patterns in response body
function extractBindableValues(
  body: string,
  stepId: string,
): Record<string, string> {
  const binds: Record<string, string> = {}
  try {
    const parsed = JSON.parse(body)
    if (typeof parsed === 'object' && parsed !== null) {
      findIdFields(parsed, 'current.res.body', stepId, binds)
    }
  } catch {
    // Not JSON, skip
  }
  return binds
}

// Recursively find fields that look like IDs
function findIdFields(
  obj: unknown,
  path: string,
  stepId: string,
  binds: Record<string, string>,
  depth = 0,
): void {
  if (depth > 3 || typeof obj !== 'object' || obj === null) return

  if (Array.isArray(obj)) return

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const fieldPath = `${path}.${key}`
    if (
      typeof value === 'string' &&
      (key === 'id' ||
        key.endsWith('_id') ||
        key.endsWith('Id') ||
        key === 'token' ||
        key === 'slug')
    ) {
      const bindName = key === 'id' ? `${stepId}_id` : key
      binds[bindName] = `"${fieldPath}"`
    } else if (typeof value === 'object' && value !== null) {
      findIdFields(value, fieldPath, stepId, binds, depth + 1)
    }
  }
}

// Generate JSON assertions from response body
function generateJsonAssertions(
  body: string,
  maxFields: number = 5,
): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(body)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    if (Array.isArray(parsed)) return undefined

    const assertions: Record<string, unknown> = {}
    let count = 0

    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (count >= maxFields) break
      // Include simple scalar fields and short strings
      if (typeof value === 'string' && value.length <= 100) {
        assertions[key] = value
        count++
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        assertions[key] = value
        count++
      }
    }

    return Object.keys(assertions).length > 0 ? assertions : undefined
  } catch {
    return undefined
  }
}

// Find common headers across multiple requests
function findCommonHeaders(
  entries: RequestHistoryEntry[],
): Record<string, string> {
  if (entries.length === 0) return {}

  const headerMaps = entries.map((e) => pairsToRecord(e.config.headers))
  const first = headerMaps[0]!
  const common: Record<string, string> = {}

  for (const [key, value] of Object.entries(first)) {
    const lowerKey = key.toLowerCase()
    // Skip content-type as it varies
    if (lowerKey === 'content-type') continue
    if (headerMaps.every((h) => h[key] === value)) {
      common[key] = value
    }
  }

  return common
}

// Detect variables in URL paths that reference previous step outputs
function detectUrlVariables(steps: ScenarioStep[]): ScenarioStep[] {
  const updatedSteps = [...steps]

  for (let i = 1; i < updatedSteps.length; i++) {
    const step = updatedSteps[i]!
    let url = step.request.url

    for (let j = 0; j < i; j++) {
      const prevStep = updatedSteps[j]!
      if (!prevStep.bind) continue

      for (const [bindName] of Object.entries(prevStep.bind)) {
        const uuidPattern =
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
        const ulidPattern = /[0-9a-z]{26}/gi
        const numericIdPattern = /\/(\d+)(?=\/|$)/g

        for (const pattern of [uuidPattern, ulidPattern, numericIdPattern]) {
          const matches = url.match(pattern)
          if (matches) {
            for (const match of matches) {
              const replacement = `{{steps.${prevStep.id}.${bindName}}}`
              url = url.replace(match, replacement)
            }
          }
        }
      }
    }

    updatedSteps[i] = { ...step, request: { ...step.request, url } }
  }

  return updatedSteps
}

// Generate a step name from request config
function generateStepName(config: HttpRequestConfig): string {
  const method = config.method
  const path = extractPath(config.url)
  const segments = path.split('/').filter(Boolean)
  const resource = segments[segments.length - 1] || 'resource'

  const verbMap: Record<string, string> = {
    GET: 'Get',
    POST: 'Create',
    PUT: 'Update',
    PATCH: 'Patch',
    DELETE: 'Delete',
    HEAD: 'Check',
    OPTIONS: 'Options for',
  }

  const verb = verbMap[method] || method
  // Clean resource name
  const cleanResource = resource
    .replace(/[0-9a-f-]{20,}/gi, '') // Remove UUIDs/ULIDs
    .replace(/^\d+$/, '') // Remove numeric IDs
    .replace(/^-|-$/g, '')

  return `${verb} ${cleanResource || 'resource'}`
}

// Main function: convert request history entries to a scenario
export function generateScenario(
  entries: RequestHistoryEntry[],
  options: {
    name?: string
    description?: string
    tags?: string[]
    includeAssertions?: boolean
    includeBinds?: boolean
    assertionFields?: 'all' | 'status-only' | 'custom'
  } = {},
): GeneratedScenario {
  if (entries.length === 0) {
    return {
      name: options.name || 'New Scenario',
      description: options.description || '',
      tags: options.tags || [],
      config: { base_url: '', timeout: 30 },
      steps: [],
    }
  }

  // Determine base URL from first request
  const baseUrl = extractBaseUrl(entries[0]!.config.url)
  const commonHeaders = findCommonHeaders(entries)

  const steps: ScenarioStep[] = entries.map((entry, index) => {
    const stepName = generateStepName(entry.config)
    const stepId = toStepId(stepName, index)

    // Build request
    const entryHeaders = pairsToRecord(entry.config.headers)
    // Remove headers that are in common config
    const stepHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries(entryHeaders)) {
      if (commonHeaders[k] !== v) {
        stepHeaders[k] = v
      }
    }

    let body: unknown = undefined
    if (
      entry.config.bodyType !== 'none' &&
      entry.config.method !== 'GET' &&
      entry.config.method !== 'HEAD'
    ) {
      if (entry.config.bodyType === 'json' && entry.config.bodyContent) {
        try {
          body = JSON.parse(entry.config.bodyContent)
        } catch {
          body = entry.config.bodyContent
        }
      } else if (entry.config.bodyContent) {
        body = entry.config.bodyContent
      }
    }

    // Build expect
    const status = entry.response?.status ?? 200
    const jsonAssertions =
      options.includeAssertions !== false &&
      options.assertionFields !== 'status-only' &&
      entry.response?.body
        ? generateJsonAssertions(entry.response.body)
        : undefined

    // Build binds
    const binds =
      options.includeBinds !== false && entry.response?.body
        ? extractBindableValues(entry.response.body, stepId)
        : undefined

    const step: ScenarioStep = {
      id: stepId,
      name: stepName,
      request: {
        method: entry.config.method,
        url: extractPath(entry.config.url),
        ...(Object.keys(stepHeaders).length > 0
          ? { headers: stepHeaders }
          : {}),
        ...(body !== undefined ? { body } : {}),
      },
      expect: {
        status,
        ...(jsonAssertions ? { json: jsonAssertions } : {}),
      },
      ...(binds && Object.keys(binds).length > 0 ? { bind: binds } : {}),
    }

    return step
  })

  // Try to detect variable references across steps
  const processedSteps =
    options.includeBinds !== false ? detectUrlVariables(steps) : steps

  return {
    name: options.name || 'Generated Scenario',
    description: options.description || 'Auto-generated from request history',
    tags: options.tags || [],
    config: {
      base_url: baseUrl,
      ...(Object.keys(commonHeaders).length > 0
        ? { headers: commonHeaders }
        : {}),
      timeout: 30,
    },
    steps: processedSteps,
  }
}

// Convert GeneratedScenario to YAML string
export function scenarioToYaml(scenario: GeneratedScenario): string {
  const lines: string[] = []

  lines.push(`name: ${yamlString(scenario.name)}`)
  if (scenario.description) {
    lines.push(`description: ${yamlString(scenario.description)}`)
  }
  if (scenario.tags.length > 0) {
    lines.push('tags:')
    for (const tag of scenario.tags) {
      lines.push(`  - ${tag}`)
    }
  }

  lines.push('')
  lines.push('config:')
  lines.push(`  base_url: ${scenario.config.base_url}`)
  if (scenario.config.headers) {
    lines.push('  headers:')
    for (const [k, v] of Object.entries(scenario.config.headers)) {
      lines.push(`    ${k}: ${yamlString(v)}`)
    }
  }
  lines.push(`  timeout: ${scenario.config.timeout}`)

  lines.push('')
  lines.push('steps:')
  for (const step of scenario.steps) {
    lines.push(`  - id: ${step.id}`)
    lines.push(`    name: ${yamlString(step.name)}`)
    lines.push('    request:')
    lines.push(`      method: ${step.request.method}`)
    lines.push(`      url: ${yamlString(step.request.url)}`)
    if (step.request.headers) {
      lines.push('      headers:')
      for (const [k, v] of Object.entries(step.request.headers)) {
        lines.push(`        ${k}: ${yamlString(v)}`)
      }
    }
    if (step.request.body !== undefined) {
      lines.push(`      body:`)
      const bodyYaml = objectToYaml(step.request.body, 8)
      lines.push(bodyYaml)
    }
    lines.push('    expect:')
    lines.push(`      status: ${step.expect.status}`)
    if (step.expect.json) {
      lines.push('      json:')
      const jsonYaml = objectToYaml(step.expect.json, 8)
      lines.push(jsonYaml)
    }
    if (step.expect.headers) {
      lines.push('      headers:')
      for (const [k, v] of Object.entries(step.expect.headers)) {
        lines.push(`        ${k}: ${yamlString(v)}`)
      }
    }
    if (step.bind) {
      lines.push('    bind:')
      for (const [k, v] of Object.entries(step.bind)) {
        lines.push(`      ${k}: ${v}`)
      }
    }
    lines.push('')
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

// YAML string escaping
function yamlString(value: string): string {
  if (
    value.includes(':') ||
    value.includes('#') ||
    value.includes('{') ||
    value.includes('}') ||
    value.includes('[') ||
    value.includes(']') ||
    value.includes('"') ||
    value.includes("'") ||
    value.includes('\n') ||
    value.startsWith(' ') ||
    value.endsWith(' ') ||
    value === '' ||
    value === 'true' ||
    value === 'false' ||
    value === 'null' ||
    /^\d/.test(value)
  ) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return value
}

// Convert a JS object to YAML with indentation
function objectToYaml(obj: unknown, indent: number): string {
  const prefix = ' '.repeat(indent)
  const lines: string[] = []

  if (typeof obj === 'string') {
    lines.push(`${prefix}${yamlString(obj)}`)
  } else if (typeof obj === 'number' || typeof obj === 'boolean') {
    lines.push(`${prefix}${obj}`)
  } else if (obj === null || obj === undefined) {
    lines.push(`${prefix}null`)
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const entries = Object.entries(item as Record<string, unknown>)
        if (entries.length > 0) {
          const [firstKey, firstVal] = entries[0]!
          lines.push(
            `${prefix}- ${firstKey}: ${typeof firstVal === 'object' ? '' : yamlValue(firstVal)}`,
          )
          for (let i = 1; i < entries.length; i++) {
            const [k, v] = entries[i]!
            lines.push(
              `${prefix}  ${k}: ${typeof v === 'object' ? '' : yamlValue(v)}`,
            )
          }
        }
      } else {
        lines.push(`${prefix}- ${yamlValue(item)}`)
      }
    }
  } else if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(
      obj as Record<string, unknown>,
    )) {
      if (typeof value === 'object' && value !== null) {
        lines.push(`${prefix}${key}:`)
        lines.push(objectToYaml(value, indent + 2))
      } else {
        lines.push(`${prefix}${key}: ${yamlValue(value)}`)
      }
    }
  }

  return lines.join('\n')
}

function yamlValue(val: unknown): string {
  if (typeof val === 'string') return yamlString(val)
  if (val === null || val === undefined) return 'null'
  return String(val)
}
