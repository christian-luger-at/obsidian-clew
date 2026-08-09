import Graph from 'graphology';
import { betweenness as betweennessCentrality, pagerank as pagerankCentrality } from 'graphology-metrics/centrality';

/**
 * GitHub backlog item 5, "Graph-Analytics erweitern (Betweenness, PageRank,
 * Connected Components, Community-Färbung)". Thin wrappers around
 * graphology-metrics, kept to this one module (same boundary as
 * stagnation.ts/pathfinding.ts/diagnostics.ts - Obsidian-App-free, plain
 * graph in, plain data out) rather than importing graphology-metrics
 * directly from graphPane.ts.
 *
 * Both wrappers pass `getEdgeWeight: null` explicitly - graphology-metrics
 * defaults to reading an edge attribute literally named `weight` otherwise,
 * the exact same pitfall already hit (and documented) with
 * graphology-layout-forceatlas2 and graphology-communities-louvain: the
 * graph's own `pathCost` edge attribute (vaultGraph.ts, for pathfinding.ts's
 * hub-avoidance) is deliberately NOT named `weight` for exactly this reason,
 * and centrality should follow link topology only, the same as community
 * detection already does.
 */

/** Betweenness centrality per node - how often a note lies on the shortest path between two others, i.e. how much of a "bridge" it is. Normalized to [0, 1] by the library itself (most real-vault distributions skew heavily toward 0 - a handful of true bridge notes, everything else near-irrelevant to any shortest path). */
export function computeBetweenness(graph: Graph): Map<string, number> {
	const result = betweennessCentrality(graph, { getEdgeWeight: null });
	return new Map(Object.entries(result));
}

/** PageRank per node - how "prominent" a note is, weighted by how prominent its own linking neighbors are (not just raw link count, which `minLinks`/degree already covers). Values sum to 1 across the whole graph, not individually bounded near 1 - see normalizeToUnitRange() for turning this into the same relative "high half/low half" shape as stagnation.ts's staleness()/nodeGroups.ts's other bucketed criteria. */
export function computePageRank(graph: Graph): Map<string, number> {
	const result = pagerankCentrality(graph, { getEdgeWeight: null });
	return new Map(Object.entries(result));
}

/**
 * Rescales an arbitrary per-node metric (betweenness, pagerank, ...) to
 * [0, 1] relative to the min/max actually present in the current graph -
 * same reasoning as stagnation.ts's staleness(): a metric's raw values mean
 * very different things depending on graph size/shape, so nodeGroups.ts's
 * "high half"/"low half" bucket criteria compare against what's actually
 * present, not a fixed absolute cutoff nobody could guess the right value
 * for. A graph where every node has the same value (or an empty graph)
 * normalizes everything to 0 - "no meaningful spread to rank by" is the
 * same degenerate case staleness() already handles the same way.
 */
export function normalizeToUnitRange(values: Map<string, number>): Map<string, number> {
	const raw = [...values.values()];
	if (raw.length === 0) return new Map();
	const min = Math.min(...raw);
	const max = Math.max(...raw);
	if (max === min) return new Map([...values.keys()].map((key) => [key, 0]));
	const result = new Map<string, number>();
	for (const [key, value] of values) result.set(key, (value - min) / (max - min));
	return result;
}
