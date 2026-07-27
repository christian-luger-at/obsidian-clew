import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { runHierarchicalLayout } from './hierarchicalLayout';

function makeGraph(edges: [string, string][], extraNodes: string[] = []): Graph {
	const graph = new Graph({ type: 'undirected' });
	for (const node of extraNodes) graph.addNode(node, { size: 3 });
	for (const [source, target] of edges) {
		if (!graph.hasNode(source)) graph.addNode(source, { size: 3 });
		if (!graph.hasNode(target)) graph.addNode(target, { size: 3 });
		graph.addEdge(source, target);
	}
	return graph;
}

function positionOf(graph: Graph, node: string): { x: number; y: number } {
	return { x: Number(graph.getNodeAttribute(node, 'x')), y: Number(graph.getNodeAttribute(node, 'y')) };
}

describe('runHierarchicalLayout', () => {
	it('assigns every node a finite (x, y) position', () => {
		const graph = makeGraph([
			['A', 'B'],
			['B', 'C'],
		]);

		runHierarchicalLayout(graph);

		graph.forEachNode((node) => {
			const { x, y } = positionOf(graph, node);
			expect(Number.isFinite(x)).toBe(true);
			expect(Number.isFinite(y)).toBe(true);
		});
	});

	it('ranks a simple chain top-to-bottom (parent above child)', () => {
		const graph = makeGraph([
			['A', 'B'],
			['B', 'C'],
		]);

		runHierarchicalLayout(graph);

		const a = positionOf(graph, 'A');
		const b = positionOf(graph, 'B');
		const c = positionOf(graph, 'C');

		expect(a.y).toBeLessThan(b.y);
		expect(b.y).toBeLessThan(c.y);
	});

	it('handles a cycle without throwing', () => {
		const graph = makeGraph([
			['A', 'B'],
			['B', 'C'],
			['C', 'A'],
		]);

		expect(() => runHierarchicalLayout(graph)).not.toThrow();
		graph.forEachNode((node) => {
			const { x, y } = positionOf(graph, node);
			expect(Number.isFinite(x)).toBe(true);
			expect(Number.isFinite(y)).toBe(true);
		});
	});

	it('handles disconnected components without throwing', () => {
		const graph = makeGraph([
			['A', 'B'],
			['X', 'Y'],
		]);

		expect(() => runHierarchicalLayout(graph)).not.toThrow();
	});

	it('handles an isolated node (no edges at all) without throwing', () => {
		const graph = makeGraph([['A', 'B']], ['Isolated']);

		expect(() => runHierarchicalLayout(graph)).not.toThrow();
		const { x, y } = positionOf(graph, 'Isolated');
		expect(Number.isFinite(x)).toBe(true);
		expect(Number.isFinite(y)).toBe(true);
	});

	it('handles a self-loop without throwing', () => {
		const graph = makeGraph([
			['A', 'A'],
			['A', 'B'],
		]);

		expect(() => runHierarchicalLayout(graph)).not.toThrow();
	});

	it('handles an empty graph without throwing', () => {
		const graph = new Graph({ type: 'undirected' });

		expect(() => runHierarchicalLayout(graph)).not.toThrow();
	});

	it('falls back to a default footprint when a node has no size attribute', () => {
		const graph = new Graph({ type: 'undirected' });
		graph.addNode('A');
		graph.addNode('B');
		graph.addEdge('A', 'B');

		expect(() => runHierarchicalLayout(graph)).not.toThrow();
		const { x, y } = positionOf(graph, 'A');
		expect(Number.isFinite(x)).toBe(true);
		expect(Number.isFinite(y)).toBe(true);
	});

	it('gives a hub node with a larger size more spread from its neighbors than a small one', () => {
		// Not a precise geometric claim - just checks that the size (see
		// vaultGraph.ts's sizeNodesByDegree) actually feeds into dagre's node
		// footprint at all, rather than every node using the same fixed box.
		const graph = new Graph({ type: 'undirected' });
		graph.addNode('Hub', { size: 20 });
		graph.addNode('Leaf', { size: 3 });
		graph.addEdge('Hub', 'Leaf');

		runHierarchicalLayout(graph);

		const hub = positionOf(graph, 'Hub');
		const leaf = positionOf(graph, 'Leaf');
		const distance = Math.hypot(hub.x - leaf.x, hub.y - leaf.y);

		// With Hub's much larger footprint, dagre must place them further
		// apart than two same-sized default nodes would be.
		const baseline = new Graph({ type: 'undirected' });
		baseline.addNode('Hub', { size: 3 });
		baseline.addNode('Leaf', { size: 3 });
		baseline.addEdge('Hub', 'Leaf');
		runHierarchicalLayout(baseline);
		const baselineHub = positionOf(baseline, 'Hub');
		const baselineLeaf = positionOf(baseline, 'Leaf');
		const baselineDistance = Math.hypot(baselineHub.x - baselineLeaf.x, baselineHub.y - baselineLeaf.y);

		expect(distance).toBeGreaterThan(baselineDistance);
	});
});
