import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { findPaths } from './pathfinding';

describe('pathfinding', () => {
	describe('findPaths', () => {
		it('returns no path when source or target missing', () => {
			const g = new Graph({ type: 'undirected' });
			g.addNode('A');
			g.addNode('B');
			g.addEdge('A', 'B', { pathCost: 1 });

			const result1 = findPaths(g, 'X', 'B');
			const result2 = findPaths(g, 'A', 'Y');

			expect(result1.found).toBe(false);
			expect(result2.found).toBe(false);
		});

		it('finds the shortest path in a simple graph', () => {
			const g = new Graph({ type: 'undirected' });
			for (const n of ['A', 'B', 'C']) g.addNode(n);
			g.addEdge('A', 'B', { pathCost: 1 });
			g.addEdge('B', 'C', { pathCost: 1 });

			const result = findPaths(g, 'A', 'C', 1);

			expect(result.found).toBe(true);
			if (result.found) {
				expect(result.paths).toHaveLength(1);
				expect(result.paths[0]).toEqual(['A', 'B', 'C']);
			}
		});

		it('returns multiple paths when they exist', () => {
			// Diamond: A-B-D, A-C-D (two paths from A to D)
			const g = new Graph({ type: 'undirected' });
			for (const n of ['A', 'B', 'C', 'D']) g.addNode(n);
			g.addEdge('A', 'B', { pathCost: 1 });
			g.addEdge('B', 'D', { pathCost: 1 });
			g.addEdge('A', 'C', { pathCost: 1 });
			g.addEdge('C', 'D', { pathCost: 1 });

			const result = findPaths(g, 'A', 'D', 5);

			expect(result.found).toBe(true);
			if (result.found) {
				// Should find at least 2 distinct paths
				expect(result.paths.length).toBeGreaterThanOrEqual(2);
				expect(result.paths[0]).toEqual(['A', 'B', 'D']);
				expect(result.paths[1]).toEqual(['A', 'C', 'D']);
			}
		});

		it('respects edge weights (pathCost)', () => {
			// A-B is cheaper (cost 1) than A-C-B (cost 2)
			const g = new Graph({ type: 'undirected' });
			for (const n of ['A', 'B', 'C']) g.addNode(n);
			g.addEdge('A', 'B', { pathCost: 1 });
			g.addEdge('A', 'C', { pathCost: 1 });
			g.addEdge('C', 'B', { pathCost: 1 });

			const result = findPaths(g, 'A', 'B', 5);

			expect(result.found).toBe(true);
			if (result.found) {
				// First path should be the direct one (cost 1)
				expect(result.paths[0]).toEqual(['A', 'B']);
				// Alternative path is longer
				expect(result.paths[1]).toEqual(['A', 'C', 'B']);
			}
		});

		it('stops after k=1 when only shortest path is wanted', () => {
			const g = new Graph({ type: 'undirected' });
			for (const n of ['A', 'B', 'C', 'D']) g.addNode(n);
			g.addEdge('A', 'B', { pathCost: 1 });
			g.addEdge('B', 'D', { pathCost: 1 });
			g.addEdge('A', 'C', { pathCost: 1 });
			g.addEdge('C', 'D', { pathCost: 1 });

			const result = findPaths(g, 'A', 'D', 1);

			expect(result.found).toBe(true);
			if (result.found) {
				expect(result.paths).toHaveLength(1);
			}
		});

		it('returns no path when nodes are disconnected', () => {
			const g = new Graph({ type: 'undirected' });
			g.addNode('A');
			g.addNode('B');
			g.addNode('C');
			g.addNode('D');
			g.addEdge('A', 'B', { pathCost: 1 });
			g.addEdge('C', 'D', { pathCost: 1 });
			// A-B and C-D are separate components

			const result = findPaths(g, 'A', 'D');

			expect(result.found).toBe(false);
		});

		it('defaults to k=5 when not specified', () => {
			// Complex graph with many possible paths
			const g = new Graph({ type: 'undirected' });
			for (let i = 0; i < 6; i++) g.addNode(`N${i}`);
			g.addEdge('N0', 'N1', { pathCost: 1 });
			g.addEdge('N1', 'N2', { pathCost: 1 });
			g.addEdge('N0', 'N3', { pathCost: 1 });
			g.addEdge('N3', 'N2', { pathCost: 1 });
			g.addEdge('N0', 'N4', { pathCost: 1 });
			g.addEdge('N4', 'N2', { pathCost: 1 });
			g.addEdge('N0', 'N5', { pathCost: 1 });
			g.addEdge('N5', 'N2', { pathCost: 1 });

			const result = findPaths(g, 'N0', 'N2');

			// Should find multiple paths, up to k=5
			expect(result.found).toBe(true);
			if (result.found) {
				expect(result.paths.length).toBeLessThanOrEqual(5);
				expect(result.paths.length).toBeGreaterThan(1);
			}
		});

		it('handles directed graphs', () => {
			const g = new Graph({ type: 'directed' });
			for (const n of ['A', 'B', 'C', 'D']) g.addNode(n);
			// A -> B -> D and A -> C -> D (directed)
			g.addEdge('A', 'B', { pathCost: 1 });
			g.addEdge('B', 'D', { pathCost: 1 });
			g.addEdge('A', 'C', { pathCost: 1 });
			g.addEdge('C', 'D', { pathCost: 1 });

			const result = findPaths(g, 'A', 'D', 5);

			expect(result.found).toBe(true);
			if (result.found) {
				expect(result.paths[0]).toEqual(['A', 'B', 'D']);
				expect(result.paths[1]).toEqual(['A', 'C', 'D']);
			}
		});
	});
});
