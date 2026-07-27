import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { generateGraph } from './generateGraph';
import { detectCommunities, computeCommunityStats } from './stagnation';
import { findPaths } from './pathfinding';
import { runHierarchicalLayout, HIERARCHICAL_LAYOUT_NODE_LIMIT } from './hierarchicalLayout';

/**
 * Automated performance regression tests at vault scale (10,000 notes / ~3
 * links each), the same target the manual spike/ browser harness validated
 * for rendering. This file covers the computational side instead - graph
 * construction, community detection, layout iteration, and pathfinding -
 * none of which need a browser/WebGL context, so they run in plain Node.
 *
 * Kept out of `npm run test` on purpose (separate vitest.perf.config.ts,
 * separate `npm run test:perf` script): these assert on wall-clock time,
 * which is inherently noisier on a shared/loaded CI runner than a
 * correctness assertion. Thresholds below are set generously above observed
 * local timings specifically so this doesn't become a flaky gate - the goal
 * is to catch an accidental O(n²) regression, not to enforce a tight budget.
 */

const NODE_COUNT = 10_000;
const EDGES_PER_NODE = 3;

function buildTestGraph(): Graph {
	const data = generateGraph({ nodeCount: NODE_COUNT, edgesPerNode: EDGES_PER_NODE, seed: 1 });
	const graph = new Graph({ type: 'undirected' });

	for (const node of data.nodes) {
		graph.addNode(node.id, { x: Math.random(), y: Math.random(), size: 3 });
	}
	for (const edge of data.edges) {
		if (!graph.hasEdge(edge.source, edge.target)) {
			graph.addEdge(edge.source, edge.target);
		}
	}

	// Mirrors vaultGraph.ts's stampPathCosts - same hub-avoidance cost model,
	// applied here since pathfinding.ts needs a real `pathCost` to work with.
	graph.forEachEdge((edge, _attrs, source, target) => {
		const cost = (Math.log(1 + graph.degree(source)) + Math.log(1 + graph.degree(target))) / 2;
		graph.setEdgeAttribute(edge, 'pathCost', cost);
	});

	return graph;
}

describe('performance @ 10,000 nodes', () => {
	it('generates the synthetic graph data quickly', () => {
		const start = performance.now();
		const data = generateGraph({ nodeCount: NODE_COUNT, edgesPerNode: EDGES_PER_NODE, seed: 1 });
		const elapsed = performance.now() - start;

		expect(data.nodes).toHaveLength(NODE_COUNT);
		expect(elapsed).toBeLessThan(1000);
	});

	it('builds the graphology graph (nodes + edges + pathCost) quickly', () => {
		const start = performance.now();
		const graph = buildTestGraph();
		const elapsed = performance.now() - start;

		expect(graph.order).toBe(NODE_COUNT);
		// Barabási–Albert with edgesPerNode=3 produces slightly fewer than
		// nodeCount * edgesPerNode edges after de-duplication.
		expect(graph.size).toBeGreaterThan(NODE_COUNT * 2);
		expect(elapsed).toBeLessThan(2000);
	});

	it('runs Louvain community detection in reasonable time', () => {
		const graph = buildTestGraph();

		const start = performance.now();
		const communities = detectCommunities(graph);
		const elapsed = performance.now() - start;

		expect(communities.size).toBe(NODE_COUNT);
		expect(elapsed).toBeLessThan(5000);
	});

	it('computes per-community mtime stats in reasonable time', () => {
		const graph = buildTestGraph();
		const communities = detectCommunities(graph);

		const start = performance.now();
		const stats = computeCommunityStats(communities, () => Date.now());
		const elapsed = performance.now() - start;

		expect(stats.length).toBeGreaterThan(0);
		expect(elapsed).toBeLessThan(1500);
	});

	it('runs a fixed budget of ForceAtlas2 layout iterations in reasonable time', () => {
		// Synchronous API (graphology-layout-forceatlas2's plain export, not
		// the Worker-based supervisor renderer.ts/layoutRunner.ts use in the
		// real plugin) - the Worker needs a browser (Blob/Worker/window), the
		// underlying algorithm doesn't, and it's the algorithm's cost this
		// test cares about.
		const graph = buildTestGraph();

		const start = performance.now();
		forceAtlas2.assign(graph, {
			iterations: 50,
			settings: { barnesHutOptimize: true, strongGravityMode: true, gravity: 0.05, scalingRatio: 10 },
		});
		const elapsed = performance.now() - start;

		expect(elapsed).toBeLessThan(25_000);
	});

	it('finds a path across the graph (k-shortest-paths) in reasonable time', () => {
		const graph = buildTestGraph();

		const start = performance.now();
		const result = findPaths(graph, 'note-0', 'note-9999', 5);
		const elapsed = performance.now() - start;

		expect(result.found).toBe(true);
		expect(elapsed).toBeLessThan(10_000);
	});

	it('reports "no path found" quickly for a genuinely disconnected pair', () => {
		const graph = buildTestGraph();
		graph.addNode('orphan');

		const start = performance.now();
		const result = findPaths(graph, 'note-0', 'orphan', 5);
		const elapsed = performance.now() - start;

		expect(result.found).toBe(false);
		expect(elapsed).toBeLessThan(2000);
	});
});

describe('performance @ hierarchical layout node limit', () => {
	// Deliberately NOT run against the 10,000-node fixture above: dagre's
	// crossing-minimization step is super-linear enough that it took over a
	// minute (still incomplete) at 10k nodes in manual testing - the whole
	// reason GraphPane disables the hierarchical-layout toggle above
	// HIERARCHICAL_LAYOUT_NODE_LIMIT in the first place. This test instead
	// guards the boundary that's actually allowed to run: right at the
	// limit itself, generously bounded well above the ~5-8s observed
	// locally, to catch a regression without becoming a 10-minute test run.
	it('completes at the node-count limit in reasonable time', () => {
		const data = generateGraph({ nodeCount: HIERARCHICAL_LAYOUT_NODE_LIMIT, edgesPerNode: 3, seed: 1 });
		const graph = new Graph({ type: 'undirected' });
		for (const node of data.nodes) graph.addNode(node.id, { size: 3 });
		for (const edge of data.edges) {
			if (!graph.hasEdge(edge.source, edge.target)) graph.addEdge(edge.source, edge.target);
		}

		const start = performance.now();
		runHierarchicalLayout(graph);
		const elapsed = performance.now() - start;

		graph.forEachNode((node) => {
			expect(Number.isFinite(graph.getNodeAttribute(node, 'x'))).toBe(true);
			expect(Number.isFinite(graph.getNodeAttribute(node, 'y'))).toBe(true);
		});
		expect(elapsed).toBeLessThan(30_000);
	});
});
