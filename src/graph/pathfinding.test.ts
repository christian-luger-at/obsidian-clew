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

		it('picks the cheapest of several same-round alternatives, discarding the rest', () => {
			// Shaped so two different spur points in the same k-round each
			// still have a valid, equal-cost detour after their root-path
			// nodes are dropped: exercises both the seen/B.some() de-dup
			// check and the B.sort() cost ordering (a graph with only ever
			// one alternative per round never reaches those - sort/some
			// don't invoke their callback for fewer than 2/0 elements).
			// Yen's algorithm keeps only the single cheapest candidate per
			// round, so of the two equal-cost detours found here (via F,
			// via G), only the first-found (via F) survives into the
			// result - the other is legitimately discarded, not a bug.
			//
			// Primary route: A-B-C-D-E. Detours: B-F-D (bypasses C), C-G-E
			// (bypasses D).
			const g = new Graph({ type: 'undirected' });
			for (const n of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) g.addNode(n);
			const edges: [string, string][] = [
				['A', 'B'],
				['B', 'C'],
				['C', 'D'],
				['D', 'E'],
				['B', 'F'],
				['F', 'D'],
				['C', 'G'],
				['G', 'E'],
			];
			for (const [a, b] of edges) g.addEdge(a, b, { pathCost: 1 });

			const result = findPaths(g, 'A', 'E', 2);

			expect(result.found).toBe(true);
			if (result.found) {
				expect(result.paths[0]).toEqual(['A', 'B', 'C', 'D', 'E']);
				expect(result.paths[1]).toEqual(['A', 'B', 'F', 'D', 'E']);
				expect(result.paths).not.toContainEqual(['A', 'B', 'C', 'G', 'E']);
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

		describe('excluded notes (GitHub backlog item 6)', () => {
			it('routes around an excluded node entirely, never appearing in any candidate path', () => {
				// A-B-D and A-C-D (two paths from A to D) - excluding B should
				// force every route through C instead.
				const g = new Graph({ type: 'undirected' });
				for (const n of ['A', 'B', 'C', 'D']) g.addNode(n);
				g.addEdge('A', 'B', { pathCost: 1 });
				g.addEdge('B', 'D', { pathCost: 1 });
				g.addEdge('A', 'C', { pathCost: 1 });
				g.addEdge('C', 'D', { pathCost: 1 });

				const result = findPaths(g, 'A', 'D', 5, ['B']);

				expect(result.found).toBe(true);
				if (result.found) {
					expect(result.paths).toHaveLength(1);
					expect(result.paths[0]).toEqual(['A', 'C', 'D']);
					expect(result.paths.flat()).not.toContain('B');
				}
			});

			it('excludes a node even when it would only appear on a worse alternative route, not the shortest one', () => {
				// Shortest: A-B-E. Excluding C (which only appears on the
				// costlier A-C-E detour) must never surface it as "Alt 1" -
				// filtering after the fact instead of before could otherwise
				// let a still-cheaper-than-nothing excluded route through.
				const g = new Graph({ type: 'undirected' });
				for (const n of ['A', 'B', 'C', 'D', 'E']) g.addNode(n);
				g.addEdge('A', 'B', { pathCost: 1 });
				g.addEdge('B', 'E', { pathCost: 1 });
				g.addEdge('A', 'C', { pathCost: 1 });
				g.addEdge('C', 'D', { pathCost: 1 });
				g.addEdge('D', 'E', { pathCost: 1 });

				const result = findPaths(g, 'A', 'E', 5, ['C']);

				expect(result.found).toBe(true);
				if (result.found) {
					expect(result.paths).toHaveLength(1);
					expect(result.paths[0]).toEqual(['A', 'B', 'E']);
				}
			});

			it('returns no path when every route is blocked by an excluded node', () => {
				const g = new Graph({ type: 'undirected' });
				for (const n of ['A', 'B', 'D']) g.addNode(n);
				g.addEdge('A', 'B', { pathCost: 1 });
				g.addEdge('B', 'D', { pathCost: 1 });
				// B is the only connection between A and D.

				const result = findPaths(g, 'A', 'D', 5, ['B']);

				expect(result.found).toBe(false);
			});

			it('returns no path when the source or target itself is excluded', () => {
				const g = new Graph({ type: 'undirected' });
				g.addNode('A');
				g.addNode('B');
				g.addEdge('A', 'B', { pathCost: 1 });

				expect(findPaths(g, 'A', 'B', 5, ['A']).found).toBe(false);
				expect(findPaths(g, 'A', 'B', 5, ['B']).found).toBe(false);
			});

			it('ignores excluded ids that are not in the graph at all', () => {
				const g = new Graph({ type: 'undirected' });
				g.addNode('A');
				g.addNode('B');
				g.addEdge('A', 'B', { pathCost: 1 });

				const result = findPaths(g, 'A', 'B', 5, ['DoesNotExist']);

				expect(result.found).toBe(true);
				if (result.found) expect(result.paths[0]).toEqual(['A', 'B']);
			});

			it('behaves exactly like no exclusions at all when the excluded list is empty', () => {
				const g = new Graph({ type: 'undirected' });
				for (const n of ['A', 'B', 'C']) g.addNode(n);
				g.addEdge('A', 'B', { pathCost: 1 });
				g.addEdge('B', 'C', { pathCost: 1 });

				const withEmpty = findPaths(g, 'A', 'C', 5, []);
				const without = findPaths(g, 'A', 'C', 5);

				expect(withEmpty).toEqual(without);
			});
		});
	});
});
