import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { computeEgoSubgraph } from './egoGraph';

describe('egoGraph', () => {
	describe('computeEgoSubgraph', () => {
		/**
		 * A - B - C - D - E, plus an unconnected node F. A chain rather than a
		 * star/diamond - lets each hop depth pull in exactly one more node,
		 * so the expected set per depth is unambiguous.
		 */
		function chainGraph(): Graph {
			const g = new Graph({ type: 'undirected' });
			for (const n of ['A', 'B', 'C', 'D', 'E', 'F']) g.addNode(n);
			g.addEdge('A', 'B');
			g.addEdge('B', 'C');
			g.addEdge('C', 'D');
			g.addEdge('D', 'E');
			return g;
		}

		it('returns just the focus node at hops 0', () => {
			const result = computeEgoSubgraph(chainGraph(), 'B', 0);
			expect(result).toEqual(new Set(['B']));
		});

		it('includes direct neighbors at hops 1', () => {
			const result = computeEgoSubgraph(chainGraph(), 'B', 1);
			expect(result).toEqual(new Set(['A', 'B', 'C']));
		});

		it('includes neighbors-of-neighbors at hops 2', () => {
			const result = computeEgoSubgraph(chainGraph(), 'B', 2);
			expect(result).toEqual(new Set(['A', 'B', 'C', 'D']));
		});

		it('includes hops 3 worth of neighbors', () => {
			const result = computeEgoSubgraph(chainGraph(), 'B', 3);
			expect(result).toEqual(new Set(['A', 'B', 'C', 'D', 'E']));
		});

		it('never reaches a node with no path to the focus', () => {
			const result = computeEgoSubgraph(chainGraph(), 'B', 10);
			expect(result.has('F')).toBe(false);
		});

		it('stops growing once every reachable node is already included, even with hops left over', () => {
			// hops=10 vs hops=4 (the chain's full reachable diameter from B) -
			// both should land on the exact same set, not error or loop forever
			// once the frontier runs dry.
			const atFullDiameter = computeEgoSubgraph(chainGraph(), 'B', 4);
			const withHopsToSpare = computeEgoSubgraph(chainGraph(), 'B', 10);
			expect(withHopsToSpare).toEqual(atFullDiameter);
		});

		it('treats a negative hop count the same as 0 (just the focus node)', () => {
			const result = computeEgoSubgraph(chainGraph(), 'B', -1);
			expect(result).toEqual(new Set(['B']));
		});

		it('returns an empty set when the focus node is not in the graph', () => {
			const result = computeEgoSubgraph(chainGraph(), 'Nonexistent', 2);
			expect(result).toEqual(new Set());
		});

		it('does not revisit a node reachable by two different routes (diamond)', () => {
			const g = new Graph({ type: 'undirected' });
			for (const n of ['A', 'B', 'C', 'D']) g.addNode(n);
			g.addEdge('A', 'B');
			g.addEdge('A', 'C');
			g.addEdge('B', 'D');
			g.addEdge('C', 'D');

			const result = computeEgoSubgraph(g, 'A', 2);
			expect(result).toEqual(new Set(['A', 'B', 'C', 'D']));
		});
	});
});
