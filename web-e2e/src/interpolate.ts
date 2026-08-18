import { FlowError } from './types.js'

const VAR_PATTERN = /\$\{([A-Za-z0-9_.]+)\}/g

/** Replace `${VAR}` references. Unknown variables are an error, like Maestro. */
export function interpolate(
	value: string,
	vars: Record<string, string | undefined>,
): string {
	return value.replace(VAR_PATTERN, (_, name: string) => {
		const resolved = vars[name]
		if (resolved === undefined) {
			throw new FlowError(`undefined variable \${${name}}`)
		}
		return resolved
	})
}

/**
 * Deep-copy `value`, interpolating every string leaf. Steps are resolved
 * with this right before execution so runtime variables (e.g.
 * `maestro.copiedText`) are always fresh.
 */
export function deepInterpolate<T>(
	value: T,
	vars: Record<string, string | undefined>,
): T {
	if (typeof value === 'string') {
		return interpolate(value, vars) as T
	}
	if (Array.isArray(value)) {
		return value.map(item => deepInterpolate(item, vars)) as T
	}
	if (value !== null && typeof value === 'object') {
		const out: Record<string, unknown> = {}
		for (const [key, entry] of Object.entries(value)) {
			out[key] = deepInterpolate(entry, vars)
		}
		return out as T
	}
	return value
}
