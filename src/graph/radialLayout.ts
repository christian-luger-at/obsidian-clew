import Graph from 'graphology';

/**
 * Distance between successive rings. Arbitrary but consistent in scale with
 * hierarchicalLayout.ts's rank spacing (its `ranksep: 80`), not
 * vaultGraph.ts's [0, 1) deterministic-seed unit square - like hierarchical
 * layout, sigma's camera re-fits to content after a layout switch (see
 * GraphPane.resetCameraAndRefresh), so the absolute unit doesn't need to
 * match other layouts, only be internally consistent.
 */
const RING_SPACING = 120;

/**
 * A third layout alongside force + hierarchical: rings the graph out from
 * one chosen "focus" note by BFS distance, for "how does the rest of the
 * vault relate to *this* note" - a question neither force's organic
 * whole-graph clustering nor hierarchical's link-direction flow answers
 * directly.
 *
 * Nodes unreachable from the focus (a different connected component) go on
 * one additional outer ring beyond the farthest reachable distance, rather
 * than being left wherever they previously were - still visible, still
 * deterministic, just visually set apart as "not actually connected to the
 * focus note".
 *
 * A no-op if `focusNode` isn't in the graph - callers only offer notes
 * currently in the graph as candidates (see RadialLayoutModal), so this is
 * a defensive fallback, not an expected path.
 */
export function computeRadialLayout(graph: Graph, focusNode: string): void {
	if (!graph.hasNode(focusNode)) return;

	const distanceByNode = bfsDistances(graph, focusNode);
	const maxReachableDistance = Math.max(0, ...distanceByNode.values());
	const overflowDistance = maxReachableDistance + 1;
	graph.forEachNode((node) => {
		if (!distanceByNode.has(node)) distanceByNode.set(node, overflowDistance);
	});

	const nodesByDistance = new Map<number, string[]>();
	for (const [node, distance] of distanceByNode) {
		const ring = nodesByDistance.get(distance);
		if (ring) ring.push(node);
		else nodesByDistance.set(distance, [node]);
	}

	for (const [distance, nodes] of nodesByDistance) {
		if (distance === 0) {
			graph.setNodeAttribute(focusNode, 'x', 0);
			graph.setNodeAttribute(focusNode, 'y', 0);
			continue;
		}
		// Sorted (not insertion/iteration order) so the same graph + focus
		// always produces the same arrangement, matching this project's other
		// determinism guarantees (see vaultGraph.ts's deterministicPosition).
		nodes.sort();
		const radius = distance * RING_SPACING;
		nodes.forEach((node, i) => {
			const angle = (i / nodes.length) * 2 * Math.PI;
			graph.setNodeAttribute(node, 'x', radius * Math.cos(angle));
			graph.setNodeAttribute(node, 'y', radius * Math.sin(angle));
		});
	}
}

function bfsDistances(graph: Graph, source: string): Map<string, number> {
	const distances = new Map<string, number>([[source, 0]]);
	const queue = [source];
	let head = 0;
	while (head < queue.length) {
		const current = queue[head++]!;
		const currentDistance = distances.get(current)!;
		for (const neighbor of graph.neighbors(current)) {
			if (distances.has(neighbor)) continue;
			distances.set(neighbor, currentDistance + 1);
			queue.push(neighbor);
		}
	}
	return distances;
}
