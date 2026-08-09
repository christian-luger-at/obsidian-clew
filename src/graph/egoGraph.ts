import type Graph from 'graphology';

/**
 * Backs the "Focus" toolbar button (GraphPane.applyFocus()) - GitHub
 * backlog item 3, "Lokaler/Ego-Graph-Modus". A plain breadth-first search
 * from `focusPath`, not a directed one - `graph` is always the live,
 * undirected vault graph (buildVaultGraph()'s default; see pathfinding.ts's
 * findPaths() for the same choice and why: rendering never distinguishes
 * "A links to B" from "B links to A", so neither should this).
 *
 * `hops` is inclusive and counts edges, not nodes - `hops === 1` is
 * `focusPath` plus its direct neighbors, `hops === 2` also pulls in their
 * neighbors, and so on. `hops <= 0` returns just `focusPath` itself (no
 * neighbors at all) rather than throwing - defensive, since the UI clamps
 * to 1-3 but a caller shouldn't have to trust that.
 *
 * Returns an empty set if `focusPath` isn't actually in `graph` (e.g. the
 * focused note was deleted since it was picked) - GraphPane.applyFocus()
 * treats that as "nothing to show", same as Find-path's "no path found".
 */
export function computeEgoSubgraph(graph: Graph, focusPath: string, hops: number): Set<string> {
	const visited = new Set<string>();
	if (!graph.hasNode(focusPath)) return visited;
	visited.add(focusPath);

	let frontier = [focusPath];
	for (let depth = 0; depth < hops && frontier.length > 0; depth++) {
		const next: string[] = [];
		for (const node of frontier) {
			graph.forEachNeighbor(node, (neighbor) => {
				if (!visited.has(neighbor)) {
					visited.add(neighbor);
					next.push(neighbor);
				}
			});
		}
		frontier = next;
	}
	return visited;
}
