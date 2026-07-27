import { App, TFile } from 'obsidian';
import Graph from 'graphology';

const GRAPH_COLOR = '#7c3aed';
const IMAGE_NODE_COLOR = '#f59e0b';

export interface BuildVaultGraphOptions {
	/** "Undirected by default, with a toggle" (doc section 3.2). */
	directed?: boolean;
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
 */
export function buildVaultGraph(app: App, files: TFile[], options: BuildVaultGraphOptions = {}): Graph {
	const { directed = false } = options;
	const graph = new Graph({ type: directed ? 'directed' : 'undirected' });
	const nodePaths = new Set(files.map((file) => file.path));

	for (const file of files) {
		const cover = app.metadataCache.getFileCache(file)?.frontmatter?.cover as string | undefined;
		const image = cover ? resolveImage(app, cover) : undefined;
		const position = deterministicPosition(file.path);
		graph.addNode(file.path, {
			label: file.basename,
			x: position.x,
			y: position.y,
			color: image ? IMAGE_NODE_COLOR : GRAPH_COLOR,
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
			if (graph.hasEdge(sourcePath, targetPath)) continue;
			graph.addEdge(sourcePath, targetPath);
		}
	}

	stampPathCosts(graph);
	sizeNodesByDegree(graph);

	return graph;
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
 */
export function resetToDeterministicPositions(graph: Graph): void {
	graph.forEachNode((node) => {
		const position = deterministicPosition(node);
		graph.setNodeAttribute(node, 'x', position.x);
		graph.setNodeAttribute(node, 'y', position.y);
	});
}

/**
 * Sized by degree (not a flat default) so hub notes stand out at a glance
 * and sigma's label-density threshold (see renderer.ts) naturally shows hub
 * labels first when zoomed out - without this, a vault-scale graph is an
 * undifferentiated blob of same-sized dots with every label overlapping.
 */
function sizeNodesByDegree(graph: Graph): void {
	graph.forEachNode((node, attr) => {
		const base = attr.type === 'image' ? 6 : 3;
		const size = base + Math.log(1 + graph.degree(node)) * 1.5;
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
