import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { collectFlowFiles, loadFlowFile } from './files'

const root = mkdtempSync(path.join(tmpdir(), 'muon-web-e2e-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('collectFlowFiles', () => {
	it('finds yaml files recursively, skipping _ prefixed entries', () => {
		mkdirSync(path.join(root, 'nested'), { recursive: true })
		mkdirSync(path.join(root, '_shared'), { recursive: true })
		writeFileSync(path.join(root, 'b.yaml'), '- back\n')
		writeFileSync(path.join(root, 'a.yml'), '- back\n')
		writeFileSync(path.join(root, 'nested', 'c.yaml'), '- back\n')
		writeFileSync(path.join(root, '_sub.yaml'), '- back\n')
		writeFileSync(path.join(root, '_shared', 'd.yaml'), '- back\n')
		writeFileSync(path.join(root, 'readme.md'), 'not a flow\n')

		const files = collectFlowFiles(root).map(file => path.relative(root, file))
		expect(files).toEqual(['a.yml', 'b.yaml', path.join('nested', 'c.yaml')])
	})
})

describe('loadFlowFile', () => {
	it('parses a flow file with its absolute path attached', () => {
		const filePath = path.join(root, 'flow.yaml')
		writeFileSync(filePath, 'url: /\n---\n- launchApp\n')
		const flow = loadFlowFile(filePath)
		expect(flow.filePath).toBe(filePath)
		expect(flow.steps).toEqual([{ type: 'launchApp' }])
	})

	it('reports unreadable files', () => {
		expect(() => loadFlowFile(path.join(root, 'missing.yaml'))).toThrow(
			/failed to read flow file/,
		)
	})
})
