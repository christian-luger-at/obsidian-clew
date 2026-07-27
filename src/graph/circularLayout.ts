import Graph from 'graphology';

/** Arbitrary but consistent in scale with radialLayout.ts's RING_SPACING - sigma's camera re-fits to content after a layout switch, so the absolute unit doesn't need to match other layouts. */
const CIRCLE_RADIUS = 400;

/**
 * A fourth layout: every node on a single ring - the simplest arrangement
 * for spotting recurring connection patterns as arcs across the circle,
 * something force layout's organic clustering doesn't make easy to see.
 *
 * Order around the ring is a breadth-first traversal (lowest-id node in
 * each component first, neighbors visited before non-neighbors) rather than
 * a plain alphabetical order, so directly-connected nodes end up near each
 * other on the ring and the resulting arcs stay short instead of
 * crisscrossing the whole circle. This is a reasonable default ordering,
 * not a real crossing-minimization solver (that's NP-hard in general - see
 * hierarchicalLayout.ts's HIERARCHICAL_LAYOUT_NODE_LIMIT for what happens
 * when a project actually needs one of those).
 */
export function computeCircularLayout(graph: Graph): void {
	const order = breadthFirstOrder(graph);
	const total = order.length;

	order.forEach((node, i) => {
		const angle = (i / total) * 2 * Math.PI;
		graph.setNodeAttribute(node, 'x', CIRCLE_RADIUS * Math.cos(angle));
		graph.setNodeAttribute(node, 'y', CIRCLE_RADIUS * Math.sin(angle));
	});
}

function breadthFirstOrder(graph: Graph): string[] {
	const visited = new Set<string>();
	const order: string[] = [];

	// Sorted starting points (not iteration order) so disconnected
	// components always appear along the ring in the same order, matching
	// this project's other determinism guarantees.
	for (const start of [...graph.nodes()].sort()) {
		if (visited.has(start)) continue;
		visited.add(start);
		const queue = [start];
		let head = 0;
		while (head < queue.length) {
			const current = queue[head++]!;
			order.push(current);
			for (const neighbor of [...graph.neighbors(current)].sort()) {
				if (visited.has(neighbor)) continue;
				visited.add(neighbor);
				queue.push(neighbor);
			}
		}
	}
	return order;
}
