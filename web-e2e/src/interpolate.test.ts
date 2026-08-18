import { describe, expect, it } from 'vitest'
import { deepInterpolate, interpolate } from './interpolate.js'

describe('interpolate', () => {
	it('replaces variables', () => {
		expect(interpolate('hello ${NAME}!', { NAME: 'world' })).toBe(
			'hello world!',
		)
	})

	it('supports dotted variable names', () => {
		expect(
			interpolate('${maestro.copiedText}', { 'maestro.copiedText': 'abc' }),
		).toBe('abc')
	})

	it('throws on undefined variables', () => {
		expect(() => interpolate('${MISSING}', {})).toThrow(
			/undefined variable \$\{MISSING\}/,
		)
	})

	it('leaves plain strings untouched', () => {
		expect(interpolate('no vars here', {})).toBe('no vars here')
	})
})

describe('deepInterpolate', () => {
	it('resolves nested strings and keeps non-strings', () => {
		const step = {
			type: 'inputText',
			text: '${EMAIL}',
			selector: { id: 'email', index: 1 },
			optional: true,
		}
		expect(deepInterpolate(step, { EMAIL: 'a@example.com' })).toEqual({
			type: 'inputText',
			text: 'a@example.com',
			selector: { id: 'email', index: 1 },
			optional: true,
		})
	})

	it('resolves arrays', () => {
		expect(deepInterpolate(['${A}', 2], { A: 'x' })).toEqual(['x', 2])
	})
})
