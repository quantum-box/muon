import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { type Browser, type Page, chromium } from '@playwright/test'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { loadFlowFile, parseFlow, runFlow } from '../../src'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtureUrl = pathToFileURL(path.join(here, 'fixtures', 'app.html')).href

let browser: Browser
let page: Page

beforeAll(async () => {
	browser = await chromium.launch()
})
afterAll(async () => {
	await browser?.close()
})
afterEach(async () => {
	await page?.close()
})

async function newPage(): Promise<Page> {
	page = await browser.newPage()
	return page
}

describe('runFlow (real browser)', () => {
	it('executes the fixture login flow end to end', async () => {
		const flow = loadFlowFile(path.join(here, 'flows', 'login.yaml'))
		const attachments: string[] = []
		const optionalFailures: string[] = []
		await runFlow(flow, {
			page: await newPage(),
			env: { FIXTURE_URL: fixtureUrl },
			attach: async name => {
				attachments.push(name)
			},
			log: message => optionalFailures.push(message),
		})
		expect(attachments).toEqual(['done'])
		expect(optionalFailures).toHaveLength(1)
		expect(optionalFailures[0]).toContain('optional step failed')
		// The flow re-filled the email input from ${maestro.copiedText}.
		await expect(
			page.getByTestId('email').inputValue(),
		).resolves.toBe('Welcome e2e@example.com')
	})

	it('fails on assertVisible when the element is missing', async () => {
		const flow = parseFlow(
			[
				'url: ${FIXTURE_URL}',
				'---',
				'- launchApp',
				'- assertVisible:',
				"    text: 'Never rendered'",
				'    timeout: 300',
			].join('\n'),
		)
		await expect(
			runFlow(flow, {
				page: await newPage(),
				env: { FIXTURE_URL: fixtureUrl },
			}),
		).rejects.toThrow()
	})

	it('fails fast on undefined variables', async () => {
		const flow = parseFlow(['---', '- inputText: ${UNDEFINED_VAR}'].join('\n'))
		await expect(
			runFlow(flow, { page: await newPage() }),
		).rejects.toThrow(/undefined variable/)
	})
})
