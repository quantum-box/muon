import { describe, expect, it } from 'vitest'
import { describeSelector, toTextMatch } from './selector'

describe('toTextMatch', () => {
	it('keeps plain strings as substring matches', () => {
		expect(toTextMatch('Sign in')).toBe('Sign in')
	})

	it('converts /.../ strings to regular expressions', () => {
		const match = toTextMatch('/^Tachyon/i')
		expect(match).toBeInstanceOf(RegExp)
		expect((match as RegExp).source).toBe('^Tachyon')
		expect((match as RegExp).flags).toBe('i')
	})

	it('does not treat lone slashes as regex', () => {
		expect(toTextMatch('/sign_in')).toBe('/sign_in')
	})
})

describe('describeSelector', () => {
	it('renders the used axes', () => {
		expect(
			describeSelector({ role: 'button', name: 'Sign in', index: 1 }),
		).toBe('role="button" name="Sign in" index=1')
	})
})
