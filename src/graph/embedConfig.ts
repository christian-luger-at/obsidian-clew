/** GitHub issue #4, "Code-Fence Embed": a ```clew-graph code block renders an inline ego-graph, centered on one note picked by name (`node:`) out to a chosen number of hops (`hops:`, 1-3). Pulled out of graphEmbed.ts into its own module (no Obsidian/GraphPane imports) purely so this pure-logic parser stays unit-testable without dragging in GraphPane's own Sigma/WebGL dependency chain, which vitest's default (non-browser) environment can't provide - same reasoning as egoGraph.ts/nodeGroups.ts living apart from graphPane.ts. */
export interface EmbedConfig {
	node: string | null;
	hops: number;
	/** A raw CSS length (`"600px"`, `"50%"`, a bare number treated as px) or `null` if omitted/unparseable - graphEmbed.ts applies it as an inline style, falling back to the frame's own CSS default (100% width) when null. */
	width: string | null;
	/** Same shape as `width`. `null` (the default) means "no explicit height" - graphEmbed.ts then lets the frame's `aspect-ratio: 16 / 9` CSS rule derive it from whatever width ends up in effect, per the feature's own spec ("16:9 Format verwenden, wenn kein Parameter für Höhe [...] gesetzt"). */
	height: string | null;
	/** User feedback: "Refresh-Button anzeigen, wenn Parameter für Anzeige Button gesetzt ist" - off by default, since the embed is meant to read as a small fixed illustration (see the class docstring in graphEmbed.ts), not a live view; `refresh: true` opts one in. */
	showRefreshButton: boolean;
}

const DEFAULT_HOPS = 1;
const MIN_HOPS = 1;
const MAX_HOPS = 3;

/** A plain number (treated as px) or a number immediately followed by one of a small allow-list of CSS length units - deliberately narrow rather than accepting any string verbatim, so a typo'd value fails closed (falls back to the frame's own CSS default) instead of silently producing an invalid inline style. */
const CSS_LENGTH_PATTERN = /^\d+(\.\d+)?(px|%|em|rem|vh|vw)?$/;

function parseCssLength(value: string): string | null {
	if (!CSS_LENGTH_PATTERN.test(value)) return null;
	return /\d$/.test(value) ? `${value}px` : value;
}

const TRUTHY_VALUES = new Set(['true', 'yes', '1', 'on']);

/**
 * `key: value`, one per line - not a full YAML parse, since there are only
 * ever a handful of fields and their values (a note name, small integers,
 * CSS lengths, a boolean) never need YAML's own quoting/escaping rules.
 * Unknown keys and blank/malformed lines are silently ignored rather than
 * rejected outright, same "be lenient about a hand-typed code fence" spirit
 * as Obsidian's own ```query fences. `hops` outside 1-3 is clamped, not
 * rejected - a typo'd `hops: 12` showing a smaller-than-expected ego-graph
 * is far less surprising than the whole embed refusing to render over it.
 * `width`/`height` that don't parse as a CSS length are treated the same
 * way as if they'd been omitted, for the same reason.
 */
export function parseEmbedConfig(source: string): EmbedConfig {
	let node: string | null = null;
	let hops = DEFAULT_HOPS;
	let width: string | null = null;
	let height: string | null = null;
	let showRefreshButton = false;
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
		} else if (key === 'width') {
			width = parseCssLength(value);
		} else if (key === 'height') {
			height = parseCssLength(value);
		} else if (key === 'refresh') {
			showRefreshButton = TRUTHY_VALUES.has(value.toLowerCase());
		}
	}
	return { node, hops, width, height, showRefreshButton };
}
