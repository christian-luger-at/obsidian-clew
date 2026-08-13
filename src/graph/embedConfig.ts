/** GitHub issue #4, "Code-Fence Embed": a ```clew-graph code block renders an inline ego-graph, centered on one note picked by name (`node:`) out to a chosen number of hops (`hops:`, 1-3). Pulled out of graphEmbed.ts into its own module (no Obsidian/GraphPane imports) purely so this pure-logic parser stays unit-testable without dragging in GraphPane's own Sigma/WebGL dependency chain, which vitest's default (non-browser) environment can't provide - same reasoning as egoGraph.ts/nodeGroups.ts living apart from graphPane.ts. */
export interface EmbedConfig {
	node: string | null;
	hops: number;
}

const DEFAULT_HOPS = 1;
const MIN_HOPS = 1;
const MAX_HOPS = 3;

/**
 * `key: value`, one per line - not a full YAML parse, since there are only
 * ever two fields and the values (a note name, a small integer) never need
 * YAML's own quoting/escaping rules. Unknown keys and blank/malformed lines
 * are silently ignored rather than rejected outright, same "be lenient
 * about a hand-typed code fence" spirit as Obsidian's own ```query fences.
 * `hops` outside 1-3 is clamped, not rejected - a typo'd `hops: 12` showing
 * a smaller-than-expected ego-graph is far less surprising than the whole
 * embed refusing to render over it.
 */
export function parseEmbedConfig(source: string): EmbedConfig {
	let node: string | null = null;
	let hops = DEFAULT_HOPS;
	for (const rawLine of source.split('\n')) {
		const line = rawLine.trim();
		if (!line) continue;
		const colonIndex = line.indexOf(':');
		if (colonIndex === -1) continue;
		const key = line.slice(0, colonIndex).trim().toLowerCase();
		const value = line.slice(colonIndex + 1).trim();
		if (key === 'node') {
			if (value) node = value;
		} else if (key === 'hops') {
			const parsed = Number(value);
			if (Number.isInteger(parsed)) hops = Math.min(MAX_HOPS, Math.max(MIN_HOPS, parsed));
		}
	}
	return { node, hops };
}
