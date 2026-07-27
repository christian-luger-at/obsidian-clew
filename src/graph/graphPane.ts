import { App, TFile } from 'obsidian';
import Graph from 'graphology';
import type Sigma from 'sigma';
import { createRenderer } from './renderer';
import { runLayout, LayoutRun } from './layoutRunner';
import { buildVaultGraph, resetToDeterministicPositions } from './vaultGraph';
import { runHierarchicalLayout, HIERARCHICAL_LAYOUT_NODE_LIMIT } from './hierarchicalLayout';
import { findPaths, PathResult } from './pathfinding';
import { PathfindingModal } from './pathfindingModal';
import { exportPathToCanvas } from './canvasExport';
import { CommunityStats, computeCommunityStats, detectCommunities, formatRelativeTime, staleness, stalenessColor } from './stagnation';

const PRIMARY_PATH_COLOR = '#22c55e';
const ALT_PATH_COLOR = '#eab308';
const DIM_NODE_COLOR = '#4b5563';
const DIM_EDGE_COLOR = '#37415155';
// Shared "this is what you're looking for" accent - community-focus clicks
// and search-match highlighting are different triggers for the same idea,
// so they share one color rather than each getting their own.
const MATCH_COLOR = '#22c55e';
const MIN_COMMUNITY_SIZE_SHOWN = 2;

/**
 * Graph-rendering + path-finding UI, composed into StandaloneGraphView
 * rather than inherited so the rendering/UI logic stays separate from
 * Obsidian's view lifecycle (onOpen/onClose etc.).
 */
export class GraphPane {
	/**
	 * Tracks the most recently interacted-with pane, so the "Find path"
	 * command can target "the current graph" - a plain ItemView isn't
	 * discoverable via `getActiveViewOfType` the way MarkdownView is.
	 */
	private static active: GraphPane | null = null;
	static getActive(): GraphPane | null {
		return GraphPane.active;
	}

	private readonly graphContainerEl: HTMLElement;
	private readonly panelEl: HTMLElement;
	private readonly stagnationButton: HTMLElement;
	private readonly searchInputEl: HTMLInputElement;
	private readonly hierarchicalButton: HTMLButtonElement;
	private renderer: Sigma | null = null;
	private layout: LayoutRun | null = null;
	private graph: Graph | null = null;
	private files: TFile[] = [];
	private mtimeByPath = new Map<string, number>();
	private stagnationActive = false;
	private searchQuery = '';
	private hierarchicalActive = false;

	constructor(
		private readonly app: App,
		private readonly containerEl: HTMLElement,
	) {
		this.containerEl.classList.add('clew-graph-view');

		// Sigma's kill() clears every child of the element it's given, so it
		// gets its own sub-container - otherwise re-rendering would wipe the
		// button/panel below along with the canvases.
		this.graphContainerEl = this.containerEl.createDiv({ cls: 'clew-graph-canvas' });

		const toolbarEl = this.containerEl.createDiv({ cls: 'clew-toolbar' });

		const findPathButton = toolbarEl.createEl('button', { text: 'Find path…' });
		findPathButton.addEventListener('click', () => this.openPathfindingModal());

		this.stagnationButton = toolbarEl.createEl('button', { text: 'Stagnation heatmap' });
		this.stagnationButton.addEventListener('click', () => this.toggleStagnationHeatmap());

		// Disabled/re-enabled per graph size in setFiles() - hierarchical
		// layout's crossing-minimization step doesn't scale to vault-sized
		// graphs (see hierarchicalLayout.ts).
		this.hierarchicalButton = toolbarEl.createEl('button', { text: 'Hierarchical layout' });
		this.hierarchicalButton.addEventListener('click', () => this.toggleHierarchicalLayout());

		// Focus mode: highlights matches, dims the rest - doesn't filter/hide
		// anything, so the surrounding structure stays visible for context
		// (doc's "Fokusmodus", matching an open Obsidian forum request rather
		// than the more disruptive "hide non-matches" a naive filter would do).
		this.searchInputEl = toolbarEl.createEl('input', {
			type: 'search',
			placeholder: 'Search notes…',
			cls: 'clew-search-input',
		});
		this.searchInputEl.addEventListener('input', () => this.onSearchInput(this.searchInputEl.value));

		this.panelEl = this.containerEl.createDiv({ cls: 'clew-path-panel' });
		this.panelEl.hide();

		this.containerEl.addEventListener('click', () => {
			GraphPane.active = this;
		});
	}

