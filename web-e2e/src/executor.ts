import path from 'node:path'
import type { Page } from '@playwright/test'
import { loadFlowFile } from './files.js'
import { deepInterpolate, interpolate } from './interpolate.js'
import { describeSelector, resolveLocator, toTextMatch } from './selector.js'
import { type Flow, type FlowConfig, FlowError, type Step } from './types.js'

/** Variable holding the last `copyTextFrom` result, like Maestro. */
export const COPIED_TEXT_VAR = 'maestro.copiedText'

const DEFAULT_ASSERT_TIMEOUT = 10_000
const DEFAULT_ANIMATION_TIMEOUT = 5_000
const DEFAULT_SCROLL_AMOUNT = 600
const MAX_FLOW_DEPTH = 10

const KEY_ALIASES: Record<string, string> = {
	enter: 'Enter',
	tab: 'Tab',
	space: 'Space',
	escape: 'Escape',
	esc: 'Escape',
	backspace: 'Backspace',
	delete: 'Delete',
	home: 'Home',
	end: 'End',
	pageup: 'PageUp',
	pagedown: 'PageDown',
	'arrow up': 'ArrowUp',
	'arrow down': 'ArrowDown',
	'arrow left': 'ArrowLeft',
	'arrow right': 'ArrowRight',
	arrowup: 'ArrowUp',
	arrowdown: 'ArrowDown',
	arrowleft: 'ArrowLeft',
	arrowright: 'ArrowRight',
}

export interface RunFlowOptions {
	page: Page
	/** Extra variables, highest precedence below runtime-produced ones. */
	env?: Record<string, string>
	/** Receives screenshots; wired to `testInfo.attach` by `defineWebFlows`. */
	attach?: (name: string, body: Buffer, contentType: string) => Promise<void>
	/** Wraps each step; wired to `test.step` by `defineWebFlows`. */
	wrapStep?: (title: string, body: () => Promise<void>) => Promise<void>
	/** Called when an `optional: true` step fails. */
	log?: (message: string) => void
}

interface ExecContext {
	page: Page
	vars: Record<string, string | undefined>
	config: FlowConfig
	filePath: string
	depth: number
	attach?: RunFlowOptions['attach']
	wrapStep?: RunFlowOptions['wrapStep']
	log?: RunFlowOptions['log']
	screenshotCount: number
}

/** Execute a parsed flow against a Playwright page. */
export async function runFlow(
	flow: Flow,
	options: RunFlowOptions,
): Promise<void> {
	const vars: Record<string, string | undefined> = {
		...(process.env as Record<string, string | undefined>),
		...flow.config.env,
		...options.env,
	}
	await runSteps(flow.steps, {
		page: options.page,
		vars,
		config: flow.config,
		filePath: flow.filePath,
		depth: 0,
		attach: options.attach,
		wrapStep: options.wrapStep,
		log: options.log,
		screenshotCount: 0,
	})
}

async function runSteps(steps: Step[], ctx: ExecContext): Promise<void> {
	for (const step of steps) {
		const run = async () => {
			// Interpolate right before execution so runtime variables such as
			// `${maestro.copiedText}` reflect earlier steps.
			const resolved = deepInterpolate(step, ctx.vars)
			try {
				await executeStep(resolved, ctx)
			} catch (error) {
				if (resolved.optional) {
					ctx.log?.(
						`optional step failed, continuing: ${describeStep(resolved)}: ${
							error instanceof Error ? error.message : String(error)
						}`,
					)
					return
				}
				throw error
			}
		}
		const title = describeStep(deepInterpolateSafe(step, ctx.vars))
		if (ctx.wrapStep) {
			await ctx.wrapStep(title, run)
		} else {
			await run()
		}
	}
}

/** Best-effort interpolation for step titles; never throws. */
function deepInterpolateSafe(step: Step, vars: ExecContext['vars']): Step {
	try {
		return deepInterpolate(step, vars)
	} catch {
		return step
	}
}

