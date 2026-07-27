import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { computeRadialLayout } from './radialLayout';

function makeGraph(edges: [string, string][], extraNodes: string[] = []): Graph {
	const graph = new Graph({ type: 'undirected' });
	for (const node of extraNodes) graph.addNode(node);
	for (const [source, target] of edges) {
		if (!graph.hasNode(source)) graph.addNode(source);
		if (!graph.hasNode(target)) graph.addNode(target);
		graph.addEdge(source, target);
	}
	return graph;
}

function positionOf(graph: Graph, node: string): { x: number; y: number } {
	return { x: Number(graph.getNodeAttribute(node, 'x')), y: Number(graph.getNodeAttribute(node, 'y')) };
}

function distanceFromOrigin(graph: Graph, node: string): number {
	const { x, y } = positionOf(graph, node);
	return Math.hypot(x, y);
}

describe('computeRadialLayout', () => {
	it('places the focus node at the origin', () => {
		const graph = makeGraph([
			['Focus', 'A'],
			['A', 'B'],
		]);

		computeRadialLayout(graph, 'Focus');

		const { x, y } = positionOf(graph, 'Focus');
		expect(x).toBe(0);
		expect(y).toBe(0);
	});

	it('places direct neighbors on a ring closer than two-hop neighbors', () => {
		const graph = makeGraph([
			['Focus', 'A'],
			['A', 'B'],
		]);

		computeRadialLayout(graph, 'Focus');

		expect(distanceFromOrigin(graph, 'A')).toBeGreaterThan(0);
		expect(distanceFromOrigin(graph, 'B')).toBeGreaterThan(distanceFromOrigin(graph, 'A'));
	});

	it('gives every node at the same BFS distance the same ring radius', () => {
		const graph = makeGraph([
			['Focus', 'A'],
			['Focus', 'B'],
			['Focus', 'C'],
		]);

		computeRadialLayout(graph, 'Focus');

		const radiusA = distanceFromOrigin(graph, 'A');
		const radiusB = distanceFromOrigin(graph, 'B');
		const radiusC = distanceFromOrigin(graph, 'C');
		expect(radiusA).toBeCloseTo(radiusB, 5);
		expect(radiusB).toBeCloseTo(radiusC, 5);
	});

	it('places nodes unreachable from the focus on an outer overflow ring', () => {
		const graph = makeGraph([
			['Focus', 'A'],
			['A', 'B'],
			['Island1', 'Island2'],
		]);

		computeRadialLayout(graph, 'Focus');

		const farthestReachable = Math.max(distanceFromOrigin(graph, 'A'), distanceFromOrigin(graph, 'B'));
		expect(distanceFromOrigin(graph, 'Island1')).toBeGreaterThan(farthestReachable);
		expect(distanceFromOrigin(graph, 'Island2')).toBeGreaterThan(farthestReachable);
	});

	it('is deterministic across repeated calls on the same graph', () => {
		const graph = makeGraph([
			['Focus', 'A'],
			['Focus', 'B'],
			['A', 'C'],
		]);

		computeRadialLayout(graph, 'Focus');
		const first = graph.nodes().map((node) => positionOf(graph, node));

		computeRadialLayout(graph, 'Focus');
		const second = graph.nodes().map((node) => positionOf(graph, node));

		expect(second).toEqual(first);
	});

	it('is a no-op when the focus node is not in the graph', () => {
		const graph = makeGraph([['A', 'B']]);
		graph.setNodeAttribute('A', 'x', 42);
		graph.setNodeAttribute('A', 'y', 7);

		computeRadialLayout(graph, 'Nonexistent');

		const { x, y } = positionOf(graph, 'A');
		expect(x).toBe(42);
		expect(y).toBe(7);
	});

	it('handles an isolated focus node (no edges at all) without throwing', () => {
		const graph = makeGraph([], ['Focus']);

		expect(() => computeRadialLayout(graph, 'Focus')).not.toThrow();
		const { x, y } = positionOf(graph, 'Focus');
		expect(x).toBe(0);
		expect(y).toBe(0);
	});

	it('handles a graph with only the focus node without throwing', () => {
		const graph = new Graph({ type: 'undirected' });
		graph.addNode('Focus');

		expect(() => computeRadialLayout(graph, 'Focus')).not.toThrow();
	});

	it('assigns every node a finite position', () => {
		const graph = makeGraph(
			[
				['Focus', 'A'],
				['A', 'B'],
				['B', 'C'],
			],
			['Isolated'],
		);

		computeRadialLayout(graph, 'Focus');

		graph.forEachNode((node) => {
			const { x, y } = positionOf(graph, node);
			expect(Number.isFinite(x)).toBe(true);
			expect(Number.isFinite(y)).toBe(true);
		});
	});
});
