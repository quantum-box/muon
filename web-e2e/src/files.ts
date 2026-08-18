import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { parseFlow } from './parse'
import { type Flow, FlowError } from './types'

const FLOW_EXTENSIONS = new Set(['.yaml', '.yml'])

/** Read and parse a single flow file. */
export function loadFlowFile(filePath: string): Flow {
	const absolute = path.resolve(filePath)
	let source: string
	try {
		source = readFileSync(absolute, 'utf8')
	} catch (error) {
		throw new FlowError(
			`failed to read flow file: ${error instanceof Error ? error.message : String(error)}`,
			absolute,
		)
	}
	return parseFlow(source, absolute)
}

/**
 * Collect flow files under `dir` (recursively), sorted by path. Files and
 * directories starting with `_` are treated as subflows / shared fragments
 * and are not registered as tests.
 */
export function collectFlowFiles(dir: string): string[] {
	const out: string[] = []
	const walk = (current: string) => {
		const entries = readdirSync(current, { withFileTypes: true })
		for (const entry of entries) {
			if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue
			const entryPath = path.join(current, entry.name)
			if (entry.isDirectory()) {
				walk(entryPath)
			} else if (FLOW_EXTENSIONS.has(path.extname(entry.name))) {
				out.push(entryPath)
			}
		}
	}
	walk(path.resolve(dir))
	return out.sort()
}
