import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { computeTimelineLayout } from './timelineLayout';

const DAY = 24 * 60 * 60 * 1000;

function makeGraph(nodes: string[]): Graph {
	const graph = new Graph({ type: 'undirected' });
	for (const node of nodes) graph.addNode(node);
	return graph;
}

function positionOf(graph: Graph, node: string): { x: number; y: number } {
	return { x: Number(graph.getNodeAttribute(node, 'x')), y: Number(graph.getNodeAttribute(node, 'y')) };
}

describe('computeTimelineLayout', () => {
	it('places the earliest note at x = 0', () => {
		const graph = makeGraph(['A', 'B']);
		const ctimeByNode = new Map([
			['A', 0],
			['B', 5 * DAY],
		]);

		computeTimelineLayout(graph, ctimeByNode);

		expect(positionOf(graph, 'A').x).toBe(0);
	});

	it('spaces notes on different days proportionally to elapsed time, not rank', () => {
		const graph = makeGraph(['A', 'B', 'C']);
		// A and B are 1 day apart, B and C are 10 days apart - a rank-based
		// layout (like circularLayout.ts's BFS order) would space these
		// evenly; a real-time layout must not.
		const ctimeByNode = new Map([
			['A', 0],
			['B', 1 * DAY],
			['C', 11 * DAY],
		]);

		computeTimelineLayout(graph, ctimeByNode, 10);

		const xA = positionOf(graph, 'A').x;
		const xB = positionOf(graph, 'B').x;
		const xC = positionOf(graph, 'C').x;
		const gapAB = xB - xA;
		const gapBC = xC - xB;
		expect(gapBC).toBeCloseTo(gapAB * 10, 5);
	});

	it('stacks notes sharing the same day in one column, spread vertically', () => {
		const graph = makeGraph(['A', 'B']);
		const ctimeByNode = new Map([
			['A', 0],
			['B', 1000], // same calendar day as A
		]);

		computeTimelineLayout(graph, ctimeByNode);

		const posA = positionOf(graph, 'A');
		const posB = positionOf(graph, 'B');
		expect(posA.x).toBe(posB.x);
		expect(posA.y).not.toBe(posB.y);
	});

	it('centers a shared column vertically around y = 0', () => {
		const graph = makeGraph(['A', 'B', 'C']);
		const ctimeByNode = new Map([
			['A', 0],
			['B', 0],
			['C', 0],
		]);

		computeTimelineLayout(graph, ctimeByNode, 8, 60);

		const ys = ['A', 'B', 'C'].map((node) => positionOf(graph, node).y);
		const sum = ys.reduce((a, b) => a + b, 0);
		expect(sum).toBeCloseTo(0, 5);
	});

	it('places undated nodes in one overflow column past the last dated day', () => {
		const graph = makeGraph(['A', 'B', 'Ghost']);
		const ctimeByNode = new Map([
			['A', 0],
			['B', 3 * DAY],
		]);

		computeTimelineLayout(graph, ctimeByNode, 10);

		const xB = positionOf(graph, 'B').x;
		const xGhost = positionOf(graph, 'Ghost').x;
		expect(xGhost).toBeGreaterThan(xB);
	});

	it('lays out an all-undated graph deterministically instead of no-op', () => {
		const graph = makeGraph(['Ghost1', 'Ghost2']);

		expect(() => computeTimelineLayout(graph, new Map())).not.toThrow();
		const pos1 = positionOf(graph, 'Ghost1');
		const pos2 = positionOf(graph, 'Ghost2');
		expect(pos1.x).toBe(0);
		expect(pos2.x).toBe(0);
		expect(pos1.y).not.toBe(pos2.y);
	});

	it('is deterministic across repeated calls on the same graph', () => {
		const graph = makeGraph(['A', 'B', 'C']);
		const ctimeByNode = new Map([
			['A', 0],
			['B', 2 * DAY],
			['C', 2 * DAY],
		]);

		computeTimelineLayout(graph, ctimeByNode);
		const first = graph.nodes().map((node) => positionOf(graph, node));

		computeTimelineLayout(graph, ctimeByNode);
		const second = graph.nodes().map((node) => positionOf(graph, node));

		expect(second).toEqual(first);
	});

	it('handles a single-node graph without throwing', () => {
		const graph = makeGraph(['Solo']);
		expect(() => computeTimelineLayout(graph, new Map([['Solo', 0]]))).not.toThrow();
	});

	it('handles an empty graph without throwing', () => {
		const graph = new Graph({ type: 'undirected' });
		expect(() => computeTimelineLayout(graph, new Map())).not.toThrow();
	});

	it('assigns every node a finite position', () => {
		const graph = makeGraph(['A', 'B', 'Ghost']);
		const ctimeByNode = new Map([
			['A', 0],
			['B', 4 * DAY],
		]);

		computeTimelineLayout(graph, ctimeByNode);

		graph.forEachNode((node) => {
			const { x, y } = positionOf(graph, node);
			expect(Number.isFinite(x)).toBe(true);
			expect(Number.isFinite(y)).toBe(true);
		});
	});
});
