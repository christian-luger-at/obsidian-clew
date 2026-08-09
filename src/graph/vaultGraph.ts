import { App, TFile } from 'obsidian';
import Graph from 'graphology';

export interface PinnedPosition {
	x: number;
	y: number;
}

export interface BuildVaultGraphOptions {
	/** "Undirected by default, with a toggle" (doc section 3.2). */
	directed?: boolean;
	/**
	 * Manually dragged positions (GitHub issue #12), keyed by note path -
	 * used instead of deterministicPosition() for whichever notes have one,
	 * and marks that node `fixed` so ForceAtlas2 never moves it (see
	 * layoutRunner.ts / graphology-layout-forceatlas2's own support for this
	 * - forces to/from a fixed node's neighbors still apply, only the fixed
	 * node's own position is left alone, which is what makes a drag's
	 * neighbors visibly adapt instead of the pin just sitting there inert).
	 * Persisted by GraphPane via ClewPlugin's settings, not passed here as
	 * anything more than plain data - this module stays Obsidian-Plugin/data
	 * free.
	 */
	pinnedPositions?: Record<string, PinnedPosition>;
}

/**
 * Builds a graphology graph from a node set (files) plus Obsidian's link
 * graph - edges come from app.metadataCache.resolvedLinks, filtered down to
 * pairs where both endpoints are in the given file set.
 *
 * Each edge is also stamped with `pathCost`, used by pathfinding.ts to
 * discourage routing through hub nodes. Deliberately NOT named `weight`:
 * graphology-layout-forceatlas2 defaults to reading an edge attribute
 * literally named `weight` for its own physics (see layoutRunner.ts), and
 * reusing that name here would silently corrupt the force layout.
 *
 * Deliberately does NOT set a `color` attribute: colors need to be
 * theme-aware (see theme.ts) and reactive to Obsidian's 'css-change' event,
 * which this module - kept DOM/Obsidian-App-free enough to unit test
 * without a real Obsidian instance - has no business knowing about.
 * GraphPane applies color via a default nodeReducer instead (see
 * applyDefaultColoring in graphPane.ts); `type` (image vs. plain) is still
 * set here since it's structural, not a style choice.
 */
export function buildVaultGraph(app: App, files: TFile[], options: BuildVaultGraphOptions = {}): Graph {
	const { directed = false, pinnedPositions = {} } = options;
	const graph = new Graph({ type: directed ? 'directed' : 'undirected' });
	const nodePaths = new Set(files.map((file) => file.path));

	for (const file of files) {
		const cover = app.metadataCache.getFileCache(file)?.frontmatter?.cover as string | undefined;
		const image = cover ? resolveImage(app, cover) : undefined;
		const pinned = pinnedPositions[file.path];
		const position = pinned ?? deterministicPosition(file.path);
		graph.addNode(file.path, {
			label: file.basename,
			x: position.x,
			y: position.y,
			fixed: pinned ? true : undefined,
			type: image ? 'image' : undefined,
			image,
		});
	}

	const resolvedLinks = app.metadataCache.resolvedLinks;
	for (const sourcePath of nodePaths) {
		const targets = resolvedLinks[sourcePath];
		if (!targets) continue;
		for (const targetPath of Object.keys(targets)) {
			if (targetPath === sourcePath) continue;
			if (!nodePaths.has(targetPath)) continue;
			if (graph.hasEdge(sourcePath, targetPath)) {
				// Undirected only: hasEdge(source, target) matches regardless
				// of which direction created the edge, so reaching this on a
				// *second* iteration (the other note's own resolvedLinks
				// entry) means both notes link to each other - stamp that
				// instead of silently dropping it, so GraphPane's arrow
				// rendering (showEdgeDirection) can draw a double-headed
				// arrow rather than an arbitrary single direction. Directed
				// (pathfinding's search graph) never hits this branch: there,
				// A->B and B->A are distinct edges, so hasEdge(source,
				// target) only ever matches its own exact direction.
				graph.setEdgeAttribute(sourcePath, targetPath, 'mutual', true);
				continue;
			}
			graph.addEdge(sourcePath, targetPath);
		}
	}

	addGhostNodes(app, graph, nodePaths);

	stampPathCosts(graph);
	sizeNodesByDegree(graph);

	return graph;
}

