import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			// The real 'obsidian' package is types-only at runtime (its actual
			// implementation is injected by the Obsidian app) - see
			// test/obsidian-mock.ts for why this alias exists.
			obsidian: new URL('./test/obsidian-mock.ts', import.meta.url).pathname,
		},
	},
	test: {
		globals: true,
		environment: 'node',
		include: ['src/**/*.test.ts'],
		exclude: ['**/node_modules/**', 'src/**/*.perf.test.ts'],
		coverage: {
			provider: 'v8',
			// Scoped to the pure graph-algorithm modules, not all of src/: the
			// rest (graphPane.ts, standaloneGraphView.ts, pathfindingModal.ts,
			// radialLayoutModal.ts, noteSuggest.ts, renderer.ts, layoutRunner.ts,
			// main.ts, settings.ts) is Obsidian UI/view-lifecycle or sigma.js
			// rendering wiring that would need a real Obsidian instance or a
			// browser to meaningfully test - see DEVELOPMENT.md's Testing
			// section for the reasoning. Coverage thresholds only mean
			// something where unit tests are the actual verification strategy.
			include: [
				'src/graph/vaultGraph.ts',
				'src/graph/pathfinding.ts',
				'src/graph/stagnation.ts',
				'src/graph/generateGraph.ts',
				'src/graph/hierarchicalLayout.ts',
				'src/graph/visualEncoding.ts',
				'src/graph/radialLayout.ts',
				'src/graph/circularLayout.ts',
			],
			reporter: ['text', 'json-summary'],
			// Mirrors obsidian-focus-first's thresholds: per-file so no single
			// file can silently regress behind the average.
			thresholds: {
				perFile: true,
				statements: 85,
				lines: 85,
				branches: 80,
				functions: 80,
			},
		},
	},
});