async function executeStep(step: Step, ctx: ExecContext): Promise<void> {
	const { page } = ctx
	switch (step.type) {
		case 'launchApp': {
			// step.url is already interpolated; the config header is not.
			const url =
				step.url ??
				(ctx.config.url !== undefined
					? interpolate(ctx.config.url, ctx.vars)
					: undefined)
			if (!url) {
				throw new FlowError(
					'launchApp needs a "url" in the flow config header or step params',
					ctx.filePath,
				)
			}
			await page.goto(url, { timeout: step.timeout })
			return
		}
		case 'openLink':
			await page.goto(step.url, { timeout: step.timeout })
			return
		case 'back':
			await page.goBack({ timeout: step.timeout })
			return
		case 'tapOn':
			await resolveLocator(page, step.selector).click({ timeout: step.timeout })
			return
		case 'doubleTapOn':
			await resolveLocator(page, step.selector).dblclick({
				timeout: step.timeout,
			})
			return
		case 'inputText':
			if (step.selector) {
				await resolveLocator(page, step.selector).fill(step.text, {
					timeout: step.timeout,
				})
			} else {
				// Like Maestro, type into the currently focused element.
				await page.keyboard.type(step.text)
			}
			return
		case 'eraseText':
			if (step.selector) {
				await resolveLocator(page, step.selector).fill('', {
					timeout: step.timeout,
				})
			} else if (step.characters !== undefined) {
				for (let i = 0; i < step.characters; i++) {
					await page.keyboard.press('Backspace')
				}
			} else {
				await page.keyboard.press('ControlOrMeta+a')
				await page.keyboard.press('Backspace')
			}
			return
		case 'pressKey':
			await page.keyboard.press(KEY_ALIASES[step.key.toLowerCase()] ?? step.key)
			return
		case 'assertVisible':
			await resolveLocator(page, step.selector).waitFor({
				state: 'visible',
				timeout: step.timeout ?? DEFAULT_ASSERT_TIMEOUT,
			})
			return
		case 'assertNotVisible':
			// 'hidden' also covers elements that are not in the DOM at all.
			await resolveLocator(page, step.selector).waitFor({
				state: 'hidden',
				timeout: step.timeout ?? DEFAULT_ASSERT_TIMEOUT,
			})
			return
		case 'assertTitle':
			await pollText(
				() => page.title(),
				step.pattern,
				step.timeout ?? DEFAULT_ASSERT_TIMEOUT,
				'page title',
				ctx,
			)
			return
		case 'assertUrl':
			await pollText(
				() => Promise.resolve(page.url()),
				step.pattern,
				step.timeout ?? DEFAULT_ASSERT_TIMEOUT,
				'page URL',
				ctx,
			)
			return
		case 'scroll': {
			const amount = step.amount ?? DEFAULT_SCROLL_AMOUNT
			await page.mouse.wheel(0, step.direction === 'up' ? -amount : amount)
			return
		}
		case 'scrollUntilVisible': {
			const locator = resolveLocator(page, step.selector)
			await locator.scrollIntoViewIfNeeded({
				timeout: step.timeout ?? DEFAULT_ASSERT_TIMEOUT,
			})
			await locator.waitFor({
				state: 'visible',
				timeout: step.timeout ?? DEFAULT_ASSERT_TIMEOUT,
			})
			return
		}
		case 'wait':
			await page.waitForTimeout(step.ms)
			return
		case 'waitForAnimationToEnd':
			// Web approximation: wait for the network to go idle, but never fail
			// the flow because a page keeps a connection open.
			await page
				.waitForLoadState('networkidle', {
					timeout: step.timeout ?? DEFAULT_ANIMATION_TIMEOUT,
				})
				.catch(() => {})
			return
		case 'extendedWaitUntil': {
			const timeout = step.timeout ?? DEFAULT_ASSERT_TIMEOUT
			if (step.visible) {
				await resolveLocator(page, step.visible).waitFor({
					state: 'visible',
					timeout,
				})
			}
			if (step.notVisible) {
				await resolveLocator(page, step.notVisible).waitFor({
					state: 'hidden',
					timeout,
				})
			}
			return
		}
		case 'takeScreenshot': {
			ctx.screenshotCount += 1
			const body = await page.screenshot({
				fullPage: true,
				timeout: step.timeout,
			})
			const name = step.name ?? `screenshot-${ctx.screenshotCount}`
			await ctx.attach?.(name, body, 'image/png')
			return
		}
		case 'evalScript':
			await page.evaluate(step.script)
			return
		case 'copyTextFrom': {
			const text = await resolveLocator(page, step.selector).innerText({
				timeout: step.timeout ?? DEFAULT_ASSERT_TIMEOUT,
			})
			ctx.vars[COPIED_TEXT_VAR] = text
			return
		}
		case 'pasteText':
			await page.keyboard.type(ctx.vars[COPIED_TEXT_VAR] ?? '')
			return
		case 'runFlow': {
			if (ctx.depth >= MAX_FLOW_DEPTH) {
				throw new FlowError(
					`runFlow nesting exceeded ${MAX_FLOW_DEPTH} levels (cycle?)`,
					ctx.filePath,
				)
			}
			const baseDir =
				ctx.filePath === '<inline>' ? process.cwd() : path.dirname(ctx.filePath)
			const subFlow = loadFlowFile(path.resolve(baseDir, step.file))
			const subVars: ExecContext['vars'] = {
				...ctx.vars,
				...subFlow.config.env,
				...step.env,
			}
			const subCtx: ExecContext = {
				...ctx,
				vars: subVars,
				config: subFlow.config,
				filePath: subFlow.filePath,
				depth: ctx.depth + 1,
			}
			await runSteps(subFlow.steps, subCtx)
			// Propagate runtime-produced values back to the caller.
			ctx.vars[COPIED_TEXT_VAR] = subVars[COPIED_TEXT_VAR]
			ctx.screenshotCount = subCtx.screenshotCount
			return
		}
		case 'repeat':
			for (let i = 0; i < step.times; i++) {
				await runSteps(step.steps, ctx)
			}
			return
		default: {
			const exhaustive: never = step
			throw new FlowError(`unhandled step: ${JSON.stringify(exhaustive)}`)
		}
	}
}

