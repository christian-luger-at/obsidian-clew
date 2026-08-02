import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { detectCommunities, computeCommunityStats, staleness } from './stagnation';

describe('stagnation', () => {
	describe('detectCommunities', () => {
		it('separates well-connected clusters', () => {
			// Two triangles: A-B-C (old) and D-E-F (fresh), no cross-edges
			const g = new Graph({ type: 'undirected' });
			for (const n of ['A', 'B', 'C', 'D', 'E', 'F']) g.addNode(n);
			g.addEdge('A', 'B');
			g.addEdge('B', 'C');
			g.addEdge('A', 'C');
			g.addEdge('D', 'E');
			g.addEdge('E', 'F');
			g.addEdge('D', 'F');

			const communities = detectCommunities(g);
			const distinctIds = new Set(communities.values());

			expect(distinctIds.size).toBe(2);
			expect(communities.get('A')).toBe(communities.get('B'));
			expect(communities.get('B')).toBe(communities.get('C'));
			expect(communities.get('D')).toBe(communities.get('E'));
			expect(communities.get('E')).toBe(communities.get('F'));
			expect(communities.get('A')).not.toBe(communities.get('D'));
		});

		it('handles single isolated node', () => {
			const g = new Graph({ type: 'undirected' });
			g.addNode('A');

			const communities = detectCommunities(g);
			expect(communities.get('A')).toBeDefined();
		});

		it('handles fully connected graph', () => {
			const g = new Graph({ type: 'undirected' });
			for (const n of ['A', 'B', 'C']) g.addNode(n);
			g.addEdge('A', 'B');
			g.addEdge('B', 'C');
			g.addEdge('A', 'C');

			const communities = detectCommunities(g);
			const distinctIds = new Set(communities.values());

			// Fully connected = 1 community
			expect(distinctIds.size).toBe(1);
		});
	});

	describe('computeCommunityStats', () => {
		it('groups nodes by community and computes mtime stats', () => {
			const communities = new Map([
				['A', 1],
				['B', 1],
				['C', 1],
				['D', 2],
				['E', 2],
				['F', 2],
			]);

			const now = Date.now();
			const DAY = 24 * 60 * 60 * 1000;
			const mtimes: Record<string, number> = {
				A: now - 400 * DAY,
				B: now - 300 * DAY,
				C: now - 350 * DAY,
				D: now - 2 * DAY,
				E: now - 1 * DAY,
				F: now - 5 * DAY,
			};

			const stats = computeCommunityStats(communities, (id) => mtimes[id]!);

			expect(stats).toHaveLength(2);

			const oldCommunity = stats.find((s) => s.communityId === 1);
			const freshCommunity = stats.find((s) => s.communityId === 2);

			expect(oldCommunity).toBeDefined();
			expect(freshCommunity).toBeDefined();

			if (oldCommunity && freshCommunity) {
				expect(oldCommunity.noteCount).toBe(3);
				expect(freshCommunity.noteCount).toBe(3);

				// newest = most recent timestamp
				expect(oldCommunity.newestMtime).toBe(mtimes.B);
				expect(freshCommunity.newestMtime).toBe(mtimes.E);

				// median of sorted mtimes: [now-400d, now-350d, now-300d] -> now-350d (C), [now-5d, now-2d, now-1d] -> now-2d (D)
				expect(oldCommunity.medianMtime).toBe(mtimes.C);
				expect(freshCommunity.medianMtime).toBe(mtimes.D);
			}
		});

		it('handles single-note community', () => {
			const communities = new Map([['A', 1]]);
			const mtime = Date.now();

			const stats = computeCommunityStats(communities, () => mtime);

			expect(stats).toHaveLength(1);
			if (stats[0]) {
				expect(stats[0].noteCount).toBe(1);
				expect(stats[0].newestMtime).toBe(mtime);
				expect(stats[0].medianMtime).toBe(mtime);
			}
		});
	});

	describe('staleness', () => {
		it('returns 1 for the stalest community present', () => {
			const minNewest = Date.now() - 1000;
			const maxNewest = Date.now();
			const stalestMtime = minNewest;

			const result = staleness(stalestMtime, minNewest, maxNewest);
			expect(result).toBe(1);
		});

		it('returns 0 for the freshest community present', () => {
			const minNewest = Date.now() - 1000;
			const maxNewest = Date.now();
			const freshestMtime = maxNewest;

			const result = staleness(freshestMtime, minNewest, maxNewest);
			expect(result).toBe(0);
		});

		it('returns 0 when all communities have the same staleness', () => {
			const mtime = Date.now();
			const result = staleness(mtime, mtime, mtime);
			expect(result).toBe(0);
		});

		it('interpolates for a middle value', () => {
			const minNewest = Date.now() - 1000;
			const maxNewest = Date.now();
			const midMtime = minNewest + (maxNewest - minNewest) / 2;

			const result = staleness(midMtime, minNewest, maxNewest);
			expect(result).toBeCloseTo(0.5, 2);
		});
	});

});
