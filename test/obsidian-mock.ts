/**
 * Minimal runtime stand-in for the `obsidian` package, used only in tests.
 *
 * The real `obsidian` npm package ships types only (`"main": ""` in its
 * package.json) - the actual implementation is injected by the Obsidian app
 * at plugin-load time. That means any code doing `import { TFile } from
 * 'obsidian'` and using it as a value (e.g. `instanceof TFile`) has nothing
 * to resolve against in a plain Node/Vitest run. vitest.config.ts aliases
 * 'obsidian' to this file so that code keeps working under test.
 *
 * Deliberately minimal: only what src/graph/vaultGraph.ts actually touches
 * at runtime (TFile). UI classes (Modal, ItemView, Setting, Plugin, ...) are
 * not implemented -
 * tests exercising those would need a much heavier fake and aren't
 * attempted here; the value is in the graph-building logic, not the Obsidian
 * chrome around it.
 *
 * This class intentionally does NOT implement the real TFile's full shape
 * (vault, parent, name) - nothing under test touches those, and faking a
 * whole Vault object just to satisfy the real obsidian.d.ts's structural
 * type would be pure noise. test/fakeApp.ts casts to the real TFile type at
 * its public boundary instead of this class pretending to be one.
 */

export class TFile {
	path: string;
	basename: string;
	extension: string;
	stat: { mtime: number; ctime: number; size: number };

	constructor(path: string, mtime = Date.now()) {
		this.path = path;
		const name = path.split('/').pop() ?? path;
		const dot = name.lastIndexOf('.');
		this.extension = dot > 0 ? name.slice(dot + 1) : '';
		this.basename = dot > 0 ? name.slice(0, dot) : name;
		this.stat = { mtime, ctime: mtime, size: 0 };
	}
}

export class TFolder {
	path: string;
	children: unknown[] = [];

	constructor(path: string) {
		this.path = path;
	}
}

/** Approximates Obsidian's real normalizePath: forward slashes, no leading/trailing/duplicate slashes. */
export function normalizePath(path: string): string {
	return path
		.replace(/\\/g, '/')
		.replace(/\/+/g, '/')
		.replace(/^\//, '')
		.replace(/\/$/, '');
}
