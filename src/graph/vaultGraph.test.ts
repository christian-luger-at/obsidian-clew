import { describe, it, expect } from 'vitest';
import { buildVaultGraph } from './vaultGraph';
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
});
