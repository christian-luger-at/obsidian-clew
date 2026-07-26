#!/usr/bin/env node
// Stress-test vault generator: 10,000 markdown notes with a hub-heavy link
// structure, a few with a cover image (to exercise loading a vault image
// into a WebGL texture via app.vault.getResourcePath()).
//
// Mirrors the structure of src/graph/generateGraph.ts (same mulberry32 PRNG,
// same Barabási–Albert preferential attachment), ported to plain JS since
// this script isn't compiled - scripts/*.mjs in this repo are hand-written,
// not built from src/.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2] || 'spike-vault';
const NOTES_FOLDER = 'Spike Notes';
const NODE_COUNT = 10_000;
const EDGES_PER_NODE = 3;

function mulberry32(seed) {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rng = mulberry32(1);

const nodeIds = [];
const edges = [];
const degreeSamples = [];

const seedSize = Math.min(EDGES_PER_NODE + 1, NODE_COUNT);
for (let i = 0; i < seedSize; i++) nodeIds.push(i);
for (let i = 0; i < seedSize; i++) {
	for (let j = i + 1; j < seedSize; j++) {
		edges.push([i, j]);
		degreeSamples.push(i, j);
	}
}
for (let i = seedSize; i < NODE_COUNT; i++) {
	nodeIds.push(i);
	const targets = new Set();
	const attempts = EDGES_PER_NODE * 4;
	for (let a = 0; a < attempts && targets.size < EDGES_PER_NODE; a++) {
		const candidate = degreeSamples[Math.floor(rng() * degreeSamples.length)];
		if (candidate !== undefined && candidate !== i) targets.add(candidate);
	}
	while (targets.size < Math.min(EDGES_PER_NODE, i)) {
		const candidate = Math.floor(rng() * i);
		if (candidate !== i) targets.add(candidate);
	}
	for (const t of targets) {
		edges.push([i, t]);
		degreeSamples.push(i, t);
	}
}

// ~1% of notes get a cover image, matching spike/main.ts's harness.
const imageEvery = Math.max(1, Math.floor(NODE_COUNT / 100));
const imageNodeIds = new Set();
for (let i = 0; i < nodeIds.length; i += imageEvery) imageNodeIds.add(i);

const adjacency = new Map();
for (const [a, b] of edges) {
	if (!adjacency.has(a)) adjacency.set(a, []);
	if (!adjacency.has(b)) adjacency.set(b, []);
	adjacency.get(a).push(b);
	adjacency.get(b).push(a);
}

function placeholderSvg(seed) {
	const hue = (seed * 47) % 360;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="32" fill="hsl(${hue},70%,55%)"/><text x="32" y="41" font-size="26" text-anchor="middle" fill="white" font-family="sans-serif">${seed % 100}</text></svg>\n`;
}

rmSync(ROOT, { recursive: true, force: true });
mkdirSync(join(ROOT, NOTES_FOLDER), { recursive: true });
mkdirSync(join(ROOT, 'attachments'), { recursive: true });

for (const id of imageNodeIds) {
	writeFileSync(join(ROOT, 'attachments', `cover-${id}.svg`), placeholderSvg(id));
}

for (const id of nodeIds) {
	const links = (adjacency.get(id) || []).map((t) => `[[Note ${t}]]`).join(' ');
	const frontmatter = imageNodeIds.has(id) ? `---\ncover: attachments/cover-${id}.svg\n---\n\n` : '';
	const body = `${frontmatter}# Note ${id}\n\n## Links\n\n${links}\n`;
	writeFileSync(join(ROOT, NOTES_FOLDER, `Note ${id}.md`), body);
}

console.log(`Wrote ${nodeIds.length} notes, ${edges.length} links, ${imageNodeIds.size} cover images to ${ROOT}/`);
console.log(`Open ${ROOT} as an Obsidian vault, symlink the plugin (see DEVELOPMENT.md), then use the ribbon icon or "Open graph" command.`);