async function pollText(
	get: () => Promise<string>,
	pattern: string,
	timeout: number,
	what: string,
	ctx: ExecContext,
): Promise<void> {
	const matcher = toTextMatch(pattern)
	const deadline = Date.now() + timeout
	let last = ''
	for (;;) {
		last = await get()
		const ok =
			typeof matcher === 'string' ? last.includes(matcher) : matcher.test(last)
		if (ok) return
		if (Date.now() >= deadline) {
			throw new FlowError(
				`${what} ${JSON.stringify(last)} did not match ${pattern} within ${timeout}ms`,
				ctx.filePath,
			)
		}
		await ctx.page.waitForTimeout(100)
	}
}

/** Step title for reports and error messages. */
export function describeStep(step: Step): string {
	if (step.label) return step.label
	switch (step.type) {
		case 'launchApp':
			return step.url ? `launchApp ${step.url}` : 'launchApp'
		case 'openLink':
			return `openLink ${step.url}`
		case 'tapOn':
		case 'doubleTapOn':
		case 'assertVisible':
		case 'assertNotVisible':
		case 'scrollUntilVisible':
		case 'copyTextFrom':
			return `${step.type} ${describeSelector(step.selector)}`
		case 'inputText':
			return `inputText ${JSON.stringify(step.text)}${
				step.selector ? ` into ${describeSelector(step.selector)}` : ''
			}`
		case 'pressKey':
			return `pressKey ${step.key}`
		case 'assertTitle':
		case 'assertUrl':
			return `${step.type} ${step.pattern}`
		case 'wait':
			return `wait ${step.ms}ms`
		case 'runFlow':
			return `runFlow ${step.file}`
		case 'repeat':
			return `repeat x${step.times}`
		default:
			return step.type
	}
}
