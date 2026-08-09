import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { computeBetweenness, computePageRank, normalizeToUnitRange } from './graphAnalytics';

describe('graphAnalytics', () => {
	describe('computeBetweenness', () => {
		it('gives the middle node of a path the highest betweenness', () => {
			// A-B-C: every shortest path between A and C runs through B.
			const g = new Graph({ type: 'undirected' });
			for (const n of ['A', 'B', 'C']) g.addNode(n);
			g.addEdge('A', 'B');
			g.addEdge('B', 'C');

			const result = computeBetweenness(g);
			expect(result.get('B')).toBeGreaterThan(result.get('A') ?? 0);
			expect(result.get('B')).toBeGreaterThan(result.get('C') ?? 0);
		});

		it('gives every node in a fully connected graph zero betweenness', () => {
			// Direct edges everywhere - no shortest path ever needs an
			// intermediate node.
			const g = new Graph({ type: 'undirected' });
			for (const n of ['A', 'B', 'C']) g.addNode(n);
			g.addEdge('A', 'B');
			g.addEdge('B', 'C');
			g.addEdge('A', 'C');

			const result = computeBetweenness(g);
			expect(result.get('A')).toBe(0);
			expect(result.get('B')).toBe(0);
			expect(result.get('C')).toBe(0);
		});

		it('is not thrown off by an edge attribute literally named `weight`', () => {
			// Same pitfall as graphology-layout-forceatlas2/graphology-communities-louvain -
			// a `weight` edge attribute must not silently change the result.
			const g = new Graph({ type: 'undirected' });
			for (const n of ['A', 'B', 'C']) g.addNode(n);
			g.addEdge('A', 'B', { weight: 1000 });
			g.addEdge('B', 'C', { weight: 1000 });

			const result = computeBetweenness(g);
			expect(result.get('B')).toBeGreaterThan(0);
		});
	});

	describe('computePageRank', () => {
		it('gives the most-linked-to node the highest pagerank', () => {
			// Hub is linked from three others - should rank highest.
			const g = new Graph({ type: 'undirected' });
			for (const n of ['Hub', 'A', 'B', 'C']) g.addNode(n);
			g.addEdge('Hub', 'A');
			g.addEdge('Hub', 'B');
			g.addEdge('Hub', 'C');

			const result = computePageRank(g);
			expect(result.get('Hub')).toBeGreaterThan(result.get('A') ?? 0);
			expect(result.get('Hub')).toBeGreaterThan(result.get('B') ?? 0);
			expect(result.get('Hub')).toBeGreaterThan(result.get('C') ?? 0);
		});

		it('splits evenly across a symmetric ring', () => {
			const g = new Graph({ type: 'undirected' });
			for (const n of ['A', 'B', 'C', 'D']) g.addNode(n);
			g.addEdge('A', 'B');
			g.addEdge('B', 'C');
			g.addEdge('C', 'D');
			g.addEdge('D', 'A');

			const result = computePageRank(g);
			const values = [...result.values()];
			for (const value of values) expect(value).toBeCloseTo(0.25, 2);
		});
	});

	describe('normalizeToUnitRange', () => {
		it('maps the minimum to 0 and the maximum to 1', () => {
			const values = new Map([
				['A', 10],
				['B', 20],
				['C', 30],
			]);
			const result = normalizeToUnitRange(values);
			expect(result.get('A')).toBe(0);
			expect(result.get('B')).toBe(0.5);
			expect(result.get('C')).toBe(1);
		});

		it('maps every value to 0 when they are all equal', () => {
			const values = new Map([
				['A', 5],
				['B', 5],
			]);
			const result = normalizeToUnitRange(values);
			expect(result.get('A')).toBe(0);
			expect(result.get('B')).toBe(0);
		});

		it('returns an empty map for an empty input', () => {
			expect(normalizeToUnitRange(new Map()).size).toBe(0);
		});
	});
});
