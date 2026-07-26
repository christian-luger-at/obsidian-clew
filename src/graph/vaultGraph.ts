import { App, BasesEntry, TFile } from 'obsidian';
import Graph from 'graphology';

const GRAPH_COLOR = '#7c3aed';
const IMAGE_NODE_COLOR = '#f59e0b';

export interface BuildVaultGraphOptions {
	/** "Undirected by default, with a toggle" (doc section 3.2). */
	directed?: boolean;
}

/**
 * Builds a graphology graph from a Bases-filtered node set (entries) plus
 * Obsidian's link graph. Bases supplies the node set only - edges come from
 * app.metadataCache.resolvedLinks, filtered down to pairs where both
 * endpoints are in the current Bases result (a free preview of the
 * "Ausschluss per Bases-Filter" idea from the path-finding feature, doc
 * section 3.2). Shared by the graph views (rendering) and pathfinding.ts.
 *
 * Each edge is also stamped with `pathCost`, used by pathfinding.ts to
 * discourage routing through hub nodes. Deliberately NOT named `weight`:
 * graphology-layout-forceatlas2 defaults to reading an edge attribute
 * literally named `weight` for its own physics (see layoutRunner.ts), and
 * reusing that name here would silently corrupt the force layout.
 */
export function buildVaultGraph(
	app: App,
	entries: BasesEntry[],
	options: BuildVaultGraphOptions = {},
): Graph {
	const { directed = false } = options;
	const graph = new Graph({ type: directed ? 'directed' : 'undirected' });
	const nodePaths = new Set(entries.map((entry) => entry.file.path));

	for (const entry of entries) {
		const cover = entry.getValue('note.cover');
		const image = cover?.isTruthy() ? resolveImage(app, cover.toString()) : undefined;
		graph.addNode(entry.file.path, {
			label: entry.file.basename,
			x: Math.random(),
			y: Math.random(),
			size: image ? 6 : 3,
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
			if (!nodePaths.has(targetPath)) continue; // Bases-filtered subgraph
			if (graph.hasEdge(sourcePath, targetPath)) continue;
			graph.addEdge(sourcePath, targetPath);
		}
	}

	stampPathCosts(graph);

	return graph;
}

/**
 * Doc: "Durchgang durch einen Knoten kostet log(grad) statt 1." That's a
 * node cost; Dijkstra needs edge weights. Precise node-cost modeling would
 * need node-splitting (in/out copies) - real complexity for a first pass.
 * Approximation used here: each edge's cost is the average of its two
 * endpoints' log(1 + degree), still making hub-adjacent edges expensive on
 * both sides without a graph-transformation step. Degree is computed on
 * this already Bases-filtered graph, not the whole vault.
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
