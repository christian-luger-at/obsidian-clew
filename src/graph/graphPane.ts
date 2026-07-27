import { App, TFile } from 'obsidian';
import Graph from 'graphology';
import type Sigma from 'sigma';
import { createRenderer } from './renderer';
import { runLayout, LayoutRun } from './layoutRunner';
import { buildVaultGraph, resetToDeterministicPositions, sizeNodesByDegree } from './vaultGraph';
import { runHierarchicalLayout, HIERARCHICAL_LAYOUT_NODE_LIMIT } from './hierarchicalLayout';
import { findPaths, PathResult } from './pathfinding';
import { PathfindingModal } from './pathfindingModal';
import { exportPathToCanvas } from './canvasExport';
import { CommunityStats, computeCommunityStats, detectCommunities, formatRelativeTime, staleness, stalenessColor } from './stagnation';
import { readThemeColors, ThemeColors } from './theme';
import { colorByCategory, sizeByNumericValue } from './visualEncoding';
import { VisualEncodingModal, VisualEncodingRequest } from './visualEncodingModal';
import type ClewPlugin from '../main';

/** How long ForceAtlas2 briefly re-runs after a drag ends, so neighbors visibly adapt to the dropped node's new (now fixed) position - much shorter than the initial 6s settle, since this is just a local readjustment, not settling the whole graph from scratch. */
const DRAG_SETTLE_DURATION_MS = 1500;

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
	private readonly visualEncodingButton: HTMLButtonElement;
	private renderer: Sigma | null = null;
	private layout: LayoutRun | null = null;
	private graph: Graph | null = null;
	private files: TFile[] = [];
	private mtimeByPath = new Map<string, number>();
	private stagnationActive = false;
	private searchQuery = '';
	private hierarchicalActive = false;
	private theme: ThemeColors;
	private colorProperty: string | null = null;
	private sizeProperty: string | null = null;
	private draggedNode: string | null = null;

	constructor(
		private readonly app: App,
		private readonly containerEl: HTMLElement,
		private readonly plugin: ClewPlugin,
	) {
		this.containerEl.classList.add('clew-graph-view');
		this.theme = readThemeColors(this.containerEl);

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

		// Doc section 3.1 / GitHub issue #1: color/size driven by a chosen
		// frontmatter property instead of the fixed image/degree defaults.
		this.visualEncodingButton = toolbarEl.createEl('button', { text: 'Visual encoding…' });
		this.visualEncodingButton.addEventListener('click', () => this.openVisualEncodingModal());

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
		this.colorProperty = null;
		this.sizeProperty = null;
		this.visualEncodingButton.removeClass('is-active');

		this.files = files;
		this.mtimeByPath = new Map(files.map((file) => [file.path, file.stat.mtime]));
		this.graph = buildVaultGraph(this.app, files, {
			directed: false,
			pinnedPositions: this.plugin.settings.pinnedPositions,
		});
		this.paintVisualEncoding();
		this.renderer = createRenderer(this.graph, this.graphContainerEl, this.theme.defaultEdgeColor);
		this.setupNodeDragging();
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
			if (primaryNodes.has(node)) return { ...attr, color: this.theme.primaryPathColor, zIndex: 2, forceLabel: true };
			if (allNodes.has(node)) return { ...attr, color: this.theme.altPathColor, zIndex: 1 };
			return { ...attr, color: this.theme.dimNodeColor };
		});

		this.renderer.setSetting('edgeReducer', (edge, attr) => {
			if (primaryEdges.has(edge)) return { ...attr, color: this.theme.primaryPathColor, size: 3, zIndex: 2 };
			if (altEdges.has(edge)) return { ...attr, color: this.theme.altPathColor, zIndex: 1 };
			return { ...attr, color: this.theme.dimEdgeColor };
		});
	}

	private clearHighlight(): void {
		this.renderer?.setSetting('nodeReducer', null);
		this.renderer?.setSetting('edgeReducer', null);
	}

	/**
	 * The "nothing else active" color/size - a node's color depends on
	 * `colorProperty` if set (falling back to `type`, plain vs. cover-image,
	 * for any node missing that property, plus the current theme - see
	 * vaultGraph.ts's docstring on why it doesn't set `color` itself), size
	 * on `sizeProperty` if set (falling back to vaultGraph.ts's degree-based
	 * default). sizeNodesByDegree() always runs first to (re-)establish that
	 * true baseline, then the property-driven value overlays wherever it
	 * applies - so switching from one sizeProperty to another, or back to
	 * "Default", never leaves a node showing a stale size left over from a
	 * previous choice that no longer covers it.
	 *
	 * Bakes color/size into each node's own attributes and leaves
	 * nodeReducer null, rather than an always-on reducer computing them
	 * every frame - deliberately not the first version of this (a reducer
	 * set here, removed after it turned out to noticeably slow down
	 * ForceAtlas2's initial settle: unlike the other reducers in this file,
	 * which only run while a user has explicitly turned on a highlight
	 * mode, this one would have run on literally every graph open/refresh,
	 * for the full settle duration, every frame, for every node).
	 * refreshTheme() calls this again (a one-time pass over the graph)
	 * rather than needing a live reducer to react to a theme change.
	 */
	private paintVisualEncoding(): void {
		if (!this.graph) return;
		const graph = this.graph;

		sizeNodesByDegree(graph);
		if (this.sizeProperty) {
			const sizeByNode = sizeByNumericValue(this.propertyValues(this.sizeProperty, toNumberValue));
			graph.forEachNode((node) => {
				const size = sizeByNode.get(node);
				if (size !== undefined) graph.setNodeAttribute(node, 'size', size);
			});
		}

		const colorByNode = this.colorProperty ? colorByCategory(this.propertyValues(this.colorProperty, toStringValue)) : null;
		graph.forEachNode((node, attr) => {
			const defaultColor = attr.type === 'image' ? this.theme.imageNodeColor : this.theme.graphColor;
			graph.setNodeAttribute(node, 'color', colorByNode?.get(node) ?? defaultColor);
		});
	}

	/** Reads a frontmatter property across the current file set, parsing each raw value with `parse` (undefined for anything that doesn't fit). */
	private propertyValues<T>(property: string, parse: (raw: unknown) => T | undefined): Map<string, T | undefined> {
		const result = new Map<string, T | undefined>();
		for (const file of this.files) {
			const raw = this.app.metadataCache.getFileCache(file)?.frontmatter?.[property] as unknown;
			result.set(file.path, parse(raw));
		}
		return result;
	}

	private openVisualEncodingModal(): void {
		if (!this.graph) return;

		const availableProperties = new Set<string>();
		for (const file of this.files) {
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!frontmatter) continue;
			for (const key of Object.keys(frontmatter)) availableProperties.add(key);
		}

		const current: VisualEncodingRequest = { colorProperty: this.colorProperty, sizeProperty: this.sizeProperty };
		new VisualEncodingModal(this.app, [...availableProperties].sort(), current, (request) => {
			this.colorProperty = request.colorProperty;
			this.sizeProperty = request.sizeProperty;
			this.visualEncodingButton.toggleClass('is-active', request.colorProperty !== null || request.sizeProperty !== null);
			this.paintVisualEncoding();
			this.renderer?.refresh();
		}).open();
	}

	/**
	 * Called by StandaloneGraphView on Obsidian's 'css-change' workspace
	 * event (theme switches don't reload the plugin, so nothing else would
	 * trigger a re-read of the CSS variables theme.ts resolves colors from).
	 *
	 * Simplest correct behavior, not the most clever one: drops back to the
	 * neutral default coloring rather than trying to detect which mode
	 * (path result / stagnation / search) was active and replay it with
	 * fresh colors - matches the existing precedent that every mode already
	 * resets on a vault refresh (setFiles()), and a user-initiated theme
	 * switch is rare enough that this isn't worth the added complexity of
	 * remembering and reapplying arbitrary mode state. Layout mode (force
	 * vs. hierarchical) and visual encoding (colorProperty/sizeProperty) are
	 * left untouched here, unlike stagnation/search - neither is actually
	 * theme-dependent (the categorical palette in visualEncoding.ts is a
	 * fixed set of colors, not derived from `this.theme`), so there's
	 * nothing about them a theme switch would make stale. paintVisualEncoding()
	 * still re-runs below, since its *fallback* colors (nodes without the
	 * chosen property) do use `this.theme`.
	 */
	refreshTheme(): void {
		if (!this.graph) return;
		this.theme = readThemeColors(this.containerEl);
		this.renderer?.setSetting('defaultEdgeColor', this.theme.defaultEdgeColor);

		this.stagnationActive = false;
		this.stagnationButton.removeClass('is-active');
		this.clearSearch();
		this.panelEl.empty();
		this.panelEl.hide();
		this.paintVisualEncoding();
		this.clearHighlight();
		this.renderer?.refresh();
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
		// Pinned nodes (GitHub issue #12) are restored to their pin instead,
		// and kept fixed - hierarchical layout doesn't respect pins, so this
		// is what makes a pin survive a round trip through it.
		resetToDeterministicPositions(this.graph, this.plugin.settings.pinnedPositions);
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

	/**
	 * GitHub issue #12: drag a node to reposition it, with neighbors visibly
	 * adapting and the new position persisted. Wired up fresh against every
	 * renderer instance (setFiles() creates a new Sigma each time, so this
	 * runs again each time too) rather than once for the pane's lifetime.
	 *
	 * Force-layout only: hierarchical layout lays out the whole graph fresh
	 * from dagre each time, with no per-node "leave this one alone" concept
	 * the way ForceAtlas2's `fixed` flag provides - dragging a node there
	 * would just get overwritten on the next hierarchical run anyway, so
	 * it's disabled rather than offering an interaction that doesn't stick.
	 */
	private setupNodeDragging(): void {
		if (!this.renderer) return;
		const renderer = this.renderer;
		// Tracks whether the mouse actually moved between downNode and
		// mouseup - a plain click (mousedown+mouseup, no movement) must NOT
		// pin the node where it already was; only a real drag should.
		let dragMoved = false;

		renderer.on('downNode', (payload) => {
			if (this.hierarchicalActive) return;
			this.draggedNode = payload.node;
			dragMoved = false;
			renderer.getCamera().disable();
		});

		renderer.getMouseCaptor().on('mousemovebody', (coordinates) => {
			if (!this.draggedNode || !this.graph) return;
			dragMoved = true;
			const position = renderer.viewportToGraph(coordinates);
			this.graph.setNodeAttribute(this.draggedNode, 'x', position.x);
			this.graph.setNodeAttribute(this.draggedNode, 'y', position.y);

			// Otherwise sigma also tries to pan/select on the same drag.
			coordinates.preventSigmaDefault();
			coordinates.original.preventDefault();
			coordinates.original.stopPropagation();
		});

		const endDrag = (): void => {
			if (!this.draggedNode) return;
			if (dragMoved) this.finishDrag(this.draggedNode);
			this.draggedNode = null;
			renderer.getCamera().enable();
		};
		renderer.getMouseCaptor().on('mouseup', endDrag);
		// Also on mouseleave, so releasing the button outside the canvas
		// doesn't leave a drag "stuck" with the camera permanently disabled.
		renderer.getMouseCaptor().on('mouseleave', endDrag);
	}

	/**
	 * Pins the dropped node at its current position (persisted via
	 * ClewPlugin's settings - see settings.ts's PinnedPosition) and marks it
	 * `fixed` so future layout runs never move it again, then briefly
	 * re-runs ForceAtlas2 (DRAG_SETTLE_DURATION_MS, much shorter than the
	 * initial 6s settle) so its neighbors visibly readjust to the new
	 * position - the whole point of using FA2's `fixed` flag rather than a
	 * dumber "just move it and freeze everything" drag, see
	 * vaultGraph.ts's BuildVaultGraphOptions.pinnedPositions docstring for
	 * why this makes neighbors adapt instead of the pin sitting there inert.
	 */
	private finishDrag(node: string): void {
		if (!this.graph) return;
		const x = Number(this.graph.getNodeAttribute(node, 'x'));
		const y = Number(this.graph.getNodeAttribute(node, 'y'));
		this.graph.setNodeAttribute(node, 'fixed', true);

		this.plugin.settings.pinnedPositions[node] = { x, y };
		void this.plugin.saveSettings();

		this.layout?.stop();
		this.layout = runLayout(this.graph, { durationMs: DRAG_SETTLE_DURATION_MS });
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
			stats.map((s) => [
				s.communityId,
				stalenessColor(staleness(s.newestMtime, minNewest, maxNewest), this.theme.freshColorRgb, this.theme.staleColorRgb),
			]),
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
			if (label.includes(q)) return { ...attr, color: this.theme.matchColor, zIndex: 2, forceLabel: true };
			return { ...attr, color: this.theme.dimNodeColor };
		});
		this.renderer.setSetting('edgeReducer', (edge, attr) => ({ ...attr, color: this.theme.dimEdgeColor }));
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
			if (nodeSet.has(node)) return { ...attr, color: this.theme.matchColor, zIndex: 2, forceLabel: true };
			return { ...attr, color: this.theme.dimNodeColor };
		});
		this.renderer.setSetting('edgeReducer', (edge, attr) => {
			if (edgeSet.has(edge)) return { ...attr, color: this.theme.matchColor, size: 2, zIndex: 2 };
			return { ...attr, color: this.theme.dimEdgeColor };
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

/**
 * Frontmatter values are usually a string, number, or boolean - stringified
 * directly. An array-valued property (e.g. a multi-value select/list) is
 * joined into one category rather than picking one value or producing
 * "[object Object]" - a reasonable, simple fallback, not a claim that it's
 * the "right" way to categorize a list. Any other object shape isn't
 * treated as colorable at all.
 */
function toStringValue(raw: unknown): string | undefined {
	if (Array.isArray(raw)) return raw.map((item) => toStringValue(item) ?? '').join(', ');
	if (typeof raw === 'string') return raw;
	if (typeof raw === 'number' || typeof raw === 'boolean') return raw.toString();
	return undefined;
}

function toNumberValue(raw: unknown): number | undefined {
	return typeof raw === 'number' ? raw : undefined;
}