	setFiles(files: TFile[]): void {
		this.layout?.stop();
		this.renderer?.kill();
		this.graphContainerEl.empty();
		// Isn't rebuilt from the new file set automatically - a note deleted
		// (or filtered out) mid-result would otherwise leave stale entries
		// with dead click handlers.
		this.panelEl.empty();
		this.panelEl.hide();
		this.stagnationActive = false;
		this.stagnationButton.removeClass('is-active');
		this.clearSearch();
		this.hierarchicalActive = false;
		this.hierarchicalButton.removeClass('is-active');
		this.hierarchicalButton.setText('Hierarchical layout');

		this.files = files;
		this.mtimeByPath = new Map(files.map((file) => [file.path, file.stat.mtime]));
		this.graph = buildVaultGraph(this.app, files, { directed: false });
		this.renderer = createRenderer(this.graph, this.graphContainerEl);
		this.layout = runLayout(this.graph, { durationMs: 6000 });

		// Proactively disable rather than let the user click and get
		// rejected - see HIERARCHICAL_LAYOUT_NODE_LIMIT's docstring for why
		// this exists at all.
		const tooLarge = this.graph.order > HIERARCHICAL_LAYOUT_NODE_LIMIT;
		this.hierarchicalButton.disabled = tooLarge;
		this.hierarchicalButton.title = tooLarge
			? `Too many notes (${this.graph.order}) for hierarchical layout - it doesn't scale past ~${HIERARCHICAL_LAYOUT_NODE_LIMIT}.`
			: '';

		GraphPane.active = this;
	}

	destroy(): void {
		this.layout?.stop();
		this.renderer?.kill();
		if (GraphPane.active === this) GraphPane.active = null;
	}

	openPathfindingModal(): void {
		if (!this.graph) return;
		this.hideStagnationHeatmap();
		this.clearSearch();
		new PathfindingModal(this.app, this.files, (request) => {
			this.runPathSearch(request.source, request.target, request.directed);
		}).open();
	}

