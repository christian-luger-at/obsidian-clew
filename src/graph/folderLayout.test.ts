import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { runFolderLayout } from './folderLayout';

function makeGraph(nodes: [string, Record<string, unknown>?][]): Graph {
	const graph = new Graph({ type: 'undirected' });
	for (const [id, attrs] of nodes) graph.addNode(id, { size: 3, ...attrs });
	return graph;
}

function positionOf(graph: Graph, node: string): { x: number; y: number } {
	return { x: Number(graph.getNodeAttribute(node, 'x')), y: Number(graph.getNodeAttribute(node, 'y')) };
}

describe('runFolderLayout', () => {
	it('assigns every node a finite (x, y) position', () => {
		const graph = makeGraph([['Folder/Note A.md'], ['Folder/Sub/Note B.md'], ['Root note.md']]);

		runFolderLayout(graph);

		graph.forEachNode((node) => {
			const { x, y } = positionOf(graph, node);
			expect(Number.isFinite(x)).toBe(true);
			expect(Number.isFinite(y)).toBe(true);
		});
	});

	it('ranks a note above its own subfolder\'s notes (deeper path = lower rank)', () => {
		const graph = makeGraph([['Folder/Note A.md'], ['Folder/Sub/Note B.md']]);

		runFolderLayout(graph);

		const shallow = positionOf(graph, 'Folder/Note A.md');
		const deep = positionOf(graph, 'Folder/Sub/Note B.md');
		expect(shallow.y).toBeLessThan(deep.y);
	});

	it('places two notes in the same folder at the same rank', () => {
		const graph = makeGraph([['Folder/Note A.md'], ['Folder/Note B.md']]);

		runFolderLayout(graph);

		const a = positionOf(graph, 'Folder/Note A.md');
		const b = positionOf(graph, 'Folder/Note B.md');
		expect(a.y).toBeCloseTo(b.y, 5);
	});

	it('places a root-level note above notes in any subfolder', () => {
		const graph = makeGraph([['Root note.md'], ['Folder/Sub/Note.md']]);

		runFolderLayout(graph);

		const root = positionOf(graph, 'Root note.md');
		const nested = positionOf(graph, 'Folder/Sub/Note.md');
		expect(root.y).toBeLessThan(nested.y);
	});

	it('places ghost/tag nodes without throwing (no real folder to belong to)', () => {
		const graph = makeGraph([
			['Folder/Note.md'],
			['ghost:Missing note', { kind: 'ghost' }],
			['tag:project', { kind: 'tag' }],
		]);

		expect(() => runFolderLayout(graph)).not.toThrow();
		graph.forEachNode((node) => {
			const { x, y } = positionOf(graph, node);
			expect(Number.isFinite(x)).toBe(true);
			expect(Number.isFinite(y)).toBe(true);
		});
	});

	it('gives an attachment node (a real vault path) proper folder placement, same as a note', () => {
		const graph = makeGraph([['attachments/image.png', { kind: 'attachment' }], ['Folder/Note.md']]);

		expect(() => runFolderLayout(graph)).not.toThrow();
		const attachment = positionOf(graph, 'attachments/image.png');
		expect(Number.isFinite(attachment.x)).toBe(true);
		expect(Number.isFinite(attachment.y)).toBe(true);
	});

	it('handles an empty graph without throwing', () => {
		const graph = new Graph({ type: 'undirected' });
		expect(() => runFolderLayout(graph)).not.toThrow();
	});

	it('handles a single node without throwing', () => {
		const graph = makeGraph([['Solo.md']]);
		expect(() => runFolderLayout(graph)).not.toThrow();
	});

	it('falls back to a default footprint when a node has no size attribute', () => {
		const graph = new Graph({ type: 'undirected' });
		graph.addNode('Folder/Note.md');

		expect(() => runFolderLayout(graph)).not.toThrow();
		const { x, y } = positionOf(graph, 'Folder/Note.md');
		expect(Number.isFinite(x)).toBe(true);
		expect(Number.isFinite(y)).toBe(true);
	});

	it('is deterministic across repeated calls on the same graph', () => {
		const graph = makeGraph([['Folder/A.md'], ['Folder/Sub/B.md'], ['Other/C.md']]);

		runFolderLayout(graph);
		const first = graph.nodes().map((node) => positionOf(graph, node));

		runFolderLayout(graph);
		const second = graph.nodes().map((node) => positionOf(graph, node));

		expect(second).toEqual(first);
	});
});
