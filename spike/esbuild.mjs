import esbuild from 'esbuild';

// Standalone bundle for the browser-only spike harness (spike/main.ts).
// Deliberately separate from esbuild.config.mjs: this is a dev-only tool for
// self-verifying graph rendering performance without Obsidian, not part of
// the shipped plugin.
await esbuild.build({
	entryPoints: ['spike/main.ts'],
	bundle: true,
	outfile: 'spike/dist/bundle.js',
	format: 'iife',
	platform: 'browser',
	target: 'es2021',
	logLevel: 'info',
});
