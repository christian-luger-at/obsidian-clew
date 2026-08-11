import { TFile as MockTFile } from './obsidian-mock';
import type { App, TFile } from 'obsidian';

export interface FakeNote {
	path: string;
	/** Wikilink targets (as vault paths, matching how resolvedLinks addresses them). */
	links?: string[];
	frontmatter?: Record<string, unknown>;
	mtime?: number;
	/** Inline tags (`#project`, already `#`-prefixed) - see obsidian-mock.ts's getAllTags(). Backlog item 11, "Tags als Knoten". */
	tags?: string[];
	/** Embed targets (`![[image.png]]`), as vault paths matching another entry in the same `notes` array passed to createFakeApp() - resolved via getFirstLinkpathDest(). Backlog item 15, "Attachments als Knoten". */
	embeds?: string[];
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

	// A link only counts as "resolved" if it actually matches another note
	// in this fake vault - anything else is "unresolved", same split real
	// Obsidian makes between metadataCache.resolvedLinks/unresolvedLinks
	// (see vaultGraph.ts's addGhostNodes(), the one thing under test here
	// that actually needs unresolvedLinks to be populated correctly).
	const resolvedLinks: Record<string, Record<string, number>> = {};
	const unresolvedLinks: Record<string, Record<string, number>> = {};
	for (const note of notes) {
		if (!note.links?.length) continue;
		for (const target of note.links) {
			const bucket = notesByPath.has(target) ? resolvedLinks : unresolvedLinks;
			(bucket[note.path] ??= {})[target] = (bucket[note.path]?.[target] ?? 0) + 1;
		}
	}

	const fakeApp = {
		metadataCache: {
			resolvedLinks,
			unresolvedLinks,
			getFileCache: (file: MockTFile) => {
				const note = notesByPath.get(file.path);
				if (!note) return null;
				if (!note.frontmatter && !note.tags && !note.embeds) return null;
				return {
					frontmatter: note.frontmatter,
					tags: note.tags?.map((tag) => ({ tag })),
					embeds: note.embeds?.map((link) => ({ link })),
				};
			},
			// Real Obsidian resolves a possibly-relative/shorthand embed
			// target against `sourcePath`; the fake vault only ever uses
			// exact vault paths in its own fixtures, so a direct lookup is
			// enough here.
			getFirstLinkpathDest: (linkpath: string) => filesByPath.get(linkpath) ?? null,
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
