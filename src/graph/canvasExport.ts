import { App, normalizePath } from 'obsidian';

interface CanvasFileNode {
	id: string;
	type: 'file';
	file: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

interface CanvasEdge {
	id: string;
	fromNode: string;
	toNode: string;
}

export interface CanvasData {
	nodes: CanvasFileNode[];
	edges: CanvasEdge[];
}

const NODE_WIDTH = 280;
const NODE_HEIGHT = 100;
const NODE_GAP = 120;

/**
 * Lays a path out as a simple left-to-right chain (JSON Canvas format,
 * https://jsoncanvas.org/spec/1.0/). The point is getting the subgraph into
 * an editable Canvas, not a polished auto-layout - the user rearranges from
 * here if they want to.
 */
export function pathToCanvas(path: string[]): CanvasData {
	const nodes: CanvasFileNode[] = path.map((filePath, i) => ({
		id: `node-${i}`,
		type: 'file',
		file: filePath,
		x: i * (NODE_WIDTH + NODE_GAP),
		y: 0,
		width: NODE_WIDTH,
		height: NODE_HEIGHT,
	}));

	const edges: CanvasEdge[] = [];
	for (let i = 0; i < path.length - 1; i++) {
		edges.push({ id: `edge-${i}`, fromNode: `node-${i}`, toNode: `node-${i + 1}` });
	}

	return { nodes, edges };
}

function basename(filePath: string): string {
	return filePath.split('/').pop()?.replace(/\.md$/, '') ?? filePath;
}

async function uniqueCanvasPath(app: App, baseName: string): Promise<string> {
	let candidate = normalizePath(`${baseName}.canvas`);
	let suffix = 1;
	while (app.vault.getAbstractFileByPath(candidate)) {
		candidate = normalizePath(`${baseName} (${suffix}).canvas`);
		suffix++;
	}
	return candidate;
}

/** Writes a path as a new .canvas file in the vault root and opens it. */
export async function exportPathToCanvas(app: App, path: string[]): Promise<void> {
	const canvas = pathToCanvas(path);
	const first = path[0] ? basename(path[0]) : 'path';
	const last = path[path.length - 1] ? basename(path[path.length - 1]!) : 'path';
	const filePath = await uniqueCanvasPath(app, `Clew path - ${first} to ${last}`);

	const file = await app.vault.create(filePath, JSON.stringify(canvas, null, '\t'));
	await app.workspace.getLeaf(true).openFile(file);
}