	private runPathSearch(source: TFile, target: TFile, directed: boolean): void {
		// Rendering always uses an undirected graph (see buildVaultGraph); a
		// directed search rebuilds its own graph just for this query rather
		// than maintaining two synchronized live graphs. Every edge in the
		// directed graph also exists (undirected) in this.graph, so the
		// resulting node/edge ids are still valid for highlighting it.
		const searchGraph = directed ? buildVaultGraph(this.app, this.files, { directed: true }) : this.graph;
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
			this.panelEl.createEl('h4', {
				text: index === 0 ? 'Path' : `Alternative ${index}`,
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

	private toggleHierarchicalLayout(): void {
		if (this.hierarchicalButton.disabled) return;
		if (this.hierarchicalActive) {
			this.setForceLayout();
		} else {
			this.setHierarchicalLayout();
		}
	}

	private setHierarchicalLayout(): void {
		if (!this.graph) return;
		this.layout?.stop();

		// dagre.layout() is synchronous and, at the sizes this is allowed to
		// run at, can still take a few seconds (see hierarchicalLayout.ts) -
		// disable the button and show that something is happening, then
		// yield one tick so that actually paints before the blocking call
		// starts, rather than the UI just looking frozen for that long.
		this.hierarchicalButton.disabled = true;
		this.hierarchicalButton.setText('Computing…');

		window.setTimeout(() => {
			if (!this.graph) return;
			runHierarchicalLayout(this.graph);
			void this.resetCameraAndRefresh();

			this.hierarchicalActive = true;
			this.hierarchicalButton.disabled = false;
			this.hierarchicalButton.setText('Hierarchical layout');
			this.hierarchicalButton.addClass('is-active');
		}, 0);
	}

	private setForceLayout(): void {
		if (!this.graph) return;
		this.hierarchicalActive = false;
		this.hierarchicalButton.removeClass('is-active');

		// Restores the deterministic seed rather than letting FA2 relax from
		// wherever the hierarchical layout left nodes - otherwise the "same
		// graph looks the same on reopen" guarantee (see vaultGraph.ts)
		// would depend on layout-switch history, not just the graph itself.
		resetToDeterministicPositions(this.graph);
		this.layout = runLayout(this.graph, { durationMs: 6000 });
		void this.resetCameraAndRefresh();
	}

	/**
	 * Camera reset alone isn't enough after a bulk position change (switching
	 * layouts moves every node at once, unlike FA2's gradual per-frame
	 * relaxation): sigma's `hideEdgesOnMove` treats a running camera
	 * animation as "moving" and hides edges for its duration, but sigma's
	 * render loop is event-driven, not continuous - if nothing schedules a
	 * repaint after the animation's last frame, the view can be left
	 * showing that final "still moving, edges hidden" frame indefinitely.
	 * Explicitly refreshing once the animation's promise resolves guarantees
	 * one more paint against the now-idle camera state.
	 */
	private async resetCameraAndRefresh(): Promise<void> {
		await this.renderer?.getCamera().animatedReset();
		this.renderer?.refresh();
	}

	private toggleStagnationHeatmap(): void {
		if (this.stagnationActive) {
			this.hideStagnationHeatmap();
		} else {
			this.showStagnationHeatmap();
		}
	}

	private showStagnationHeatmap(): void {
		if (!this.graph) return;
		this.clearSearch();
		this.stagnationActive = true;
		this.stagnationButton.addClass('is-active');

		const communities = detectCommunities(this.graph);
		const stats = computeCommunityStats(communities, (nodeId) => this.mtimeByPath.get(nodeId) ?? 0);
		const newestValues = stats.map((s) => s.newestMtime);
		const minNewest = Math.min(...newestValues);
		const maxNewest = Math.max(...newestValues);
		const colorByCommunity = new Map(
			stats.map((s) => [s.communityId, stalenessColor(staleness(s.newestMtime, minNewest, maxNewest))]),
		);

		this.renderer?.setSetting('nodeReducer', (node, attr) => {
			const communityId = communities.get(node);
			const color = communityId !== undefined ? colorByCommunity.get(communityId) : undefined;
			return color ? { ...attr, color } : attr;
		});
		this.renderer?.setSetting('edgeReducer', null);

		this.renderStagnationPanel(stats);
	}

	private hideStagnationHeatmap(): void {
		if (!this.stagnationActive) return;
		this.stagnationActive = false;
		this.stagnationButton.removeClass('is-active');
		this.clearHighlight();
		this.panelEl.empty();
		this.panelEl.hide();
	}

	private onSearchInput(value: string): void {
		this.searchQuery = value.trim();

		if (this.searchQuery) {
			// Mutually exclusive with the other modes, same as they are with
			// each other - clears their state directly rather than only
			// overwriting reducers, so re-toggling one of them later doesn't
			// resurrect stale UI (e.g. the stagnation button staying "active").
			this.hideStagnationHeatmap();
			this.panelEl.empty();
			this.panelEl.hide();
			this.applyFocusFilter(this.searchQuery);
		} else {
			this.clearHighlight();
		}
	}

	private applyFocusFilter(query: string): void {
		if (!this.renderer) return;
		const q = query.toLowerCase();

		this.renderer.setSetting('nodeReducer', (node, attr) => {
			const label = typeof attr.label === 'string' ? attr.label.toLowerCase() : '';
			if (label.includes(q)) return { ...attr, color: MATCH_COLOR, zIndex: 2, forceLabel: true };
			return { ...attr, color: DIM_NODE_COLOR };
		});
		this.renderer.setSetting('edgeReducer', (edge, attr) => ({ ...attr, color: DIM_EDGE_COLOR }));
	}

	/** Resets search state - called when another mode takes over, not from the search input's own handler (which must never overwrite what the user is actively typing). */
	private clearSearch(): void {
		this.searchQuery = '';
		this.searchInputEl.value = '';
	}

	private renderStagnationPanel(stats: CommunityStats[]): void {
		this.panelEl.empty();
		this.panelEl.show();

		const shown = stats
			.filter((community) => community.noteCount >= MIN_COMMUNITY_SIZE_SHOWN)
			.sort((a, b) => a.newestMtime - b.newestMtime);

		if (shown.length === 0) {
			this.panelEl.createEl('p', { text: `No clusters with ${MIN_COMMUNITY_SIZE_SHOWN}+ notes found.` });
			return;
		}

		this.panelEl.createEl('h4', { text: 'Stagnation by cluster (stalest first)' });
		const list = this.panelEl.createEl('ol');
		for (const community of shown) {
			const item = list.createEl('li', { cls: 'clew-path-item' });
			item.createDiv({ text: `${community.noteCount} notes` });
			item.createDiv({ text: `newest edit: ${formatRelativeTime(community.newestMtime)}` });
			item.createDiv({ text: `median edit: ${formatRelativeTime(community.medianMtime)}` });
			item.addEventListener('click', () => this.focusCommunity(community.nodeIds));
		}
	}

	private focusCommunity(nodeIds: string[]): void {
		if (!this.renderer || !this.graph) return;
		const graph = this.graph;
		const nodeSet = new Set(nodeIds);
		const edgeSet = new Set(
			graph.edges().filter((edge) => nodeSet.has(graph.source(edge)) && nodeSet.has(graph.target(edge))),
		);

		this.renderer.setSetting('nodeReducer', (node, attr) => {
			if (nodeSet.has(node)) return { ...attr, color: MATCH_COLOR, zIndex: 2, forceLabel: true };
			return { ...attr, color: DIM_NODE_COLOR };
		});
		this.renderer.setSetting('edgeReducer', (edge, attr) => {
			if (edgeSet.has(edge)) return { ...attr, color: MATCH_COLOR, size: 2, zIndex: 2 };
			return { ...attr, color: DIM_EDGE_COLOR };
		});
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
