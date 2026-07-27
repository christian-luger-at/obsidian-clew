import { defineConfig } from 'vitest/config';

/**
 * Separate from vitest.config.ts on purpose: performance tests are slower
 * (build + process a 10k-node graph per test) and inherently more sensitive
 * to the machine running them than correctness tests. Keeping them out of
 * the default `npm run test` (and therefore out of `npm run build` / `npm
 * run lint`, which both run tests) means a slow CI runner can't turn every
 * commit's gate into a flaky perf assertion - `npm run test:perf` is a
 * separate, deliberate command.
 */
export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['src/**/*.perf.test.ts'],
		testTimeout: 60_000,
	},
});
