import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { computeClusterLayout } from './clusterLayout';

function positionOf(graph: Graph, node: string): { x: number; y: number } {
	return { x: Number(graph.getNodeAttribute(node, 'x')), y: Number(graph.getNodeAttribute(node, 'y')) };
}

/** Two obviously-separate cliques, linked by one thin bridge - Louvain should split this into (at least) two communities. */
function makeTwoCliqueGraph(): Graph {
	const graph = new Graph({ type: 'undirected' });
	const cliqueA = ['A1', 'A2', 'A3', 'A4', 'A5'];
	const cliqueB = ['B1', 'B2', 'B3', 'B4', 'B5'];
	for (const node of [...cliqueA, ...cliqueB]) graph.addNode(node);
	for (const a of cliqueA) for (const b of cliqueA) if (a < b) graph.addEdge(a, b);
	for (const a of cliqueB) for (const b of cliqueB) if (a < b) graph.addEdge(a, b);
	graph.addEdge('A1', 'B1'); // the one thin bridge
	return graph;
}

describe('computeClusterLayout', () => {
	it('assigns every node a finite position', () => {
		const graph = makeTwoCliqueGraph();

		computeClusterLayout(graph);

		graph.forEachNode((node) => {
			const { x, y } = positionOf(graph, node);
			expect(Number.isFinite(x)).toBe(true);
			expect(Number.isFinite(y)).toBe(true);
		});
	});

	it('places two separate cliques\' centroids further apart than either clique\'s own internal spread', () => {
		const graph = makeTwoCliqueGraph();

		computeClusterLayout(graph);

		const cliqueA = ['A1', 'A2', 'A3', 'A4', 'A5'].map((n) => positionOf(graph, n));
		const cliqueB = ['B1', 'B2', 'B3', 'B4', 'B5'].map((n) => positionOf(graph, n));

		const centroid = (points: { x: number; y: number }[]) => ({
			x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
			y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
		});
		const maxSpreadFromCentroid = (points: { x: number; y: number }[], c: { x: number; y: number }) =>
			Math.max(...points.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));

		const centroidA = centroid(cliqueA);
		const centroidB = centroid(cliqueB);
		const distanceBetweenCentroids = Math.hypot(centroidA.x - centroidB.x, centroidA.y - centroidB.y);
		const spreadA = maxSpreadFromCentroid(cliqueA, centroidA);
		const spreadB = maxSpreadFromCentroid(cliqueB, centroidB);

		expect(distanceBetweenCentroids).toBeGreaterThan(spreadA);
		expect(distanceBetweenCentroids).toBeGreaterThan(spreadB);
	});

	it('packs members of the same community closer together than a wider default cluster spacing', () => {
		const graph = makeTwoCliqueGraph();

		computeClusterLayout(graph, 12, 1000); // large cluster spacing pulls communities far apart

		const a1 = positionOf(graph, 'A1');
		const a2 = positionOf(graph, 'A2');
		const withinCommunityDistance = Math.hypot(a1.x - a2.x, a1.y - a2.y);

		expect(withinCommunityDistance).toBeLessThan(500);
	});

	it('is deterministic across repeated calls on the same graph', () => {
		const graph = makeTwoCliqueGraph();

		computeClusterLayout(graph);
		const first = graph.nodes().map((node) => positionOf(graph, node));

		computeClusterLayout(graph);
		const second = graph.nodes().map((node) => positionOf(graph, node));

		expect(second).toEqual(first);
	});

	it('handles an empty graph without throwing', () => {
		const graph = new Graph({ type: 'undirected' });
		expect(() => computeClusterLayout(graph)).not.toThrow();
	});

	it('handles a single-node graph without throwing', () => {
		const graph = new Graph({ type: 'undirected' });
		graph.addNode('Solo');

		expect(() => computeClusterLayout(graph)).not.toThrow();
		const { x, y } = positionOf(graph, 'Solo');
		expect(Number.isFinite(x)).toBe(true);
		expect(Number.isFinite(y)).toBe(true);
	});

	it('handles a graph with only isolated nodes (no edges at all) without throwing', () => {
		const graph = new Graph({ type: 'undirected' });
		graph.addNode('A');
		graph.addNode('B');
		graph.addNode('C');

		expect(() => computeClusterLayout(graph)).not.toThrow();
		graph.forEachNode((node) => {
			const { x, y } = positionOf(graph, node);
			expect(Number.isFinite(x)).toBe(true);
			expect(Number.isFinite(y)).toBe(true);
		});
	});

	it('gives every node in a community a distinct position (no overlap at index 0/1)', () => {
		const graph = makeTwoCliqueGraph();

		computeClusterLayout(graph);

		const a1 = positionOf(graph, 'A1');
		const a2 = positionOf(graph, 'A2');
		expect(a1).not.toEqual(a2);
	});
});
