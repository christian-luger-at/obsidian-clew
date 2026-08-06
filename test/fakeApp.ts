import { TFile as MockTFile } from './obsidian-mock';
import type { App, TFile } from 'obsidian';

export interface FakeNote {
	path: string;
	/** Wikilink targets (as vault paths, matching how resolvedLinks addresses them). */
	links?: string[];
	frontmatter?: Record<string, unknown>;
	mtime?: number;
}

export interface FakeAppHandle {
	app: App;
	files: TFile[];
}

/**
 * Builds a fake `App` shaped exactly like what buildVaultGraph actually
 * calls: metadataCache.resolvedLinks, metadataCache.getFileCache,
 * vault.getAbstractFileByPath, vault.getResourcePath. Not a general-purpose
 * Obsidian test harness - just enough surface for the graph-building logic
 * under test.
 *
 * Returns the real (type-only) `TFile` type at this boundary, cast from the
 * lightweight mock class - see obsidian-mock.ts for why the mock doesn't try
 * to structurally fake the whole real TFile shape.
 */
export function createFakeApp(notes: FakeNote[]): FakeAppHandle {
	const mockFiles = notes.map((note) => new MockTFile(note.path, note.mtime ?? Date.now()));
	const filesByPath = new Map(mockFiles.map((file) => [file.path, file]));
	const notesByPath = new Map(notes.map((note) => [note.path, note]));

	const resolvedLinks: Record<string, Record<string, number>> = {};
	for (const note of notes) {
		if (!note.links?.length) continue;
		resolvedLinks[note.path] = Object.fromEntries(note.links.map((target) => [target, 1]));
	}

	const fakeApp = {
		metadataCache: {
			resolvedLinks,
			getFileCache: (file: MockTFile) => {
				const note = notesByPath.get(file.path);
				return note?.frontmatter ? { frontmatter: note.frontmatter } : null;
			},
		},
		vault: {
			getAbstractFileByPath: (path: string) => filesByPath.get(path) ?? null,
			getResourcePath: (file: MockTFile) => `app://local/${file.path}`,
			getMarkdownFiles: () => mockFiles,
		},
	};

	return {
		app: fakeApp as unknown as App,
		files: mockFiles as unknown as TFile[],
	};
}
