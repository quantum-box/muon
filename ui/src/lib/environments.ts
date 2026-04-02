import type { EnvironmentVariable, MuonEnvironment } from './types'

const ENVS_KEY = 'muon_environments'
const ACTIVE_ENV_KEY = 'muon_active_environment'

// ── CRUD ────────────────────────────────────────────

export function getEnvironments(): MuonEnvironment[] {
	try {
		const raw = localStorage.getItem(ENVS_KEY)
		return raw ? (JSON.parse(raw) as MuonEnvironment[]) : []
	} catch {
		return []
	}
}

function saveEnvironments(envs: MuonEnvironment[]): void {
	localStorage.setItem(ENVS_KEY, JSON.stringify(envs))
}

export function getEnvironmentById(id: string): MuonEnvironment | undefined {
	return getEnvironments().find(e => e.id === id)
}

export function createEnvironment(
	name: string,
	variables: EnvironmentVariable[] = [],
): MuonEnvironment {
	const now = new Date().toISOString()
	const env: MuonEnvironment = {
		id: crypto.randomUUID(),
		name,
		variables,
		created_at: now,
		updated_at: now,
	}
	const envs = getEnvironments()
	envs.push(env)
	saveEnvironments(envs)
	return env
}

export function updateEnvironmentStore(
	id: string,
	patch: Partial<Pick<MuonEnvironment, 'name' | 'variables'>>,
): MuonEnvironment | null {
	const envs = getEnvironments()
	const idx = envs.findIndex(e => e.id === id)
	if (idx < 0) return null
	const current = envs[idx]!
	envs[idx] = {
		id: current.id,
		name: patch.name ?? current.name,
		variables: patch.variables ?? current.variables,
		created_at: current.created_at,
		updated_at: new Date().toISOString(),
	}
	saveEnvironments(envs)
	return envs[idx]
}

export function deleteEnvironmentStore(id: string): void {
	const envs = getEnvironments().filter(e => e.id !== id)
	saveEnvironments(envs)
	if (getActiveEnvironmentId() === id) {
		clearActiveEnvironment()
	}
}

export function duplicateEnvironment(id: string): MuonEnvironment | null {
	const source = getEnvironmentById(id)
	if (!source) return null
	return createEnvironment(
		`${source.name} (copy)`,
		source.variables.map(v => ({ key: v.key, value: v.value, enabled: v.enabled })),
	)
}

// ── Active environment ──────────────────────────────

export function getActiveEnvironmentId(): string | null {
	return localStorage.getItem(ACTIVE_ENV_KEY)
}

export function setActiveEnvironmentId(id: string | null): void {
	if (id) {
		localStorage.setItem(ACTIVE_ENV_KEY, id)
	} else {
		localStorage.removeItem(ACTIVE_ENV_KEY)
	}
}

export function clearActiveEnvironment(): void {
	localStorage.removeItem(ACTIVE_ENV_KEY)
}

export function getActiveEnvironment(): MuonEnvironment | null {
	const id = getActiveEnvironmentId()
	if (!id) return null
	return getEnvironmentById(id) ?? null
}

// ── Variable resolution ─────────────────────────────

export function getActiveVariables(): Record<string, string> {
	const env = getActiveEnvironment()
	if (!env) return {}
	const vars: Record<string, string> = {}
	for (const v of env.variables) {
		if (v.enabled && v.key.trim()) {
			vars[v.key] = v.value
		}
	}
	return vars
}

/**
 * Expand `{{variable}}` patterns in a string using active environment variables.
 * Supports `{{ variable }}` with optional whitespace.
 * Unresolved variables are left as-is.
 */
export function expandVariables(
	text: string,
	vars: Record<string, string>,
): string {
	return text.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, key: string): string => {
		return key in vars ? (vars[key] ?? match) : match
	})
}

/**
 * Expand variables in all fields of an HttpRequestConfig.
 * Returns a new object (does not mutate input).
 */
export function expandConfigVariables<
	T extends {
		url: string
		headers: { key: string; value: string; enabled: boolean }[]
		params: { key: string; value: string; enabled: boolean }[]
		bodyContent: string
		formData: { key: string; value: string; enabled: boolean }[]
	},
>(config: T, vars: Record<string, string>): T {
	if (Object.keys(vars).length === 0) return config
	const ex = (s: string) => expandVariables(s, vars)
	const exPairs = (
		pairs: { key: string; value: string; enabled: boolean }[],
	) => pairs.map(p => ({ ...p, key: ex(p.key), value: ex(p.value) }))

	return {
		...config,
		url: ex(config.url),
		headers: exPairs(config.headers),
		params: exPairs(config.params),
		bodyContent: ex(config.bodyContent),
		formData: exPairs(config.formData),
	}
}

// ── .env file parsing ───────────────────────────────

/**
 * Parse a .env file content into EnvironmentVariable[].
 * Supports:
 * - KEY=value
 * - KEY="quoted value"
 * - KEY='single quoted'
 * - # comments
 * - Empty lines
 * - export KEY=value
 */
export function parseDotEnv(content: string): EnvironmentVariable[] {
	const vars: EnvironmentVariable[] = []
	for (const rawLine of content.split('\n')) {
		const line = rawLine.trim()
		if (!line || line.startsWith('#')) continue

		// Strip optional "export " prefix
		const stripped = line.startsWith('export ')
			? line.slice(7).trim()
			: line

		const eqIndex = stripped.indexOf('=')
		if (eqIndex < 1) continue

		const key = stripped.slice(0, eqIndex).trim()
		let value = stripped.slice(eqIndex + 1).trim()

		// Remove surrounding quotes
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1)
		}

		vars.push({ key, value, enabled: true })
	}
	return vars
}
