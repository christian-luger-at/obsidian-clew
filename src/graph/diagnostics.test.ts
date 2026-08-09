import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { findOrphans, findBrokenLinks, findConnectedComponents, findIsolatedClusters } from './diagnostics';

describe('diagnostics', () => {
	describe('findOrphans', () => {
		it('returns notes with no links, sorted by display name', () => {
			const g = new Graph({ type: 'undirected' });
			g.addNode('Zebra.md');
			g.addNode('Apple.md');
			g.addNode('Hub.md');
			g.addNode('Leaf.md');
			g.addEdge('Hub.md', 'Leaf.md');

			expect(findOrphans(g)).toEqual(['Apple.md', 'Zebra.md']);
		});

		it('returns an empty list when every note has at least one link', () => {
			const g = new Graph({ type: 'undirected' });
			g.addNode('A.md');
			g.addNode('B.md');
			g.addEdge('A.md', 'B.md');

			expect(findOrphans(g)).toEqual([]);
		});
	});

	describe('findBrokenLinks', () => {
		it('flattens unresolved links restricted to the given source set', () => {
			const unresolvedLinks = {
				'A.md': { 'Missing One': 1, 'Missing Two': 2 },
				'Outside.md': { 'Missing Three': 1 },
				'B.md': {},
			};

			const links = findBrokenLinks(unresolvedLinks, new Set(['A.md', 'B.md']));

			expect(links).toEqual([
				{ source: 'A.md', target: 'Missing One' },
				{ source: 'A.md', target: 'Missing Two' },
			]);
		});

		it('returns an empty list when there are no unresolved links', () => {
			expect(findBrokenLinks({}, new Set(['A.md']))).toEqual([]);
		});
	});

	describe('findConnectedComponents', () => {
		it('groups nodes by reachability, largest component first', () => {
			const g = new Graph({ type: 'undirected' });
			for (const n of ['A', 'B', 'C', 'D', 'E']) g.addNode(n);
			g.addEdge('A', 'B');
			g.addEdge('B', 'C');
			g.addEdge('D', 'E');

			const components = findConnectedComponents(g).map((c) => c.slice().sort());

			expect(components).toEqual([
				['A', 'B', 'C'],
				['D', 'E'],
			]);
		});

		it('treats an orphan as its own size-1 component', () => {
			const g = new Graph({ type: 'undirected' });
			g.addNode('A');
			g.addNode('B');

			const components = findConnectedComponents(g);

			expect(components).toHaveLength(2);
			expect(components.every((c) => c.length === 1)).toBe(true);
		});
	});

	describe('findIsolatedClusters', () => {
		it('drops the main component and any size-1 components', () => {
			const g = new Graph({ type: 'undirected' });
			for (const n of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) g.addNode(n);
			// Main body: A-B-C-D
			g.addEdge('A', 'B');
			g.addEdge('B', 'C');
			g.addEdge('C', 'D');
			// Isolated cluster: E-F
			g.addEdge('E', 'F');
			// Orphan: G (no edges)

			const clusters = findIsolatedClusters(g).map((c) => c.slice().sort());

			expect(clusters).toEqual([['E', 'F']]);
		});

		it('returns an empty list for a single connected graph', () => {
			const g = new Graph({ type: 'undirected' });
			g.addNode('A');
			g.addNode('B');
			g.addEdge('A', 'B');

			expect(findIsolatedClusters(g)).toEqual([]);
		});

		it('returns an empty list for an empty graph', () => {
			const g = new Graph({ type: 'undirected' });
			expect(findIsolatedClusters(g)).toEqual([]);
		});
	});
});
