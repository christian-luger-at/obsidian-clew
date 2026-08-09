#!/usr/bin/env node
// Small, hand-designed functional test vault - not for perf testing (see
// gen-graph-vault.mjs for the 10k-note stress vault), for manually verifying
// each graph feature actually behaves as expected in real Obsidian.
//
// Deliberately generated rather than committed: mtime is filesystem
// metadata, not file content, so git can't preserve "this note is 6 months
// old" across a clone - a static committed vault would silently fail to
// demonstrate the stagnation heatmap on every fresh checkout. Generating it
// locally lets this script backdate specific notes with fs.utimesSync.
import { mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2] || 'test-vault';
const NOTES_FOLDER = 'Notes';
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

// Only the generated content, not the whole vault: `.obsidian/` (plugin
// symlinks, community-plugins.json, workspace layout) lives at ROOT too and
// used to get wiped along with everything else, forcing a manual re-symlink
// + re-enable after every regeneration - the exact friction the plugin
// symlinks (see DEVELOPMENT.md) are meant to eliminate.
rmSync(join(ROOT, NOTES_FOLDER), { recursive: true, force: true });
rmSync(join(ROOT, 'attachments'), { recursive: true, force: true });
mkdirSync(join(ROOT, NOTES_FOLDER), { recursive: true });
mkdirSync(join(ROOT, 'attachments'), { recursive: true });

function coverSvg() {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="32" fill="hsl(280,70%,55%)"/></svg>\n`;
}
writeFileSync(join(ROOT, 'attachments', 'cover.svg'), coverSvg());

/**
 * @typedef {{ name: string, links?: string[], frontmatter?: Record<string, string | number>, ageDays?: number }} Note
 * @type {Note[]}
 */
const notes = [
	// Main connected cluster, radiating from a hub - exercises hub-avoidance
	// path finding (a direct-ish route via Bridge Note should beat the naive
	// route straight through Hub) and hub-based node sizing/label LOD.
	// Also carries "status" (categorical) and "priority" (numeric)
	// frontmatter - exercises visual encoding (GitHub issue #1): "Visual
	// encoding..." -> color by "status" should group Topic A/its details as
	// one color and Topic B/its details as another; size by "priority"
	// should make Topic A - Detail 2 visibly the largest node, Topic C the
	// smallest, everything else in between.
	// The 'Nonexistent Note' link never resolves to a file - deliberately,
	// so the Diagnostics panel's "Broken links" section always has at least
	// one real entry to show in this vault (see DEVELOPMENT.md's "Manual QA
	// vault" section).
	{ name: 'Hub', links: ['Topic A', 'Topic B', 'Topic C', 'With Cover', 'Nonexistent Note'] },
	{ name: 'Topic A', links: ['Hub', 'Topic A - Detail 1', 'Topic A - Detail 2'], frontmatter: { status: 'active', priority: 3 } },
	{ name: 'Topic A - Detail 1', links: ['Topic A'], frontmatter: { status: 'active', priority: 2 } },
	{ name: 'Topic A - Detail 2', links: ['Topic A', 'Bridge Note'], frontmatter: { status: 'active', priority: 5 } },
	{ name: 'Topic B', links: ['Hub', 'Topic B - Detail 1'], frontmatter: { status: 'draft', priority: 1 } },
	{ name: 'Topic B - Detail 1', links: ['Topic B', 'Bridge Note'], frontmatter: { status: 'draft', priority: 1 } },
	// A second, distinct broken link (Hub's "Nonexistent Note" above is the
	// first) - two different missing targets means two distinct ghost
	// nodes to check in the graph itself (vaultGraph.ts's addGhostNodes()),
	// not just the Diagnostics panel's list.
	{ name: 'Topic C', links: ['Hub', 'Draft Idea'], frontmatter: { status: 'archived' } },
	// Direct-ish shortcut between the two topic clusters, bypassing Hub -
	// findPaths (k=5) should surface this as an alternative to the
	// Hub-routed path, and it should rank ahead of the naive route once
	// hub-avoidance cost is applied.
	{ name: 'Bridge Note', links: ['Topic A - Detail 2', 'Topic B - Detail 1'] },

	// No links at all - graph shows it with degree 0, path finding from/to
	// it should still work fine (it just has no neighbors), and it should
	// not appear in the stagnation panel's community list (min community
	// size is 2 notes, see MIN_COMMUNITY_SIZE_SHOWN in graphPane.ts).
	{ name: 'Isolated' },

	// Fully separate component - "Find path" between anything here and the
	// main cluster must report "no path found" (a first-class result, not
	// an error - see pathfinding.ts).
	{ name: 'Island X', links: ['Island Y'] },
	{ name: 'Island Y', links: ['Island X'] },

	// Backdated 200 days - should render as the stalest cluster in the
	// stagnation heatmap (deep red), clearly distinct from everything else
	// (edited "now").
	{ name: 'Old Cluster A', links: ['Old Cluster B'], ageDays: 200 },
	{ name: 'Old Cluster B', links: ['Old Cluster A', 'Old Cluster C'], ageDays: 200 },
	{ name: 'Old Cluster C', links: ['Old Cluster B'], ageDays: 195 },

	// Backdated ~45 days - a middling staleness value, useful for checking
	// the heatmap's color scale actually interpolates instead of being
	// binary fresh/stale.
	{ name: 'Medium Age A', links: ['Medium Age B'], ageDays: 45 },
	{ name: 'Medium Age B', links: ['Medium Age A'], ageDays: 40 },

	// Fresh (age 0), contrasts against the Old/Medium clusters above.
	{ name: 'Recently Edited', links: ['Hub'] },
	{ name: 'Recently Edited - Detail', links: ['Recently Edited'] },

	// Cover-image node - exercises app.vault.getResourcePath() feeding a
	// WebGL texture (the same real risk the original spike tested, just at
	// vault scale of 1 instead of ~100).
	{ name: 'With Cover', links: ['Hub'], frontmatter: { cover: 'attachments/cover.svg' } },
];

for (const note of notes) {
	const body = [
		note.frontmatter ? `---\n${Object.entries(note.frontmatter).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n` : '',
		`# ${note.name}\n\n`,
		note.links?.length ? `## Links\n\n${note.links.map((l) => `[[${l}]]`).join(' ')}\n` : '',
	].join('');

	const filePath = join(ROOT, NOTES_FOLDER, `${note.name}.md`);
	writeFileSync(filePath, body);

	if (note.ageDays) {
		const mtime = new Date(now - note.ageDays * DAY);
		utimesSync(filePath, mtime, mtime);
	}
}

