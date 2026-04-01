import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useSyncExternalStore,
} from 'react'
import {
	getActiveEnvironmentId,
	getEnvironments,
	setActiveEnvironmentId,
} from '../lib/environments'
import type { MuonEnvironment } from '../lib/types'

// External store pattern for syncing localStorage across components

let listeners: Array<() => void> = []

function emitChange() {
	for (const listener of listeners) {
		listener()
	}
}

function subscribe(listener: () => void) {
	listeners = [...listeners, listener]
	return () => {
		listeners = listeners.filter(l => l !== listener)
	}
}

// Snapshot caches to avoid unnecessary re-renders
let cachedEnvs: MuonEnvironment[] | null = null
let cachedEnvsJson = ''

function getEnvsSnapshot(): MuonEnvironment[] {
	const envs = getEnvironments()
	const json = JSON.stringify(envs)
	if (json !== cachedEnvsJson) {
		cachedEnvsJson = json
		cachedEnvs = envs
	}
	return cachedEnvs!
}

let cachedActiveId: string | null | undefined = undefined
let cachedActiveIdRaw = ''

function getActiveIdSnapshot(): string | null {
	const id = getActiveEnvironmentId()
	const raw = id ?? '__null__'
	if (raw !== cachedActiveIdRaw) {
		cachedActiveIdRaw = raw
		cachedActiveId = id
	}
	return cachedActiveId!
}

/** Notify all hooks that environment data has changed. */
export function notifyEnvironmentChange() {
	emitChange()
}

export function useEnvironments() {
	const environments = useSyncExternalStore(subscribe, getEnvsSnapshot)
	const activeId = useSyncExternalStore(subscribe, getActiveIdSnapshot)

	const activeEnvironment = useMemo(
		() => environments.find(e => e.id === activeId) ?? null,
		[environments, activeId],
	)

	const activeVariables = useMemo(() => {
		if (!activeEnvironment) return {}
		const vars: Record<string, string> = {}
		for (const v of activeEnvironment.variables) {
			if (v.enabled && v.key.trim()) {
				vars[v.key] = v.value
			}
		}
		return vars
	}, [activeEnvironment])

	const setActive = useCallback((id: string | null) => {
		setActiveEnvironmentId(id)
		emitChange()
	}, [])

	return {
		environments,
		activeId,
		activeEnvironment,
		activeVariables,
		setActive,
	}
}

// Context for components that need env data without direct hook usage
export const EnvironmentContext = createContext<{
	activeVariables: Record<string, string>
	activeEnvironment: MuonEnvironment | null
}>({
	activeVariables: {},
	activeEnvironment: null,
})

export function useEnvironmentContext() {
	return useContext(EnvironmentContext)
}
