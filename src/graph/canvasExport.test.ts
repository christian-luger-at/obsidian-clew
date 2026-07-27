import { describe, it, expect } from 'vitest';
import { pathToCanvas, exportPathToCanvas, CanvasData } from './canvasExport';
import { createFakeApp } from '../../test/fakeApp';

describe('pathToCanvas', () => {
	it('creates one canvas node per path entry, laid out left to right', () => {
		const canvas = pathToCanvas(['A.md', 'B.md', 'C.md']);

		expect(canvas.nodes).toHaveLength(3);
		expect(canvas.nodes.map((n) => n.file)).toEqual(['A.md', 'B.md', 'C.md']);
		expect(canvas.nodes[0]!.x).toBeLessThan(canvas.nodes[1]!.x);
		expect(canvas.nodes[1]!.x).toBeLessThan(canvas.nodes[2]!.x);
		expect(canvas.nodes.every((n) => n.type === 'file')).toBe(true);
	});

	it('connects consecutive path nodes with an edge each', () => {
		const canvas = pathToCanvas(['A.md', 'B.md', 'C.md']);

		expect(canvas.edges).toHaveLength(2);
		expect(canvas.edges[0]).toMatchObject({ fromNode: 'node-0', toNode: 'node-1' });
		expect(canvas.edges[1]).toMatchObject({ fromNode: 'node-1', toNode: 'node-2' });
	});

	it('produces a single node and no edges for a single-note path', () => {
		const canvas = pathToCanvas(['Solo.md']);

		expect(canvas.nodes).toHaveLength(1);
		expect(canvas.edges).toHaveLength(0);
	});

	it('produces an empty canvas for an empty path', () => {
		const canvas = pathToCanvas([]);

		expect(canvas.nodes).toHaveLength(0);
		expect(canvas.edges).toHaveLength(0);
	});
});

describe('exportPathToCanvas', () => {
	it('writes a .canvas file named after the path endpoints and opens it', async () => {
		const { app, created, openedPaths } = createFakeApp([{ path: 'Topic A.md' }, { path: 'Topic B.md' }]);

		await exportPathToCanvas(app, ['Topic A.md', 'Topic B.md']);

		expect(created).toHaveLength(1);
		expect(created[0]!.path).toBe('Clew path - Topic A to Topic B.canvas');
		expect(openedPaths).toEqual(['Clew path - Topic A to Topic B.canvas']);

		const written = JSON.parse(created[0]!.data) as CanvasData;
		expect(written.nodes).toHaveLength(2);
	});

	it('appends a numeric suffix when the target filename already exists', async () => {
		const { app, created } = createFakeApp([
			{ path: 'Topic A.md' },
			{ path: 'Topic B.md' },
			// Pre-existing file at the path exportPathToCanvas would otherwise pick.
			{ path: 'Clew path - Topic A to Topic B.canvas' },
		]);

		await exportPathToCanvas(app, ['Topic A.md', 'Topic B.md']);

		expect(created).toHaveLength(1);
		expect(created[0]!.path).toBe('Clew path - Topic A to Topic B (1).canvas');
	});

	it('keeps incrementing the suffix past one collision', async () => {
		const { app, created } = createFakeApp([
			{ path: 'A.md' },
			{ path: 'B.md' },
			{ path: 'Clew path - A to B.canvas' },
			{ path: 'Clew path - A to B (1).canvas' },
		]);

		await exportPathToCanvas(app, ['A.md', 'B.md']);

		expect(created[0]!.path).toBe('Clew path - A to B (2).canvas');
	});

	it('falls back to "path" in the filename for an empty path', async () => {
		const { app, created } = createFakeApp([]);

		await exportPathToCanvas(app, []);

		expect(created[0]!.path).toBe('Clew path - path to path.canvas');
	});
});