console.log(`Wrote ${notes.length} notes to ${ROOT}/${NOTES_FOLDER}/`);
console.log(`Open ${ROOT} as an Obsidian vault, symlink the plugin (see DEVELOPMENT.md), then use the ribbon icon or "Open graph" command.`);
console.log('');
console.log('What to check (see DEVELOPMENT.md "Manual QA vault" for the full list):');
console.log('  - Find path: "Topic A - Detail 1" -> "Topic B - Detail 1" should offer a Bridge Note route as an alternative to the Hub route');
console.log('  - Find path: anything -> "Island X"/"Island Y" should report no path found');
console.log('  - Stagnation heatmap: "Old Cluster A/B/C" should be the stalest (red), "Medium Age A/B" a middling color, everything else fresh (blue)');
console.log('  - "With Cover" should render its cover image as the node');
console.log('  - "Visual encoding...": color by "status" groups Topic A/its details vs. Topic B/its details vs. Topic C; size by "priority" makes Topic A - Detail 2 the largest, notes without a priority (Isolated, Island X/Y, etc.) keep the default size');
console.log('  - Diagnostics: "Isolated" under Orphans, "Hub -> Nonexistent Note" and "Topic C -> Draft Idea" under Broken links, one "2 notes" row under Isolated clusters ("Show in graph" should highlight Island X/Island Y)');
console.log('  - Ghost nodes: "Nonexistent Note" and "Draft Idea" should render in the graph itself as grayed-out nodes (same size as a real note), not just in the Diagnostics list - click does nothing, hovering Hub/Topic C highlights them as neighbors like any other link');
