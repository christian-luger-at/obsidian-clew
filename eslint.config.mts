import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'releases',
		'spike',
		'spike-vault',
		'test-vault',
		// A ChatGPT-authored, throwaway HTML/JS prototype (group-highlight
		// treatments, later ported into heatmapLayer.ts) - not part of the
		// plugin bundle, not covered by tsconfig.json's project service,
		// same "reference material, not shipped code" reasoning as spike/
		// spike-vault above.
		'test-shadow',
		'.screenshot-vault',
		'scripts',
		'docs',
		'coverage',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json', 'vitest.config.ts', 'vitest.perf.config.ts'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
);
