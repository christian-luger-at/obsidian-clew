import Graph from 'graphology';
import dagre from '@dagrejs/dagre';

/** Shape of a node's label after dagre.layout() has populated x/y - the library's own exported `Node` type requires x/y non-optionally, which doesn't match what's actually known when calling setNode() before layout runs, so this is used only for the post-layout read-back cast below. */
interface DagreNodePosition {
	x: number;
	y: number;
}

/**
 * Doc section 3.1: a second, hierarchical layout alongside ForceAtlas2 - for
 * vaults/subgraphs where a tree/DAG-like arrangement is more legible than a
 * force-directed blob.
 *
 * Node/edge direction: reuses whichever direction each edge was originally
 * added with (source note -> target note = "linking note" -> "linked
 * note"), not a separately-built directed graph. Graphology retains an
 * edge's original addEdge(source, target) order even when the graph's type
 * is "undirected" - graph.source(edge)/graph.target(edge) still return it -
 * so this works directly against the same graph GraphPane already renders.
 *
 * dagre (Sugiyama-style layered layout) handles cycles (breaks them
 * heuristically for ranking purposes), disconnected components (ranks each
 * independently), and isolated nodes on its own - no explicit "root"
 * selection needed, verified empirically against all of those cases before
 * this was written.
 *
 * `ranker: 'longest-path'` instead of dagre's default 'network-simplex':
 * ~30-45% faster in testing, no meaningful quality loss for this use case
 * (this is already an approximate heuristic layout, not an exact one).
 * Even so, this does NOT scale to vault-sized graphs - see
 * HIERARCHICAL_LAYOUT_NODE_LIMIT.
 */

/**
 * Sugiyama-style layered layout's crossing-minimization step is
 * fundamentally not built for tens of thousands of nodes (this is a
 * property of the algorithm class, not this specific library - ELK.js has
 * the same scaling characteristic). Measured empirically: ~250ms at 100
 * nodes, ~2s at 500, ~5-8s at 1,000, ~20-35s at 2,000, still incomplete
 * after 60s at 10,000. GraphPane disables the hierarchical-layout toggle
 * above this many nodes rather than let a whole-vault graph hang the UI
 * for minutes.
 */
export const HIERARCHICAL_LAYOUT_NODE_LIMIT = 1000;

export function runHierarchicalLayout(graph: Graph): void {
	const dagreGraph = new dagre.graphlib.Graph();
	dagreGraph.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 80, ranker: 'longest-path' });
	dagreGraph.setDefaultEdgeLabel(() => ({}));

	graph.forEachNode((node, attr) => {
		const size = typeof attr.size === 'number' ? attr.size : 3;
		// A node's on-screen footprint should roughly track its rendered
		// size (see sizeNodesByDegree in vaultGraph.ts), so hub nodes get
		// proportionally more breathing room instead of dagre spacing every
		// node as if it were the same tiny dot.
		const footprint = size * 8;
		dagreGraph.setNode(node, { width: footprint, height: footprint });
	});

	graph.forEachEdge((edge, attr, source, target) => {
		dagreGraph.setEdge(source, target);
	});

	// @dagrejs/dagre's own `layout()` signature resolves its graphlib.Graph
	// parameter to fully-untyped generics (Graph<any, any, any>) - passing
	// dagreGraph (itself untyped for the same reason) here is exactly what
	// the library expects, not a sign this code is actually unsafe.
	// eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- dagre's layout() signature itself resolves to fully-untyped generics, see comment above
	dagre.layout(dagreGraph);

	dagreGraph.nodes().forEach((node: string) => {
		// dagre.layout() mutates each node's label in place to add x/y;
		// dagreGraph's own type (an untyped @dagrejs/graphlib Graph) reports
		// node labels as `any`, so this cast documents the known post-layout
		// shape rather than bypassing anything genuinely unchecked.
		const position = dagreGraph.node(node) as DagreNodePosition;
		graph.setNodeAttribute(node, 'x', position.x);
		graph.setNodeAttribute(node, 'y', position.y);
	});
}
