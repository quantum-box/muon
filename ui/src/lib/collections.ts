// Collection storage and conversion utilities

import type {
	Collection,
	CollectionFolder,
	CollectionItem,
	CollectionRequest,
	HttpRequestConfig,
	KeyValuePair,
} from './types'
import { DEFAULT_REQUEST } from './types'

const COLLECTIONS_KEY = 'muon_collections'

// ── CRUD ────────────────────────────────────────────

export function getCollections(): Collection[] {
	try {
		const raw = localStorage.getItem(COLLECTIONS_KEY)
		return raw ? (JSON.parse(raw) as Collection[]) : []
	} catch {
		return []
	}
}

export function saveCollections(collections: Collection[]): void {
	localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections))
}

export function getCollection(id: string): Collection | undefined {
	return getCollections().find(c => c.id === id)
}

export function saveCollection(collection: Collection): void {
	const collections = getCollections()
	const idx = collections.findIndex(c => c.id === collection.id)
	if (idx >= 0) {
		collections[idx] = { ...collection, updated_at: new Date().toISOString() }
	} else {
		collections.push(collection)
	}
	saveCollections(collections)
}

export function deleteCollection(id: string): void {
	saveCollections(getCollections().filter(c => c.id !== id))
}

export function uid(): string {
	return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createEmptyCollection(name: string): Collection {
	const now = new Date().toISOString()
	return {
		id: uid(),
		name,
		description: '',
		items: [],
		variables: {},
		created_at: now,
		updated_at: now,
	}
}

export function createFolder(name: string): CollectionFolder {
	return { type: 'folder', id: uid(), name, items: [] }
}

export function createRequest(name: string): CollectionRequest {
	return {
		type: 'request',
		id: uid(),
		name,
		config: JSON.parse(JSON.stringify(DEFAULT_REQUEST)),
	}
}

// ── Tree helpers ────────────────────────────────────

export function findItemById(
	items: CollectionItem[],
	id: string,
): CollectionItem | null {
	for (const item of items) {
		if (item.id === id) return item
		if (item.type === 'folder') {
			const found = findItemById(item.items, id)
			if (found) return found
		}
	}
	return null
}

export function removeItemById(
	items: CollectionItem[],
	id: string,
): CollectionItem[] {
	return items
		.filter(item => item.id !== id)
		.map(item =>
			item.type === 'folder'
				? { ...item, items: removeItemById(item.items, id) }
				: item,
		)
}

export function addItemToFolder(
	items: CollectionItem[],
	folderId: string,
	newItem: CollectionItem,
): CollectionItem[] {
	return items.map(item => {
		if (item.id === folderId && item.type === 'folder') {
			return { ...item, items: [...item.items, newItem] }
		}
		if (item.type === 'folder') {
			return { ...item, items: addItemToFolder(item.items, folderId, newItem) }
		}
		return item
	})
}

export function updateItemInTree(
	items: CollectionItem[],
	id: string,
	updater: (item: CollectionItem) => CollectionItem,
): CollectionItem[] {
	return items.map(item => {
		if (item.id === id) return updater(item)
		if (item.type === 'folder') {
			return { ...item, items: updateItemInTree(item.items, id, updater) }
		}
		return item
	})
}

export function flattenRequests(items: CollectionItem[]): CollectionRequest[] {
	const result: CollectionRequest[] = []
	for (const item of items) {
		if (item.type === 'request') result.push(item)
		else result.push(...flattenRequests(item.items))
	}
	return result
}

// ── Postman Import ──────────────────────────────────

interface PostmanCollection {
	info: { name: string; description?: string }
	item: PostmanItem[]
	variable?: { key: string; value?: string }[]
}

interface PostmanItem {
	name: string
	item?: PostmanItem[]
	request?: PostmanRequestDef
}

interface PostmanRequestDef {
	method: string
	url: PostmanUrl | string
	header?: { key: string; value: string }[]
	body?: { mode?: string; raw?: string }
}

type PostmanUrl =
	| string
	| { raw: string; query?: { key: string; value?: string }[] }

function parsePostmanUrl(url: PostmanUrl): {
	raw: string
	params: KeyValuePair[]
} {
	if (typeof url === 'string') return { raw: url, params: [] }
	const params: KeyValuePair[] = (url.query ?? []).map(q => ({
		key: q.key,
		value: q.value ?? '',
		enabled: true,
	}))
	return { raw: url.raw, params }
}

function convertPostmanItem(item: PostmanItem): CollectionItem {
	if (item.item) {
		return {
			type: 'folder',
			id: uid(),
			name: item.name,
			items: item.item.map(convertPostmanItem),
		}
	}

	const req = item.request
	if (!req) {
		return createRequest(item.name)
	}

	const { raw, params } = parsePostmanUrl(req.url)
	const headers: KeyValuePair[] = (req.header ?? []).map(h => ({
		key: h.key,
		value: h.value,
		enabled: true,
	}))
	if (headers.length === 0) headers.push({ key: '', value: '', enabled: true })
	if (params.length === 0) params.push({ key: '', value: '', enabled: true })

	const bodyContent = req.body?.raw ?? ''
	const bodyType = req.body?.mode === 'raw' && bodyContent ? 'json' : 'none'

	const config: HttpRequestConfig = {
		method: (req.method?.toUpperCase() ?? 'GET') as HttpRequestConfig['method'],
		url: raw,
		headers,
		params,
		bodyType: bodyType as HttpRequestConfig['bodyType'],
		bodyContent,
		formData: [{ key: '', value: '', enabled: true }],
		timeoutSecs: 30,
	}

	return {
		type: 'request',
		id: uid(),
		name: item.name,
		config,
	}
}

export function importPostmanCollection(jsonStr: string): Collection {
	const raw = JSON.parse(jsonStr) as PostmanCollection
	const variables: Record<string, string> = {}
	for (const v of raw.variable ?? []) {
		if (v.value) variables[v.key] = v.value
	}

	const now = new Date().toISOString()
	return {
		id: uid(),
		name: raw.info.name,
		description: raw.info.description ?? '',
		items: raw.item.map(convertPostmanItem),
		variables,
		created_at: now,
		updated_at: now,
	}
}

// ── Postman Export ───────────────────────────────────

function collectionItemToPostman(item: CollectionItem): unknown {
	if (item.type === 'folder') {
		return {
			name: item.name,
			item: item.items.map(collectionItemToPostman),
		}
	}

	const cfg = item.config
	const headers = cfg.headers
		.filter(h => h.enabled && h.key.trim())
		.map(h => ({ key: h.key, value: h.value }))
	const query = cfg.params
		.filter(p => p.enabled && p.key.trim())
		.map(p => ({ key: p.key, value: p.value }))

	const body =
		cfg.bodyType !== 'none' && cfg.bodyContent
			? { mode: 'raw', raw: cfg.bodyContent }
			: undefined

	return {
		name: item.name,
		request: {
			method: cfg.method,
			url: { raw: cfg.url, query },
			header: headers,
			...(body ? { body } : {}),
		},
	}
}

export function exportPostmanCollection(collection: Collection): string {
	const postman = {
		info: {
			name: collection.name,
			description: collection.description,
			schema:
				'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
		},
		item: collection.items.map(collectionItemToPostman),
		variable: Object.entries(collection.variables).map(([key, value]) => ({
			key,
			value,
		})),
	}
	return JSON.stringify(postman, null, 2)
}

// ── Muon Scenario Conversion ────────────────────────

interface MuonScenarioYaml {
	name: string
	description?: string
	tags?: string[]
	config?: { base_url?: string; timeout?: number }
	vars?: Record<string, unknown>
	steps: MuonStep[]
}

interface MuonStep {
	name: string
	id?: string
	request: {
		method: string
		url: string
		headers?: Record<string, string>
		query?: Record<string, string>
		body?: unknown
	}
	expect?: {
		status?: number
		json?: Record<string, unknown>
		headers?: Record<string, string>
	}
	save?: Record<string, string>
}

export function collectionToScenarioYaml(
	collection: Collection,
	folderId?: string,
): string {
	let items: CollectionItem[]
	let name: string
	if (folderId) {
		const folder = findItemById(collection.items, folderId)
		if (folder && folder.type === 'folder') {
			items = folder.items
			name = folder.name
		} else {
			items = collection.items
			name = collection.name
		}
	} else {
		items = collection.items
		name = collection.name
	}

	const requests = flattenRequests(items)

	const scenario: MuonScenarioYaml = {
		name,
		description: collection.description || undefined,
		tags: ['collection-export'],
		steps: requests.map((req, i) => {
			const cfg = req.config
			const headers: Record<string, string> = {}
			for (const h of cfg.headers) {
				if (h.enabled && h.key.trim()) headers[h.key] = h.value
			}
			const query: Record<string, string> = {}
			for (const p of cfg.params) {
				if (p.enabled && p.key.trim()) query[p.key] = p.value
			}

			let body: unknown = undefined
			if (cfg.bodyType === 'json' && cfg.bodyContent) {
				try {
					body = JSON.parse(cfg.bodyContent)
				} catch {
					body = cfg.bodyContent
				}
			}

			const step: MuonStep = {
				name: req.name,
				id: `step_${i + 1}`,
				request: {
					method: cfg.method,
					url: cfg.url,
					...(Object.keys(headers).length > 0 ? { headers } : {}),
					...(Object.keys(query).length > 0 ? { query } : {}),
					...(body !== undefined ? { body } : {}),
				},
				expect: { status: 200 },
			}
			return step
		}),
	}

	if (Object.keys(collection.variables).length > 0) {
		scenario.vars = collection.variables
	}

	// Manual YAML serialization to keep it clean
	return toYaml(scenario)
}

function toYaml(obj: unknown, indent = 0): string {
	const pad = '  '.repeat(indent)
	if (obj === null || obj === undefined) return 'null'
	if (typeof obj === 'string') {
		if (obj.includes('\n') || obj.includes(': ') || obj.includes('#')) {
			return `"${obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
		}
		return obj
	}
	if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj)
	if (Array.isArray(obj)) {
		if (obj.length === 0) return '[]'
		return obj
			.map(item => {
				const val = toYaml(item, indent + 1)
				if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
					const lines = val.split('\n')
					return `${pad}- ${lines[0]}\n${lines
						.slice(1)
						.map(l => `${pad}  ${l}`)
						.join('\n')}`
				}
				return `${pad}- ${val}`
			})
			.join('\n')
	}
	if (typeof obj === 'object') {
		const entries = Object.entries(obj as Record<string, unknown>).filter(
			([, v]) => v !== undefined,
		)
		if (entries.length === 0) return '{}'
		return entries
			.map(([key, val]) => {
				if (typeof val === 'object' && val !== null) {
					return `${pad}${key}:\n${toYaml(val, indent + 1)}`
				}
				return `${pad}${key}: ${toYaml(val, indent + 1)}`
			})
			.join('\n')
	}
	return String(obj)
}

export function scenarioYamlToCollection(
	yamlStr: string,
	collectionName?: string,
): Collection {
	// Try JSON parse first, fall back to empty scenario
	const scenario = parseScenarioInput(yamlStr)

	const name = collectionName ?? scenario.name ?? 'Imported Scenario'
	const items: CollectionItem[] = (scenario.steps ?? []).map(
		(step: MuonStep) => {
			const headers: KeyValuePair[] = Object.entries(
				step.request.headers ?? {},
			).map(([k, v]) => ({ key: k, value: String(v), enabled: true }))
			if (headers.length === 0)
				headers.push({ key: '', value: '', enabled: true })

			const params: KeyValuePair[] = Object.entries(
				step.request.query ?? {},
			).map(([k, v]) => ({ key: k, value: String(v), enabled: true }))
			if (params.length === 0)
				params.push({ key: '', value: '', enabled: true })

			const bodyContent = step.request.body
				? JSON.stringify(step.request.body, null, 2)
				: ''

			const config: HttpRequestConfig = {
				method: (step.request.method?.toUpperCase() ??
					'GET') as HttpRequestConfig['method'],
				url: step.request.url,
				headers,
				params,
				bodyType: bodyContent ? 'json' : 'none',
				bodyContent,
				formData: [{ key: '', value: '', enabled: true }],
				timeoutSecs: 30,
			}

			return {
				type: 'request' as const,
				id: uid(),
				name: step.name,
				config,
			}
		},
	)

	const vars = (scenario.vars ?? {}) as Record<string, unknown>
	const variables: Record<string, string> = {}
	for (const [k, v] of Object.entries(vars)) {
		variables[k] = String(v)
	}

	const now = new Date().toISOString()
	return {
		id: uid(),
		name,
		description: scenario.description ?? '',
		items,
		variables,
		created_at: now,
		updated_at: now,
	}
}

// Parse scenario input (JSON only; YAML requires server-side parsing)
function parseScenarioInput(input: string): MuonScenarioYaml {
	try {
		return JSON.parse(input) as MuonScenarioYaml
	} catch {
		return { name: 'Imported Scenario', steps: [] }
	}
}
