import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { computeCircularLayout } from './circularLayout';

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

describe('computeCircularLayout', () => {
	it('assigns every node a finite position', () => {
		const graph = makeGraph(
			[
				['A', 'B'],
				['B', 'C'],
			],
			['Isolated'],
		);

		computeCircularLayout(graph);

		graph.forEachNode((node) => {
			const { x, y } = positionOf(graph, node);
			expect(Number.isFinite(x)).toBe(true);
			expect(Number.isFinite(y)).toBe(true);
		});
	});

	it('places every node the same distance from the center (a single ring)', () => {
		const graph = makeGraph([
			['A', 'B'],
			['B', 'C'],
			['C', 'D'],
		]);

		computeCircularLayout(graph);

		const radii = graph.nodes().map((node) => distanceFromOrigin(graph, node));
		for (const radius of radii) expect(radius).toBeCloseTo(radii[0]!, 5);
	});

	it('places directly-connected nodes adjacent on the ring (short arcs, not crisscrossing)', () => {
		const graph = makeGraph([
			['A', 'B'],
			['B', 'C'],
			['C', 'D'],
			['D', 'E'],
		]);

		computeCircularLayout(graph);

		const angleOf = (node: string): number => {
			const { x, y } = positionOf(graph, node);
			const angle = Math.atan2(y, x);
			// atan2 returns (-π, π], which wraps the last nodes on the ring
			// back to negative values - normalize to [0, 2π) so sorting by
			// angle matches the ring's actual placement order.
			return angle < 0 ? angle + 2 * Math.PI : angle;
		};
		const order = graph.nodes().sort((a, b) => angleOf(a) - angleOf(b));

		// A chain laid out breadth-first from its lowest-id endpoint should
		// come out in path order around the ring, not scattered.
		expect(order).toEqual(['A', 'B', 'C', 'D', 'E']);
	});

	it('is deterministic across repeated calls on the same graph', () => {
		const graph = makeGraph([
			['A', 'B'],
			['C', 'D'],
		]);

		computeCircularLayout(graph);
		const first = graph.nodes().map((node) => positionOf(graph, node));

		computeCircularLayout(graph);
		const second = graph.nodes().map((node) => positionOf(graph, node));

		expect(second).toEqual(first);
	});

	it('handles disconnected components without throwing', () => {
		const graph = makeGraph([
			['A', 'B'],
			['X', 'Y'],
		]);

		expect(() => computeCircularLayout(graph)).not.toThrow();
	});

	it('handles a single isolated node without throwing', () => {
		const graph = new Graph({ type: 'undirected' });
		graph.addNode('Solo');

		expect(() => computeCircularLayout(graph)).not.toThrow();
		const { x, y } = positionOf(graph, 'Solo');
		expect(Number.isFinite(x)).toBe(true);
		expect(Number.isFinite(y)).toBe(true);
	});

	it('handles an empty graph without throwing', () => {
		const graph = new Graph({ type: 'undirected' });

		expect(() => computeCircularLayout(graph)).not.toThrow();
	});

	it('handles a self-loop without throwing', () => {
		const graph = makeGraph([
			['A', 'A'],
			['A', 'B'],
		]);

		expect(() => computeCircularLayout(graph)).not.toThrow();
	});
});
