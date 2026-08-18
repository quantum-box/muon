import { describe, expect, it } from 'vitest'
import { parseFlow } from './parse.js'

describe('parseFlow', () => {
	it('parses a config header and steps', () => {
		const flow = parseFlow(
			[
				'url: /sign_in',
				'name: sign in smoke',
				'tags: [smoke]',
				'env:',
				'  EMAIL: a@example.com',
				'---',
				'- launchApp',
				"- tapOn: 'Sign in'",
				'- inputText: ${EMAIL}',
				"- assertVisible: 'Welcome'",
			].join('\n'),
		)
		expect(flow.config).toEqual({
			url: '/sign_in',
			name: 'sign in smoke',
			tags: ['smoke'],
			env: { EMAIL: 'a@example.com' },
		})
		expect(flow.steps).toEqual([
			{ type: 'launchApp' },
			{ type: 'tapOn', selector: { text: 'Sign in' } },
			{ type: 'inputText', text: '${EMAIL}' },
			{ type: 'assertVisible', selector: { text: 'Welcome' } },
		])
	})

	it('accepts a steps-only file', () => {
		const flow = parseFlow('- back\n')
		expect(flow.config).toEqual({})
		expect(flow.steps).toEqual([{ type: 'back' }])
	})

	it('normalizes selector objects and shared params', () => {
		const flow = parseFlow(
			[
				'---',
				'- tapOn:',
				'    id: email',
				'    index: 1',
				'    optional: true',
				'    timeout: 500',
				'- assertVisible:',
				'    role: button',
				"    name: 'Sign in'",
			].join('\n'),
		)
		expect(flow.steps[0]).toEqual({
			type: 'tapOn',
			selector: { id: 'email', index: 1 },
			optional: true,
			timeout: 500,
		})
		expect(flow.steps[1]).toEqual({
			type: 'assertVisible',
			selector: { role: 'button', name: 'Sign in' },
		})
	})

	it('normalizes runFlow and repeat', () => {
		const flow = parseFlow(
			[
				'---',
				'- runFlow: _shared/login.yaml',
				'- repeat:',
				'    times: 3',
				'    commands:',
				'      - pressKey: Enter',
			].join('\n'),
		)
		expect(flow.steps[0]).toEqual({
			type: 'runFlow',
			file: '_shared/login.yaml',
		})
		expect(flow.steps[1]).toEqual({
			type: 'repeat',
			times: 3,
			steps: [{ type: 'pressKey', key: 'Enter' }],
		})
	})

	it('rejects unknown commands', () => {
		expect(() => parseFlow('- flyToMoon\n')).toThrow(/not a known bare command/)
		expect(() => parseFlow('- flyToMoon: now\n')).toThrow(/unknown command/)
	})

	it('rejects unknown selector keys', () => {
		expect(() =>
			parseFlow(['---', '- tapOn:', '    ids: nope'].join('\n')),
		).toThrow(/unknown selector key/)
	})

	it('rejects empty selectors', () => {
		expect(() =>
			parseFlow(['---', '- tapOn:', '    index: 2'].join('\n')),
		).toThrow(/selector needs one of/)
	})

	it('rejects unknown config keys but tolerates appId', () => {
		expect(() => parseFlow('appid_typo: x\n---\n- back\n')).toThrow(
			/unknown config key/,
		)
		const flow = parseFlow('appId: com.example.app\n---\n- back\n')
		expect(flow.config).toEqual({})
	})

	it('rejects steps with multiple command keys', () => {
		expect(() =>
			parseFlow(['---', "- tapOn: 'a'", '  inputText: b'].join('\n')),
		).toThrow(/exactly one command key/)
	})

	it('requires visible or notVisible on extendedWaitUntil', () => {
		expect(() =>
			parseFlow(['---', '- extendedWaitUntil:', '    timeout: 100'].join('\n')),
		).toThrow(/requires "visible"/)
	})
})