/**
 * Feature-list item "Ghost-Nodes für nicht-existente Notizen": a note
 * linking to `[[Some Missing Note]]` shows up in
 * `app.metadataCache.unresolvedLinks` (source path -> unresolved link text
 * -> mention count), never in `resolvedLinks` above - so without this,
 * broken links are invisible in the graph itself (they only ever surfaced
 * in the Diagnostics panel's "Broken links" list, graphPane.ts's
 * findBrokenLinks()). One ghost node per distinct missing target, not one
 * per mentioning note - two notes both linking to the same missing note
 * should read as "these two are both missing the same thing," not as two
 * unrelated placeholders. `kind: 'ghost'` is the one marker every other
 * module needs to check for - graphPane.ts's rendering (theme.ts's
 * ghostNodeColor, a legible muted gray, and no click-to-open, see
 * setupNodeClick(); sized by the exact same degree-based formula as a real
 * note - see sizeNodesByDegree() below) and diagnostics.ts's findOrphans()/
 * findConnectedComponents() (excluded from orphan/cluster note counts - a
 * ghost isn't a note). Deliberately NOT excluded from
 * `buildCriteriaFacts()` the way it would need explicit code to be *let
 * through* - it already only iterates `this.files` (real TFiles), so a
 * ghost node simply never has facts and can never match a filter/group,
 * i.e. "ignored by default" falls out for free rather than needing its own
 * exclusion logic.
 *
 * The `ghost:` id prefix guarantees no collision with a real note's vault
 * path (which always has a file extension and never starts with a bare
 * `ghost:` scheme prefix) - deliberately not just the raw link text, which
 * two different, unrelated missing links could otherwise coincide on by
 * accident (unlikely, but the prefix costs nothing to rule out entirely).
 */
function addGhostNodes(app: App, graph: Graph, nodePaths: Set<string>): void {
	const unresolvedLinks = app.metadataCache.unresolvedLinks;
	const ghostIdByTarget = new Map<string, string>();

	for (const sourcePath of nodePaths) {
		const targets = unresolvedLinks[sourcePath];
		if (!targets) continue;
		for (const targetText of Object.keys(targets)) {
			let ghostId = ghostIdByTarget.get(targetText);
			if (!ghostId) {
				ghostId = `ghost:${targetText}`;
				ghostIdByTarget.set(targetText, ghostId);
				const position = deterministicPosition(ghostId);
				graph.addNode(ghostId, { label: targetText, x: position.x, y: position.y, kind: 'ghost' });
			}
			// No hasEdge() guard needed (unlike the resolvedLinks loop above,
			// which iterates each note pair from *both* sides and has to
			// dedupe): `Object.keys(targets)` already visits each
			// (sourcePath, targetText) combination exactly once, so this
			// edge can never already exist when we get here.
			graph.addEdge(sourcePath, ghostId);
		}
	}
}

/**
 * Deterministic (x, y) in [0, 1), derived purely from the node's own id -
 * not a single global RNG seed consumed in file-iteration order. Addresses
 * a named complaint about the core Graph View: reopening the same vault (or
 * even just refreshing after an unrelated note changes) used to scatter
 * every note to a fresh Math.random() position, so the layout never looked
 * "the same" twice. Per-node hashing also means an unrelated file being
 * added/removed doesn't shift where *other* notes start - only the
 * changed note's own position is new, which keeps FA2's relaxation stable
 * across incremental vault refreshes, not just across a full reopen.
 *
 * FNV-1a: fast, well-distributed for this (not cryptographic - collisions
 * are not remotely a concern at real-vault node counts).
 */
function deterministicPosition(nodeId: string): { x: number; y: number } {
	return {
		x: fnv1a(nodeId) / 0xffffffff,
		// Different hash input (not just a different seed) so x and y are
		// decorrelated - reusing the same hash for both would place every
		// node exactly on the diagonal.
		y: fnv1a(`${nodeId}:y`) / 0xffffffff,
	};
}

