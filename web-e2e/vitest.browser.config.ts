import { defineConfig } from 'vitest/config'

// Real-browser integration tests. Kept out of the default `test` script so
// CI unit-test jobs do not need Playwright browsers installed.
export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/browser/**/*.test.ts'],
		testTimeout: 60_000,
		hookTimeout: 60_000,
	},
})
