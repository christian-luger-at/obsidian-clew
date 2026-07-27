import { describe, it, expect } from 'vitest';
import { buildVaultGraph, resetToDeterministicPositions } from './vaultGraph';
import { createFakeApp } from '../../test/fakeApp';

describe('buildVaultGraph', () => {
	it('creates one node per file, including notes with no links', () => {
		const { app, files } = createFakeApp([{ path: 'A.md' }, { path: 'B.md' }, { path: 'Isolated.md' }]);

		const graph = buildVaultGraph(app, files);

		expect(graph.order).toBe(3);
		expect(graph.hasNode('Isolated.md')).toBe(true);
		expect(graph.degree('Isolated.md')).toBe(0);
	});

	it('creates an edge for a resolved link between two notes in the set', () => {
		const { app, files } = createFakeApp([{ path: 'A.md', links: ['B.md'] }, { path: 'B.md' }]);

		const graph = buildVaultGraph(app, files);

		expect(graph.hasEdge('A.md', 'B.md')).toBe(true);
	});

	it('filters out links to notes outside the given file set', () => {
		// A links to "Outside.md", which is never passed to buildVaultGraph -
		// simulates a Base-filtered subset or a link to a non-existent note.
		const { app, files } = createFakeApp([{ path: 'A.md', links: ['Outside.md', 'B.md'] }, { path: 'B.md' }]);

		const graph = buildVaultGraph(app, files);

		expect(graph.hasNode('Outside.md')).toBe(false);
		expect(graph.hasEdge('A.md', 'B.md')).toBe(true);
		expect(graph.degree('A.md')).toBe(1);
	});

	it('filters out self-links', () => {
		const { app, files } = createFakeApp([{ path: 'A.md', links: ['A.md'] }]);

		const graph = buildVaultGraph(app, files);

		expect(graph.degree('A.md')).toBe(0);
	});

	it('deduplicates a bidirectional link into a single undirected edge', () => {
		const { app, files } = createFakeApp([
			{ path: 'A.md', links: ['B.md'] },
			{ path: 'B.md', links: ['A.md'] },
		]);

		const graph = buildVaultGraph(app, files);

		expect(graph.size).toBe(1);
		expect(graph.hasEdge('A.md', 'B.md')).toBe(true);
	});

	it('is undirected by default', () => {
		const { app, files } = createFakeApp([{ path: 'A.md', links: ['B.md'] }, { path: 'B.md' }]);

		const graph = buildVaultGraph(app, files);

		expect(graph.type).toBe('undirected');
		expect(graph.hasEdge('B.md', 'A.md')).toBe(true);
	});

	it('respects the directed option, keeping link direction', () => {
		const { app, files } = createFakeApp([{ path: 'A.md', links: ['B.md'] }, { path: 'B.md' }]);

		const graph = buildVaultGraph(app, files, { directed: true });

		expect(graph.type).toBe('directed');
		expect(graph.hasDirectedEdge('A.md', 'B.md')).toBe(true);
		expect(graph.hasDirectedEdge('B.md', 'A.md')).toBe(false);
	});

	it('resolves a frontmatter cover image to a node image via vault.getResourcePath', () => {
		const { app, files } = createFakeApp([{ path: 'A.md', frontmatter: { cover: 'covers/a.png' } }, { path: 'covers/a.png' }]);

		const graph = buildVaultGraph(app, files);
		const attrs = graph.getNodeAttributes('A.md');

		expect(attrs.type).toBe('image');
		expect(attrs.image).toBe('app://local/covers/a.png');
	});

	it('leaves notes without a cover as plain (non-image) nodes', () => {
		const { app, files } = createFakeApp([{ path: 'A.md' }]);

		const graph = buildVaultGraph(app, files);
		const attrs = graph.getNodeAttributes('A.md');

		expect(attrs.type).toBeUndefined();
		expect(attrs.image).toBeUndefined();
	});

	it('stamps every edge with a pathCost attribute, never named "weight"', () => {
		// Regression test: graphology-layout-forceatlas2 and
		// graphology-communities-louvain both default to reading an edge
		// attribute literally named "weight" for their own purposes. Reusing
		// that name for hub-avoidance cost would silently corrupt the force
		// layout and community detection - see vaultGraph.ts's docstring.
		const { app, files } = createFakeApp([{ path: 'A.md', links: ['B.md'] }, { path: 'B.md' }]);

		const graph = buildVaultGraph(app, files);
		const edge = graph.edge('A.md', 'B.md');
		const attrs = graph.getEdgeAttributes(edge!);

		expect(attrs.pathCost).toBeTypeOf('number');
		expect(attrs.weight).toBeUndefined();
	});

	it('gives higher-degree (hub) nodes a larger size than leaf nodes', () => {
		const { app, files } = createFakeApp([
			{ path: 'Hub.md', links: ['Leaf1.md', 'Leaf2.md', 'Leaf3.md'] },
			{ path: 'Leaf1.md' },
			{ path: 'Leaf2.md' },
			{ path: 'Leaf3.md' },
		]);

		const graph = buildVaultGraph(app, files);

		const hubSize = Number(graph.getNodeAttribute('Hub.md', 'size'));
		const leafSize = Number(graph.getNodeAttribute('Leaf1.md', 'size'));

		expect(hubSize).toBeGreaterThan(leafSize);
	});

	it('gives an isolated (degree-0) node the base size', () => {
		const { app, files } = createFakeApp([{ path: 'Isolated.md' }]);

		const graph = buildVaultGraph(app, files);

		// base size (3) + log(1 + 0) * 1.5 === 3
		expect(graph.getNodeAttribute('Isolated.md', 'size')).toBe(3);
	});

	describe('deterministic layout positions', () => {
		it('gives the same node the same starting position across independent builds', () => {
			// The actual "same graph looks the same on reopen" property -
			// two unrelated buildVaultGraph calls (simulating two separate
			// vault opens) must place A.md identically.
			const fixtureA = createFakeApp([{ path: 'A.md' }, { path: 'B.md' }]);
			const fixtureB = createFakeApp([{ path: 'A.md' }, { path: 'B.md' }]);

			const graphA = buildVaultGraph(fixtureA.app, fixtureA.files);
			const graphB = buildVaultGraph(fixtureB.app, fixtureB.files);

			expect(graphA.getNodeAttribute('A.md', 'x')).toBe(graphB.getNodeAttribute('A.md', 'x'));
			expect(graphA.getNodeAttribute('A.md', 'y')).toBe(graphB.getNodeAttribute('A.md', 'y'));
		});

		it('gives different notes different starting positions', () => {
			const { app, files } = createFakeApp([{ path: 'A.md' }, { path: 'B.md' }]);
			const graph = buildVaultGraph(app, files);

			const a = { x: Number(graph.getNodeAttribute('A.md', 'x')), y: Number(graph.getNodeAttribute('A.md', 'y')) };
			const b = { x: Number(graph.getNodeAttribute('B.md', 'x')), y: Number(graph.getNodeAttribute('B.md', 'y')) };

			expect(a).not.toEqual(b);
		});

		it('decorrelates x and y for the same note (not on the diagonal)', () => {
			const { app, files } = createFakeApp([{ path: 'A.md' }]);
			const graph = buildVaultGraph(app, files);

			expect(graph.getNodeAttribute('A.md', 'x')).not.toBe(graph.getNodeAttribute('A.md', 'y'));
		});

		it('produces positions within [0, 1)', () => {
			const { app, files } = createFakeApp([{ path: 'A.md' }, { path: 'Some/Nested/Path.md' }]);
			const graph = buildVaultGraph(app, files);

			graph.forEachNode((node) => {
				const x = Number(graph.getNodeAttribute(node, 'x'));
				const y = Number(graph.getNodeAttribute(node, 'y'));
				expect(x).toBeGreaterThanOrEqual(0);
				expect(x).toBeLessThan(1);
				expect(y).toBeGreaterThanOrEqual(0);
				expect(y).toBeLessThan(1);
			});
		});

		it('keeps an existing note at the same position when an unrelated note is added', () => {
			// The point of hashing per-node-id rather than consuming a single
			// global RNG in file order: a vault refresh after one note is
			// created shouldn't reshuffle where every *other* note starts.
			const before = createFakeApp([{ path: 'A.md' }, { path: 'B.md' }]);
			const after = createFakeApp([{ path: 'A.md' }, { path: 'B.md' }, { path: 'C.md' }]);

			const graphBefore = buildVaultGraph(before.app, before.files);
			const graphAfter = buildVaultGraph(after.app, after.files);

			expect(graphAfter.getNodeAttribute('A.md', 'x')).toBe(graphBefore.getNodeAttribute('A.md', 'x'));
			expect(graphAfter.getNodeAttribute('A.md', 'y')).toBe(graphBefore.getNodeAttribute('A.md', 'y'));
			expect(graphAfter.getNodeAttribute('B.md', 'x')).toBe(graphBefore.getNodeAttribute('B.md', 'x'));
			expect(graphAfter.getNodeAttribute('B.md', 'y')).toBe(graphBefore.getNodeAttribute('B.md', 'y'));
		});

		it('resetToDeterministicPositions restores the original seed position after it was moved', () => {
			const { app, files } = createFakeApp([{ path: 'A.md' }, { path: 'B.md' }]);
			const graph = buildVaultGraph(app, files);

			const originalX = Number(graph.getNodeAttribute('A.md', 'x'));
			const originalY = Number(graph.getNodeAttribute('A.md', 'y'));

			// Simulate a different layout (e.g. the hierarchical one) having
			// moved the node away from its deterministic starting position.
			graph.setNodeAttribute('A.md', 'x', 999);
			graph.setNodeAttribute('A.md', 'y', 999);

			resetToDeterministicPositions(graph);

			expect(graph.getNodeAttribute('A.md', 'x')).toBe(originalX);
			expect(graph.getNodeAttribute('A.md', 'y')).toBe(originalY);
		});
	});

	describe('pinned positions (GitHub issue #12)', () => {
		it('uses a pinned position instead of the deterministic one, and marks the node fixed', () => {
			const { app, files } = createFakeApp([{ path: 'A.md' }, { path: 'B.md' }]);

			const graph = buildVaultGraph(app, files, { pinnedPositions: { 'A.md': { x: 42, y: 99 } } });

			expect(graph.getNodeAttribute('A.md', 'x')).toBe(42);
			expect(graph.getNodeAttribute('A.md', 'y')).toBe(99);
			expect(graph.getNodeAttribute('A.md', 'fixed')).toBe(true);
		});

		it('leaves an unpinned note with its deterministic position and no fixed attribute', () => {
			const { app, files } = createFakeApp([{ path: 'A.md' }, { path: 'B.md' }]);

			const graph = buildVaultGraph(app, files, { pinnedPositions: { 'A.md': { x: 42, y: 99 } } });

			expect(graph.getNodeAttribute('B.md', 'x')).not.toBe(42);
			expect(graph.getNodeAttribute('B.md', 'fixed')).toBeUndefined();
		});

		it('resetToDeterministicPositions restores a pinned node to its pin, not the hash-derived position', () => {
			const { app, files } = createFakeApp([{ path: 'A.md' }, { path: 'B.md' }]);
			const pinnedPositions = { 'A.md': { x: 42, y: 99 } };
			const graph = buildVaultGraph(app, files, { pinnedPositions });

			// Simulate hierarchical layout having moved the pinned node away,
			// the exact scenario this exists for (hierarchical doesn't
			// respect pins - see resetToDeterministicPositions's docstring).
			graph.setNodeAttribute('A.md', 'x', 12345);
			graph.setNodeAttribute('A.md', 'y', 12345);
			graph.setNodeAttribute('A.md', 'fixed', undefined);

			resetToDeterministicPositions(graph, pinnedPositions);

			expect(graph.getNodeAttribute('A.md', 'x')).toBe(42);
			expect(graph.getNodeAttribute('A.md', 'y')).toBe(99);
			expect(graph.getNodeAttribute('A.md', 'fixed')).toBe(true);
		});

		it('resetToDeterministicPositions still resets an unpinned node normally alongside a pinned one', () => {
			const { app, files } = createFakeApp([{ path: 'A.md' }, { path: 'B.md' }]);
			const pinnedPositions = { 'A.md': { x: 42, y: 99 } };
			const graph = buildVaultGraph(app, files, { pinnedPositions });

			const originalBx = Number(graph.getNodeAttribute('B.md', 'x'));
			const originalBy = Number(graph.getNodeAttribute('B.md', 'y'));
			graph.setNodeAttribute('B.md', 'x', 777);
			graph.setNodeAttribute('B.md', 'y', 777);

			resetToDeterministicPositions(graph, pinnedPositions);

			expect(graph.getNodeAttribute('B.md', 'x')).toBe(originalBx);
			expect(graph.getNodeAttribute('B.md', 'y')).toBe(originalBy);
			expect(graph.getNodeAttribute('B.md', 'fixed')).toBeUndefined();
		});
	});
});