function fnv1a(str: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/**
 * Restores every node's deterministic seed position without touching
 * anything else (edges, size, color) - used when switching back from the
 * hierarchical layout (hierarchicalLayout.ts) to the force layout, so
 * ForceAtlas2 relaxes from the same stable starting scatter it always does,
 * rather than continuing from wherever the hierarchical layout left nodes.
 *
 * A node with a pinned position (GitHub issue #12) is restored to *that*
 * position instead, and kept `fixed` - hierarchical layout doesn't respect
 * pins (dagre lays out the whole graph fresh, no per-node exceptions), so
 * without this a pin would silently not survive a hierarchical-then-back-
 * to-force round trip.
 */
export function resetToDeterministicPositions(graph: Graph, pinnedPositions: Record<string, PinnedPosition> = {}): void {
	graph.forEachNode((node) => {
		const pinned = pinnedPositions[node];
		const position = pinned ?? deterministicPosition(node);
		graph.setNodeAttribute(node, 'x', position.x);
		graph.setNodeAttribute(node, 'y', position.y);
		graph.setNodeAttribute(node, 'fixed', pinned ? true : undefined);
	});
}

export interface SizeByDegreeOptions {
	/** Plain-note size at degree 0. */
	baseSize: number;
	/** Cover-image node size at degree 0 - kept separately tunable since NodeImageProgram needs a minimum footprint to stay recognizable. */
	imageBaseSize: number;
	/** Multiplier on log(1 + degree) - how much bigger a hub node gets than a leaf. */
	degreeGrowth: number;
}

/** Matches settings.ts's DEFAULT_APPEARANCE_SETTINGS - kept as this module's own standalone default (same established pattern as e.g. renderer.ts's createRenderer) so callers that don't care about user-tunable appearance (tests, the spike harness) don't need to know about ClewSettings at all. */
export const DEFAULT_SIZE_OPTIONS: SizeByDegreeOptions = {
	baseSize: 1.2,
	imageBaseSize: 2.5,
	degreeGrowth: 0.6,
};

/**
 * Sized by degree (not a flat default) so hub notes stand out at a glance
 * and sigma's label-density threshold (see renderer.ts) naturally shows hub
 * labels first when zoomed out - without this, a vault-scale graph is an
 * undifferentiated blob of same-sized dots with every label overlapping.
 *
 * Exported so GraphPane can re-establish this baseline on every paint before
 * a node group's own size override (graph/nodeGroups.ts), if any, overlays
 * on top - this is the actual default a note reverts to once it no longer
 * matches a group with a size override, not a duplicate formula.
 *
 * Options are user-tunable (Settings tab) - GitHub follow-up to user
 * feedback comparing Clew's graph against Obsidian's own core Graph View
 * ("nodes read as too large"), after three rounds of manually re-tuning
 * the same constants in one session made clear this needed to be a live
 * setting, not another hardcoded guess.
 *
 * Ghost nodes (addGhostNodes() above) go through this exact same formula as
 * a plain note - user feedback: an earlier version fixed them at a small
 * flat size instead, deliberately smaller than even a fresh real note, but
 * that read as *wrong*, not just "different" (they should be the same size
 * as a normal note, distinguished by color/label alone - see
 * paintVisualEncoding() in graphPane.ts for the color side of that).
 */
export function sizeNodesByDegree(graph: Graph, options: SizeByDegreeOptions = DEFAULT_SIZE_OPTIONS): void {
	const { baseSize, imageBaseSize, degreeGrowth } = options;
	graph.forEachNode((node, attr) => {
		const base = attr.type === 'image' ? imageBaseSize : baseSize;
		const size = base + Math.log(1 + graph.degree(node)) * degreeGrowth;
		graph.setNodeAttribute(node, 'size', size);
	});
}

/**
 * Doc: "Durchgang durch einen Knoten kostet log(grad) statt 1." That's a
 * node cost; Dijkstra needs edge weights. Precise node-cost modeling would
 * need node-splitting (in/out copies) - real complexity for a first pass.
 * Approximation used here: each edge's cost is the average of its two
 * endpoints' log(1 + degree), still making hub-adjacent edges expensive on
 * both sides without a graph-transformation step.
 */
function stampPathCosts(graph: Graph): void {
	graph.forEachEdge((edge, _attrs, source, target) => {
		const cost = (Math.log(1 + graph.degree(source)) + Math.log(1 + graph.degree(target))) / 2;
		graph.setEdgeAttribute(edge, 'pathCost', cost);
	});
}

/** The real risk the spike tested: loading a vault image into a WebGL texture via getResourcePath(). */
function resolveImage(app: App, vaultRelativePath: string): string | undefined {
	const file = app.vault.getAbstractFileByPath(vaultRelativePath);
	if (!(file instanceof TFile)) return undefined;
	return app.vault.getResourcePath(file);
}
