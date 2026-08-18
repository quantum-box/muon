import type { Locator, Page } from '@playwright/test'
import { FlowError, type SelectorSpec } from './types'

// [\s\S] rather than the `s` flag: consumers may target below es2018.
const REGEX_PATTERN = /^\/([\s\S]+)\/([gimsuy]*)$/

/**
 * `/foo/i` style strings become regular expressions; everything else is a
 * substring match (Playwright's default text matching).
 */
export function toTextMatch(value: string): string | RegExp {
	const match = REGEX_PATTERN.exec(value)
	if (match) return new RegExp(match[1], match[2])
	return value
}

/**
 * Resolve a selector spec to a Playwright locator. Like Maestro, when
 * several elements match, the first one is used unless `index` is given.
 */
export function resolveLocator(page: Page, spec: SelectorSpec): Locator {
	let locator: Locator
	if (spec.css !== undefined) {
		locator = page.locator(spec.css)
	} else if (spec.id !== undefined) {
		locator = page.getByTestId(spec.id)
	} else if (spec.role !== undefined) {
		locator = page.getByRole(
			spec.role as Parameters<Page['getByRole']>[0],
			spec.name !== undefined ? { name: toTextMatch(spec.name) } : undefined,
		)
	} else if (spec.label !== undefined) {
		locator = page.getByLabel(toTextMatch(spec.label))
	} else if (spec.placeholder !== undefined) {
		locator = page.getByPlaceholder(toTextMatch(spec.placeholder))
	} else if (spec.text !== undefined) {
		locator = page.getByText(toTextMatch(spec.text))
	} else {
		throw new FlowError('selector has no matching axis')
	}
	return spec.index !== undefined ? locator.nth(spec.index) : locator.first()
}

/** Short human-readable form used in step titles and error messages. */
export function describeSelector(spec: SelectorSpec): string {
	const parts: string[] = []
	for (const key of [
		'text',
		'id',
		'css',
		'role',
		'name',
		'label',
		'placeholder',
	] as const) {
		if (spec[key] !== undefined)
			parts.push(`${key}=${JSON.stringify(spec[key])}`)
	}
	if (spec.index !== undefined) parts.push(`index=${spec.index}`)
	return parts.join(' ')
}
