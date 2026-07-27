import { describe, it, expect } from 'vitest';
import { generateGraph } from './generateGraph';

describe('generateGraph', () => {
	it('generates the requested number of nodes', () => {
		const data = generateGraph({ nodeCount: 100 });

		expect(data.nodes).toHaveLength(100);
	});

	it('is deterministic for a given seed', () => {
		const a = generateGraph({ nodeCount: 200, seed: 42 });
		const b = generateGraph({ nodeCount: 200, seed: 42 });

		expect(a).toEqual(b);
	});

	it('produces a different graph for a different seed', () => {
		const a = generateGraph({ nodeCount: 200, seed: 1 });
		const b = generateGraph({ nodeCount: 200, seed: 2 });

		expect(a).not.toEqual(b);
	});

	it('produces a fully-connected graph (no isolated nodes)', () => {
		const data = generateGraph({ nodeCount: 300, edgesPerNode: 3, seed: 1 });
		const degree = new Map<string, number>();
		for (const node of data.nodes) degree.set(node.id, 0);
		for (const edge of data.edges) {
			degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
			degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
		}

		expect([...degree.values()].every((d) => d > 0)).toBe(true);
	});

	it('produces a hub-heavy (preferential attachment) degree distribution', () => {
		// Barabási–Albert: early nodes should end up with noticeably higher
		// degree on average than late-joining ones - this is the whole point
		// of preferential attachment, and what motivates hub-avoidance in
		// pathfinding.ts.
		const data = generateGraph({ nodeCount: 500, edgesPerNode: 3, seed: 1 });
		const degree = new Map<string, number>();
		for (const node of data.nodes) degree.set(node.id, 0);
		for (const edge of data.edges) {
			degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
			degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
		}

		const early = data.nodes.slice(0, 10).map((n) => degree.get(n.id) ?? 0);
		const late = data.nodes.slice(-10).map((n) => degree.get(n.id) ?? 0);
		const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

		expect(avg(early)).toBeGreaterThan(avg(late));
	});

	it('marks roughly 1% of nodes as having an image at vault scale', () => {
		// imageEvery = floor(nodeCount / 100), so the ~1% figure specifically
		// holds at the scale this is actually used at (10k); it isn't a
		// nodeCount-independent property of the formula.
		const data = generateGraph({ nodeCount: 10_000, seed: 1 });
		const withImage = data.nodes.filter((n) => n.hasImage).length;

		expect(withImage).toBeGreaterThan(50);
		expect(withImage).toBeLessThan(150);
	});

	it('falls back to uniform sampling when degree-weighted sampling cannot find enough distinct targets', () => {
		// Empirically-found parameters (a high edgesPerNode relative to a
		// small seed clique) that exercise the rare fallback path in the
		// preferential-attachment loop - see generateGraph.ts's comment on it.
		// The fallback exists specifically so this doesn't throw or produce
		// too few edges; that's what this test actually verifies.
		const data = generateGraph({ nodeCount: 10, edgesPerNode: 8, seed: 44 });

		expect(data.nodes).toHaveLength(10);
		const degree = new Map<string, number>();
		for (const node of data.nodes) degree.set(node.id, 0);
		for (const edge of data.edges) {
			degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
			degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
		}
		expect([...degree.values()].every((d) => d > 0)).toBe(true);
	});

	it('handles a tiny node count without throwing', () => {
		const data = generateGraph({ nodeCount: 1 });

		expect(data.nodes).toHaveLength(1);
		expect(data.edges).toHaveLength(0);
	});
});
