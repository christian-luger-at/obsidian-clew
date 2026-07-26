import { BasesView, QueryController, TFile } from 'obsidian';
import Graph from 'graphology';
import type Sigma from 'sigma';
import { createRenderer } from './renderer';
import { runLayout, LayoutRun } from './layoutRunner';
import { buildVaultGraph } from './vaultGraph';
import { findPaths, PathResult } from './pathfinding';
import { PathfindingModal } from './pathfindingModal';
import { exportPathToCanvas } from './canvasExport';

/**
 * The real, user-facing graph view (product-vision doc, section 3.1 + the
 * path-finding feature in 3.2). Registered as `clew-graph` / "Graph" -
 * distinct from `clew-spike-graph` ("Graph (spike)"), which stays registered
 * as a dev-only perf/reference check (see DEVELOPMENT.md).
 */

export const CLEW_GRAPH_VIEW = 'clew-graph';

const PRIMARY_PATH_COLOR = '#22c55e';
const ALT_PATH_COLOR = '#eab308';
const DIM_NODE_COLOR = '#4b5563';
const DIM_EDGE_COLOR = '#37415155';

export class GraphView extends BasesView {
	type = CLEW_GRAPH_VIEW;

	/**
	 * Bases views aren't discoverable via `getActiveViewOfType` the way
	 * `ItemView`s are, so the find-path command needs its own way to find
	 * "the current graph view". Tracks the most recently interacted-with
	 * instance; good enough for v1 (multiple simultaneous graph views are an
	 * edge case, not the common path).
	 */
	private static active: GraphView | null = null;
	static getActive(): GraphView | null {
		return GraphView.active;
	}

	private containerEl: HTMLElement;
	private graphContainerEl: HTMLElement;
	private panelEl: HTMLElement;
	private renderer: Sigma | null = null;
	private layout: LayoutRun | null = null;
	private graph: Graph | null = null;

	constructor(controller: QueryController, containerEl: HTMLElement) {
		super(controller);
		this.containerEl = containerEl;
		this.containerEl.classList.add('clew-graph-view');

		// Sigma's kill() clears every child of the element it's given, so it
		// gets its own sub-container - otherwise re-rendering on a Bases data
		// update would wipe the button/panel below along with the canvases.
		this.graphContainerEl = this.containerEl.createDiv({ cls: 'clew-graph-canvas' });

		const findPathButton = this.containerEl.createEl('button', {
			text: 'Find path…',
			cls: 'clew-find-path-button',
		});
		findPathButton.addEventListener('click', () => this.openPathfindingModal());

		this.panelEl = this.containerEl.createDiv({ cls: 'clew-path-panel' });
		this.panelEl.hide();

		this.containerEl.addEventListener('click', () => {
			GraphView.active = this;
		});
	}

	onDataUpdated(): void {
		this.layout?.stop();
		this.renderer?.kill();
		this.graphContainerEl.empty();
		this.clearHighlight();

		this.graph = buildVaultGraph(this.app, this.data.data, { directed: false });
		this.renderer = createRenderer(this.graph, this.graphContainerEl);
		this.layout = runLayout(this.graph, { durationMs: 6000 });

		GraphView.active = this;
	}

	onunload(): void {
		this.layout?.stop();
		this.renderer?.kill();
		if (GraphView.active === this) GraphView.active = null;
	}

	openPathfindingModal(): void {
		if (!this.graph) return;
		const candidates = this.data.data.map((entry) => entry.file);
		new PathfindingModal(this.app, candidates, (request) => {
			this.runPathSearch(request.source, request.target, request.directed);
		}).open();
	}

	private runPathSearch(source: TFile, target: TFile, directed: boolean): void {
		// Rendering always uses an undirected graph (see buildVaultGraph); a
		// directed search rebuilds its own graph just for this query rather
		// than maintaining two synchronized live graphs. Every edge in the
		// directed graph also exists (undirected) in this.graph, so the
		// resulting node/edge ids are still valid for highlighting it.
		const searchGraph = directed ? buildVaultGraph(this.app, this.data.data, { directed: true }) : this.graph;
		if (!searchGraph) return;

		const result = findPaths(searchGraph, source.path, target.path);
		this.renderResult(result);
	}

	private renderResult(result: PathResult): void {
		this.panelEl.empty();
		this.panelEl.show();

		if (!result.found) {
			// "Kein Pfad gefunden" is a result, not an error (doc 3.2).
			this.panelEl.createEl('p', { text: 'No path found between these notes.' });
			this.clearHighlight();
			return;
		}

		this.applyHighlight(result.paths);

		result.paths.forEach((path, index) => {
			const isPrimary = index === 0;
			this.panelEl.createEl('h4', {
				text: isPrimary ? 'Path' : `Alternative ${index}`,
			});
			const list = this.panelEl.createEl('ol');
			for (const nodePath of path) {
				const item = list.createEl('li', { text: basename(nodePath), cls: 'clew-path-item' });
				item.addEventListener('click', () => void this.openNote(nodePath));
			}
		});

		const exportButton = this.panelEl.createEl('button', { text: 'Export path to canvas' });
		exportButton.addEventListener('click', () => {
			void exportPathToCanvas(this.app, result.paths[0]!);
		});

		const clearButton = this.panelEl.createEl('button', { text: 'Clear' });
		clearButton.addEventListener('click', () => {
			this.clearHighlight();
			this.panelEl.hide();
		});
	}

	private applyHighlight(paths: string[][]): void {
		if (!this.renderer || !this.graph) return;

		const primaryNodes = new Set(paths[0]);
		const allNodes = new Set(paths.flat());
		const primaryEdges = new Set(edgeKeysAlongPath(this.graph, paths[0]!));
		const altEdges = new Set(paths.slice(1).flatMap((path) => edgeKeysAlongPath(this.graph!, path)));

		this.renderer.setSetting('nodeReducer', (node, attr) => {
			if (primaryNodes.has(node)) return { ...attr, color: PRIMARY_PATH_COLOR, zIndex: 2, forceLabel: true };
			if (allNodes.has(node)) return { ...attr, color: ALT_PATH_COLOR, zIndex: 1 };
			return { ...attr, color: DIM_NODE_COLOR };
		});

		this.renderer.setSetting('edgeReducer', (edge, attr) => {
			if (primaryEdges.has(edge)) return { ...attr, color: PRIMARY_PATH_COLOR, size: 3, zIndex: 2 };
			if (altEdges.has(edge)) return { ...attr, color: ALT_PATH_COLOR, zIndex: 1 };
			return { ...attr, color: DIM_EDGE_COLOR };
		});
	}

	private clearHighlight(): void {
		this.renderer?.setSetting('nodeReducer', null);
		this.renderer?.setSetting('edgeReducer', null);
	}

	private async openNote(vaultPath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(vaultPath);
		if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
	}
}

function edgeKeysAlongPath(graph: Graph, path: string[]): string[] {
	const keys: string[] = [];
	for (let i = 0; i < path.length - 1; i++) {
		const edge = graph.edge(path[i]!, path[i + 1]!);
		if (edge !== undefined) keys.push(edge);
	}
	return keys;
}

function basename(vaultPath: string): string {
	return vaultPath.split('/').pop()?.replace(/\.md$/, '') ?? vaultPath;
}
