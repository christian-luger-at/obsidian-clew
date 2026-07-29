import { App, Setting, TFile } from 'obsidian';
import Graph from 'graphology';
import type Sigma from 'sigma';
import { createRenderer, createNodeHoverDrawer } from './renderer';
import { runLayout, LayoutRun } from './layoutRunner';
import { buildVaultGraph, resetToDeterministicPositions, sizeNodesByDegree } from './vaultGraph';
import { runHierarchicalLayout, HIERARCHICAL_LAYOUT_NODE_LIMIT } from './hierarchicalLayout';
import { computeRadialLayout } from './radialLayout';
import { computeCircularLayout } from './circularLayout';
import { findPaths, PathResult } from './pathfinding';
import { PathfindingModal } from './pathfindingModal';
import { RadialLayoutModal } from './radialLayoutModal';
import { exportPathToCanvas } from './canvasExport';
import { CommunityStats, computeCommunityStats, detectCommunities, formatRelativeTime, staleness, stalenessColor } from './stagnation';
import { readThemeColors, ThemeColors } from './theme';
import { assignCategoryColors, colorByCategory, sizeByNumericValue } from './visualEncoding';
import { VisualEncodingModal, VisualEncodingRequest } from './visualEncodingModal';
import { ClewAppearanceSettings, DEFAULT_APPEARANCE_SETTINGS } from '../settings';
import type ClewPlugin from '../main';

/** Wall-clock budget for the initial force-layout settle when a graph is (re)built - not user-tunable (unlike gravity/scalingRatio), since a longer settle mostly just delays interactivity rather than visibly improving the result. */
const SETTLE_DURATION_MS = 2000;

/** How long ForceAtlas2 briefly re-runs after a drag ends, so neighbors visibly adapt to the dropped node's new (now fixed) position - shorter than the initial settle, since this is just a local readjustment, not settling the whole graph from scratch. */
const DRAG_SETTLE_DURATION_MS = 1500;

const MIN_COMMUNITY_SIZE_SHOWN = 2;

/** Caps the visual-encoding legend so a property with many distinct values doesn't turn it into a second scrollable panel. */
const MAX_LEGEND_CATEGORIES = 8;

/**
 * 'force' is the only mode with live physics (ForceAtlas2) and the only one
 * dragging (setupNodeDragging) or pinning (finishDrag) works against - the
 * other three lay the whole graph out fresh from a pure function each time,
 * with no per-node "leave this one alone" concept.
 */
type LayoutMode = 'force' | 'hierarchical' | 'radial' | 'circular';

/** Debounces the expensive part of an appearance slider's onChange (disk write + live re-render/re-layout) - a slider fires on every 'input' tick while dragging, and persisting + restarting ForceAtlas2 on every single tick would both spam disk writes and make the graph flicker instead of tuning smoothly. */
function debounce(fn: () => void, delayMs: number): () => void {
	let timer: number | null = null;
	return () => {
		if (timer !== null) window.clearTimeout(timer);
		timer = window.setTimeout(fn, delayMs);
	};
}

interface AppearanceSliderSpec {
	// Excludes edgeColorOverride - the one non-numeric (string | null)
	// appearance setting, which has its own color-picker UI instead of a
	// slider (see renderAppearancePanel()'s "Colors" section).
	key: Exclude<keyof ClewAppearanceSettings, 'edgeColorOverride'>;
	name: string;
	desc: string;
	min: number;
	max: number;
	step: number;
	/**
	 * Which live-reapply category this setting needs after a change - node
	 * size and label LOD are cheap (repaint/refresh only), a layout restart
	 * is inherently disruptive (repositions every node), so these are kept
	 * separate rather than one "reapply everything" call that would restart
	 * physics on every slider, including ones that don't need it.
	 */
	apply: 'size' | 'label' | 'layout';
}

/**
 * Every number here was previously a hardcoded constant scattered across
 * vaultGraph.ts/layoutRunner.ts/renderer.ts/radialLayout.ts/circularLayout.ts/
 * hierarchicalLayout.ts - user feedback comparing Clew's graph against
 * Obsidian's own core Graph View led to three rounds of manually re-tuning
 * node size alone in one session, which is exactly the friction a live
 * setting removes. Lives in the graph view itself (GraphPane's
 * "Appearance…" panel), not the plugin Settings tab - tuning these only
 * makes sense while watching the graph react, which a separate Settings
 * screen can't offer.
 */
const APPEARANCE_SLIDER_GROUPS: { heading: string; sliders: AppearanceSliderSpec[] }[] = [
	{
		heading: 'Node size',
		sliders: [
			{
				key: 'nodeBaseSize',
				name: 'Base node size',
				desc: 'Size of a plain note with no links (degree 0).',
				min: 0.5,
				max: 12,
				step: 0.1,
				apply: 'size',
			},
			{
				key: 'nodeImageBaseSize',
				name: 'Cover-image node size',
				desc: 'Size of a note with a cover image, at degree 0 - kept larger than a plain note so the image inside stays recognizable.',
				min: 1,
				max: 6,
				step: 0.1,
				apply: 'size',
			},
			{
				key: 'nodeDegreeGrowth',
				name: 'Hub growth',
				desc: 'How much bigger a highly-linked note gets than one with few links.',
				min: 0,
				max: 2,
				step: 0.1,
				apply: 'size',
			},
		],
	},
	{
		heading: 'Physics (force layout)',
		sliders: [
			{
				key: 'gravity',
				name: 'Gravity',
				desc: 'Pull toward the center - higher keeps the graph more compact.',
				min: 0.01,
				max: 0.5,
				step: 0.01,
				apply: 'layout',
			},
			{
				key: 'scalingRatio',
				name: 'Scaling ratio',
				desc: 'Overall repulsion between notes - higher spreads the graph out more.',
				min: 1,
				max: 50,
				step: 1,
				apply: 'layout',
			},
		],
	},
	{
		heading: 'Labels',
		sliders: [
			{
				key: 'labelSizeThreshold',
				name: 'Label size threshold',
				desc: 'How large a note has to appear on screen before its name is shown - higher hides more labels when zoomed out.',
				min: 2,
				max: 30,
				step: 1,
				apply: 'label',
			},
			{
				key: 'labelDensity',
				name: 'Label density',
				desc: 'How many labels are allowed to show at once in a given area.',
				min: 0,
				max: 2,
				step: 0.1,
				apply: 'label',
			},
		],
	},
	{
		heading: 'Alternative layout spacing',
		sliders: [
			{
				key: 'radialRingSpacing',
				name: 'Radial ring spacing',
				desc: 'Distance between successive rings in the radial layout.',
				min: 40,
				max: 300,
				step: 10,
				apply: 'layout',
			},
			{
				key: 'circularRadius',
				name: 'Circular layout radius',
				desc: 'Size of the single ring every note is placed on in the circular layout.',
				min: 100,
				max: 800,
				step: 20,
				apply: 'layout',
			},
			{
				key: 'hierarchicalNodeSpacing',
				name: 'Hierarchical node spacing',
				desc: 'Space between notes on the same level in the hierarchical layout.',
				min: 10,
				max: 100,
				step: 5,
				apply: 'layout',
			},
			{
				key: 'hierarchicalRankSpacing',
				name: 'Hierarchical level spacing',
				desc: 'Space between levels in the hierarchical layout.',
				min: 20,
				max: 200,
				step: 10,
				apply: 'layout',
			},
		],
	},
];

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
	private readonly legendEl: HTMLElement;
	private readonly appearancePanelEl: HTMLElement;
	private readonly stagnationButton: HTMLElement;
	private readonly searchInputEl: HTMLInputElement;
	private readonly hierarchicalButton: HTMLButtonElement;
	private readonly radialButton: HTMLButtonElement;
	private readonly circularButton: HTMLButtonElement;
	private readonly layoutButtons: HTMLButtonElement[];
	private readonly visualEncodingButton: HTMLButtonElement;
	private readonly appearanceButton: HTMLButtonElement;
	private renderer: Sigma | null = null;
	private layout: LayoutRun | null = null;
	private graph: Graph | null = null;
	private files: TFile[] = [];
	private mtimeByPath = new Map<string, number>();
	private stagnationActive = false;
	private searchQuery = '';
	private layoutMode: LayoutMode = 'force';
	private theme: ThemeColors;
	private colorProperty: string | null = null;
	private sizeProperty: string | null = null;
	private draggedNode: string | null = null;
	/**
	 * Whether the mouse actually moved between downNode and mouseup - a
	 * plain click (mousedown+mouseup, no movement) must NOT pin the node
	 * where it already was, only a real drag should, and setupNodeClick()
	 * must NOT open the note after a real drag. An instance field (not a
	 * closure-local variable inside setupNodeDragging()) specifically so
	 * setupNodeClick()'s separate 'clickNode' handler can read it too - see
	 * that method's docstring for why this is necessary at all.
	 */
	private dragMoved = false;
	/** Whether a found path result is the reason nodes/edges are currently colored - see renderLegend()'s precedence over this vs. stagnation/search, which visually override a path's reducer when active. */
	private pathResultActive = false;
	/** Remembers the radial layout's chosen focus note so an appearance-panel change can re-apply it (reapplyActiveLayout()) without re-prompting for a note. */
	private radialFocusNode: string | null = null;

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

		// Rings the graph out from one chosen note by link distance (see
		// radialLayout.ts) - needs a focus note, so this opens a picker
		// rather than toggling straight on like the other layout buttons.
		this.radialButton = toolbarEl.createEl('button', { text: 'Radial layout…' });
		this.radialButton.addEventListener('click', () => this.openRadialLayoutModal());

		// All notes on a single ring (see circularLayout.ts) - no
		// configuration needed, so this toggles directly like hierarchical.
		this.circularButton = toolbarEl.createEl('button', { text: 'Circular layout' });
		this.circularButton.addEventListener('click', () => this.toggleCircularLayout());

		this.layoutButtons = [this.hierarchicalButton, this.radialButton, this.circularButton];

		// Doc section 3.1 / GitHub issue #1: color/size driven by a chosen
		// frontmatter property instead of the fixed image/degree defaults.
		this.visualEncodingButton = toolbarEl.createEl('button', { text: 'Visual encoding…' });
		this.visualEncodingButton.addEventListener('click', () => this.openVisualEncodingModal());

		// Node size / physics / label / layout-spacing tuning - lives here
		// (not the plugin's Settings tab) since the user adjusts these while
		// watching the graph react, not on a separate settings screen.
		this.appearanceButton = toolbarEl.createEl('button', { text: 'Appearance…' });
		this.appearanceButton.addEventListener('click', () => this.toggleAppearancePanel());

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

		// Bottom-left - opposite the top-left toolbar and top-right path
		// panel, so it doesn't compete with either for space.
		this.legendEl = this.containerEl.createDiv({ cls: 'clew-legend' });

		// Bottom-right - the one remaining free corner.
		this.appearancePanelEl = this.containerEl.createDiv({ cls: 'clew-appearance-panel' });
		this.appearancePanelEl.hide();

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
		this.layoutMode = 'force';
		for (const button of this.layoutButtons) button.removeClass('is-active');
		this.hierarchicalButton.setText('Hierarchical layout');
		this.colorProperty = null;
		this.sizeProperty = null;
		this.visualEncodingButton.removeClass('is-active');
		this.pathResultActive = false;

		this.files = files;
		this.mtimeByPath = new Map(files.map((file) => [file.path, file.stat.mtime]));
		this.graph = buildVaultGraph(this.app, files, {
			directed: false,
			pinnedPositions: this.plugin.settings.pinnedPositions,
		});
		this.paintVisualEncoding();
		const appearance = this.plugin.settings.appearance;
		this.renderer = createRenderer(this.graph, this.graphContainerEl, {
			defaultEdgeColor: this.resolvedEdgeColor(),
			labelColor: this.theme.labelColor,
			hoverBackgroundColor: this.theme.backgroundColor,
			labelRenderedSizeThreshold: appearance.labelSizeThreshold,
			labelDensity: appearance.labelDensity,
		});
		this.setupNodeDragging();
		this.setupNodeClick();
		this.setupNodeHover();
		this.layout = runLayout(this.graph, this.layoutOptions(SETTLE_DURATION_MS));

		// Proactively disable rather than let the user click and get
		// rejected - see HIERARCHICAL_LAYOUT_NODE_LIMIT's docstring for why
		// this exists at all.
		const tooLarge = this.graph.order > HIERARCHICAL_LAYOUT_NODE_LIMIT;
		this.hierarchicalButton.disabled = tooLarge;
		this.hierarchicalButton.title = tooLarge
			? `Too many notes (${this.graph.order}) for hierarchical layout - it doesn't scale past ~${HIERARCHICAL_LAYOUT_NODE_LIMIT}.`
			: '';

		this.renderLegend();
		GraphPane.active = this;
	}

	/**
	 * Live-reapply hooks for the Appearance panel (renderAppearancePanel()
	 * below), called right after a slider changes so tuning gives immediate
	 * feedback on the graph instead of only taking effect on the next vault
	 * refresh/layout switch. Split into three instead of one "reapply
	 * everything" method: node size and label LOD are cheap (repaint +
	 * refresh, no physics), while a layout restart is inherently disruptive
	 * (repositions every node) - a user nudging the node-size slider
	 * shouldn't also restart ForceAtlas2 on every tick.
	 */
	private applyNodeSizeSettings(): void {
		if (!this.graph) return;
		this.paintVisualEncoding();
		this.renderer?.refresh();
	}

	private applyLabelSettings(): void {
		if (!this.renderer) return;
		const appearance = this.plugin.settings.appearance;
		this.renderer.setSetting('labelRenderedSizeThreshold', appearance.labelSizeThreshold);
		this.renderer.setSetting('labelDensity', appearance.labelDensity);
		this.renderer.refresh();
	}

	/** The theme's edge color (with theme.ts's contrast-safety fallback already applied), unless the user picked an explicit override - see ClewAppearanceSettings.edgeColorOverride. */
	private resolvedEdgeColor(): string {
		return this.plugin.settings.appearance.edgeColorOverride ?? this.theme.defaultEdgeColor;
	}

	private applyEdgeColorSetting(): void {
		this.renderer?.setSetting('defaultEdgeColor', this.resolvedEdgeColor());
		this.renderer?.refresh();
	}

	/** Re-runs whichever layout is currently active with the latest physics/spacing settings - a no-op for radial if no focus note has been chosen yet this session (nothing to re-center on). */
	private reapplyActiveLayout(): void {
		if (!this.graph) return;
		switch (this.layoutMode) {
			case 'force':
				this.setForceLayout();
				break;
			case 'hierarchical':
				this.setHierarchicalLayout();
				break;
			case 'radial':
				if (this.radialFocusNode) this.setRadialLayout(this.radialFocusNode);
				break;
			case 'circular':
				this.setCircularLayout();
				break;
		}
	}

	private toggleAppearancePanel(): void {
		if (this.appearancePanelEl.isShown()) {
			this.appearancePanelEl.hide();
			this.appearanceButton.removeClass('is-active');
		} else {
			this.renderAppearancePanel();
			this.appearancePanelEl.show();
			this.appearanceButton.addClass('is-active');
		}
	}

	/**
	 * Rebuilt from scratch each time the panel opens (not built once and
	 * left standing) so it always reflects the current settings - notably
	 * after "Reset to defaults", where every slider needs to visibly jump
	 * back rather than silently disagree with the values it just wrote.
	 */
	private renderAppearancePanel(): void {
		this.appearancePanelEl.empty();
		this.appearancePanelEl.createEl('h4', { text: 'Graph appearance' });

		new Setting(this.appearancePanelEl).setName('Colors').setHeading();
		new Setting(this.appearancePanelEl)
			.setName('Edge color')
			.setDesc(
				'Uses the current theme\'s color by default (with an automatic fallback if that color is too hard to see against the background). Pick a color to override it.',
			)
			.addColorPicker((picker) =>
				picker.setValue(toHexColor(this.resolvedEdgeColor())).onChange((value) => {
					this.plugin.settings.appearance.edgeColorOverride = value;
					void this.plugin.saveSettings();
					this.applyEdgeColorSetting();
				}),
			)
			.addExtraButton((button) =>
				button
					.setIcon('rotate-ccw')
					.setTooltip('Reset to theme color')
					.onClick(() => {
						this.plugin.settings.appearance.edgeColorOverride = null;
						void this.plugin.saveSettings();
						this.applyEdgeColorSetting();
						this.renderAppearancePanel();
					}),
			);

		for (const group of APPEARANCE_SLIDER_GROUPS) {
			new Setting(this.appearancePanelEl).setName(group.heading).setHeading();

			for (const spec of group.sliders) {
				// A fresh debouncer per slider (not shared) - each one only
				// ever needs to coalesce that single slider's own rapid
				// 'input' events, not compete with other sliders' timers.
				const debouncedApply = debounce(() => {
					void this.plugin.saveSettings();
					this.applyAppearanceCategory(spec.apply);
				}, 250);

				new Setting(this.appearancePanelEl)
					.setName(spec.name)
					.setDesc(spec.desc)
					.addSlider((slider) =>
						slider
							.setLimits(spec.min, spec.max, spec.step)
							.setValue(this.plugin.settings.appearance[spec.key])
							.setDynamicTooltip()
							.onChange((value) => {
								this.plugin.settings.appearance[spec.key] = value;
								debouncedApply();
							}),
					);
			}
		}

		new Setting(this.appearancePanelEl)
			.setName('Reset to defaults')
			.addButton((button) =>
				button.setButtonText('Reset').onClick(async () => {
					this.plugin.settings.appearance = { ...DEFAULT_APPEARANCE_SETTINGS };
					await this.plugin.saveSettings();
					this.applyEdgeColorSetting();
					this.applyNodeSizeSettings();
					this.applyLabelSettings();
					this.reapplyActiveLayout();
					this.renderAppearancePanel();
				}),
			);
	}

	private applyAppearanceCategory(category: AppearanceSliderSpec['apply']): void {
		if (category === 'size') this.applyNodeSizeSettings();
		else if (category === 'label') this.applyLabelSettings();
		else this.reapplyActiveLayout();
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
			this.renderLegend();
			return;
		}

		this.applyHighlight(result.paths);
		this.pathResultActive = true;
		this.renderLegend();

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
			this.renderLegend();
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
		this.pathResultActive = false;
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
		const appearance = this.plugin.settings.appearance;

		sizeNodesByDegree(graph, {
			baseSize: appearance.nodeBaseSize,
			imageBaseSize: appearance.nodeImageBaseSize,
			degreeGrowth: appearance.nodeDegreeGrowth,
		});
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

	/**
	 * GitHub issue #13: a small always-visible key explaining what the
	 * current node/edge colors mean - without it, the graph's coloring
	 * (which means something different depending on which mode is active)
	 * is unexplained decoration. Called from every mode-transition point
	 * rather than computed lazily on render, matching this file's existing
	 * pattern of pushing state changes into their own DOM update (e.g.
	 * button `is-active` classes) right where the state changes.
	 *
	 * Reflects what's actually painted right now, not merely which piece of
	 * state happens to be set: stagnation and search both overwrite
	 * whatever reducer a shown path result set, so they take precedence
	 * here too, ahead of pathResultActive - otherwise toggling the heatmap
	 * on top of a shown path would leave the legend describing colors that
	 * are no longer on screen.
	 */
	private renderLegend(): void {
		this.legendEl.empty();

		if (this.stagnationActive) {
			this.addLegendItem(rgbToCss(this.theme.freshColorRgb), 'Recently edited cluster');
			this.addLegendItem(rgbToCss(this.theme.staleColorRgb), 'Stagnant cluster');
			return;
		}
		if (this.searchQuery) {
			this.addLegendItem(this.theme.matchColor, 'Matches search');
			this.addLegendItem(this.theme.dimNodeColor, 'No match');
			return;
		}
		if (this.pathResultActive) {
			this.addLegendItem(this.theme.primaryPathColor, 'Shortest path');
			this.addLegendItem(this.theme.altPathColor, 'Alternative path');
			this.addLegendItem(this.theme.dimNodeColor, 'Not on a shown path');
			return;
		}
		if (this.colorProperty) {
			const values = [...this.propertyValues(this.colorProperty, toStringValue).values()].filter(
				(value): value is string => value !== undefined,
			);
			const entries = [...assignCategoryColors(values).entries()];
			const shown = entries.slice(0, MAX_LEGEND_CATEGORIES);
			for (const [value, color] of shown) this.addLegendItem(color, value);
			if (entries.length > shown.length) {
				this.legendEl.createDiv({ cls: 'clew-legend-item', text: `+${entries.length - shown.length} more` });
			}
			return;
		}

		this.addLegendItem(this.theme.graphColor, 'Note');
		this.addLegendItem(this.theme.imageNodeColor, 'Note with cover image');
	}

	private addLegendItem(color: string, label: string): void {
		const item = this.legendEl.createDiv({ cls: 'clew-legend-item' });
		item.createSpan({ cls: 'clew-legend-swatch' }).style.backgroundColor = color;
		item.createSpan({ text: label });
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
			this.renderLegend();
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
		this.renderer?.setSetting('defaultEdgeColor', this.resolvedEdgeColor());
		this.renderer?.setSetting('labelColor', { color: this.theme.labelColor });
		this.renderer?.setSetting('defaultDrawNodeHover', createNodeHoverDrawer(this.theme.backgroundColor));

		this.stagnationActive = false;
		this.stagnationButton.removeClass('is-active');
		this.clearSearch();
		this.panelEl.empty();
		this.panelEl.hide();
		this.paintVisualEncoding();
		this.clearHighlight();
		this.renderer?.refresh();
		this.renderLegend();
	}

	/** Clears every layout button's `is-active` class and activates only the given one (none, for 'force') - kept in one place so the buttons can never end up disagreeing with `layoutMode` or each other. */
	private activateLayoutMode(mode: LayoutMode, activeButton: HTMLButtonElement | null): void {
		this.layoutMode = mode;
		for (const button of this.layoutButtons) button.removeClass('is-active');
		activeButton?.addClass('is-active');
	}

	private toggleHierarchicalLayout(): void {
		if (this.hierarchicalButton.disabled) return;
		if (this.layoutMode === 'hierarchical') {
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
			const appearance = this.plugin.settings.appearance;
			runHierarchicalLayout(this.graph, {
				nodesep: appearance.hierarchicalNodeSpacing,
				ranksep: appearance.hierarchicalRankSpacing,
			});
			void this.resetCameraAndRefresh();

			this.activateLayoutMode('hierarchical', this.hierarchicalButton);
			this.hierarchicalButton.disabled = false;
			this.hierarchicalButton.setText('Hierarchical layout');
		}, 0);
	}

	private toggleCircularLayout(): void {
		if (this.layoutMode === 'circular') {
			this.setForceLayout();
		} else {
			this.setCircularLayout();
		}
	}

	private setCircularLayout(): void {
		if (!this.graph) return;
		this.layout?.stop();
		computeCircularLayout(this.graph, this.plugin.settings.appearance.circularRadius);
		this.activateLayoutMode('circular', this.circularButton);
		void this.resetCameraAndRefresh();
	}

	/**
	 * Needs a focus note first (radialLayout.ts rings the graph out from
	 * one), so unlike the other layout buttons this opens a picker instead
	 * of toggling straight on - but re-clicking it while radial is already
	 * active still toggles back to force, matching the others.
	 */
	private openRadialLayoutModal(): void {
		if (!this.graph) return;
		if (this.layoutMode === 'radial') {
			this.setForceLayout();
			return;
		}
		new RadialLayoutModal(this.app, this.files, (focusFile) => this.setRadialLayout(focusFile.path)).open();
	}

	private setRadialLayout(focusPath: string): void {
		if (!this.graph) return;
		this.layout?.stop();
		this.radialFocusNode = focusPath;
		computeRadialLayout(this.graph, focusPath, this.plugin.settings.appearance.radialRingSpacing);
		this.activateLayoutMode('radial', this.radialButton);
		void this.resetCameraAndRefresh();
	}

	private setForceLayout(): void {
		if (!this.graph) return;
		this.activateLayoutMode('force', null);

		// Restores the deterministic seed rather than letting FA2 relax from
		// wherever the previous layout left nodes - otherwise the "same
		// graph looks the same on reopen" guarantee (see vaultGraph.ts)
		// would depend on layout-switch history, not just the graph itself.
		// Pinned nodes (GitHub issue #12) are restored to their pin instead,
		// and kept fixed - none of the other layouts respect pins, so this
		// is what makes a pin survive a round trip through any of them.
		resetToDeterministicPositions(this.graph, this.plugin.settings.pinnedPositions);
		this.layout = runLayout(this.graph, this.layoutOptions(SETTLE_DURATION_MS));
		void this.resetCameraAndRefresh();
	}

	/** ForceAtlas2 options shared by every runLayout() call site - gravity/scalingRatio are user-tunable (Settings tab), only the duration differs per call site (initial settle vs. the short post-drag re-settle). */
	private layoutOptions(durationMs: number): { durationMs: number; gravity: number; scalingRatio: number } {
		const appearance = this.plugin.settings.appearance;
		return { durationMs, gravity: appearance.gravity, scalingRatio: appearance.scalingRatio };
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
	 * Force-layout only (see LayoutMode's docstring): every other layout lays
	 * out the whole graph fresh from a pure function each time, with no
	 * per-node "leave this one alone" concept the way ForceAtlas2's `fixed`
	 * flag provides - dragging a node there would just get overwritten on
	 * the next layout run anyway, so it's disabled rather than offering an
	 * interaction that doesn't stick.
	 */
	private setupNodeDragging(): void {
		if (!this.renderer) return;
		const renderer = this.renderer;

		renderer.on('downNode', (payload) => {
			// Reset unconditionally, even in a layout mode where dragging
			// itself is disabled below - otherwise this.dragMoved could be
			// left stale from an earlier force-mode drag and incorrectly
			// suppress setupNodeClick()'s open-note handling after a later
			// plain click made in a different layout mode.
			this.dragMoved = false;
			if (this.layoutMode !== 'force') return;
			this.draggedNode = payload.node;
			renderer.getCamera().disable();
		});

		renderer.getMouseCaptor().on('mousemovebody', (coordinates) => {
			if (!this.draggedNode || !this.graph) return;
			this.dragMoved = true;
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
			if (this.dragMoved) this.finishDrag(this.draggedNode);
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
		this.layout = runLayout(this.graph, this.layoutOptions(DRAG_SETTLE_DURATION_MS));
	}

	/**
	 * GitHub issue #10: click a node to open its note - matches Obsidian's
	 * own core Graph View convention (single click opens), rather than
	 * introducing a different interaction Clew users would have to relearn.
	 *
	 * sigma's own `clickNode` does NOT reliably skip firing after a real
	 * drag here - user-reported: dropping a dragged node also opened its
	 * note. sigma's built-in click/drag differentiation apparently doesn't
	 * account for setupNodeDragging()'s own manual position updates (driven
	 * off the mouse captor's 'mousemovebody', not sigma's default drag
	 * handling), so `clickNode` still fires on mouseup purely based on
	 * "released over the same node," regardless of movement in between.
	 * Explicitly checked against this.dragMoved instead - set by
	 * setupNodeDragging() on the very first 'mousemovebody' tick, so it's
	 * already correct by the time this fires no matter which of the two
	 * mouseup-triggered handlers runs first.
	 */
	private setupNodeClick(): void {
		if (!this.renderer) return;
		this.renderer.on('clickNode', (payload) => {
			if (this.dragMoved) return;
			void this.openNote(payload.node);
		});
	}

	/**
	 * GitHub issue #9: hovering a node highlights it, dimming everything
	 * that isn't it or a direct neighbor - deliberately hover, not click, so
	 * it doesn't compete with click-to-open (setupNodeClick) for the same
	 * gesture.
	 *
	 * Only the hovered node itself gets the "prominent" treatment (accent
	 * color, raised above everything else) - user feedback: an earlier
	 * version also recolored every neighbor, which read as "everything is
	 * highlighted" rather than clearly marking one node as selected.
	 * Neighbors instead keep their exact current color (`base` below -
	 * whatever a stagnation heatmap/search/path mode already painted them,
	 * or their normal baked-in color otherwise) - they're exempted from
	 * dimming, not recolored. Their label *is* forced on though (reversing
	 * an even earlier attempt at hiding it) - user feedback: being able to
	 * read which notes a hovered note connects to, without also opening a
	 * path-finding query, is the actual point of this feature.
	 *
	 * Composes with whatever mode is currently active (default coloring,
	 * stagnation heatmap, search, a shown path result) rather than
	 * replacing it: saves the current nodeReducer/edgeReducer via
	 * renderer.getSetting() before overlaying the hover highlight, and
	 * restores exactly those saved reducers on mouse-leave - so hovering
	 * while, say, the stagnation heatmap is active leaves neighbors showing
	 * their heatmap colors untouched, and un-hovering returns to the
	 * heatmap exactly as it was, not a reset to plain default coloring.
	 */
	private setupNodeHover(): void {
		if (!this.renderer) return;
		const renderer = this.renderer;

		// Bridges state between the enterNode/leaveNode handlers below - both
		// registered once (not re-registered per hover, which would leak a
		// new leaveNode listener - closured over a *fresh* previous-reducer
		// pair - on every single hover instead of reusing one).
		let hoveredNode: string | null = null;
		let previousNodeReducer = renderer.getSetting('nodeReducer');
		let previousEdgeReducer = renderer.getSetting('edgeReducer');

		renderer.on('enterNode', (payload) => {
			if (this.draggedNode || !this.graph) return;
			const graph = this.graph;
			hoveredNode = payload.node;

			const neighbors = new Set(graph.neighbors(hoveredNode));
			const incidentEdges = new Set(graph.edges(hoveredNode));

			previousNodeReducer = renderer.getSetting('nodeReducer');
			previousEdgeReducer = renderer.getSetting('edgeReducer');

			renderer.setSetting('nodeReducer', (n, attr) => {
				const base = previousNodeReducer ? previousNodeReducer(n, attr) : attr;
				if (n === hoveredNode) return { ...base, color: this.theme.matchColor, zIndex: 2, forceLabel: true };
				if (neighbors.has(n)) return { ...base, forceLabel: true };
				return { ...attr, color: this.theme.dimNodeColor };
			});
			renderer.setSetting('edgeReducer', (e, attr) => {
				if (!incidentEdges.has(e)) return { ...attr, color: this.theme.dimEdgeColor };
				const base = previousEdgeReducer ? previousEdgeReducer(e, attr) : attr;
				return { ...base, color: this.theme.matchColor, size: 2, zIndex: 2 };
			});
		});

		renderer.on('leaveNode', () => {
			if (!hoveredNode) return;
			hoveredNode = null;
			renderer.setSetting('nodeReducer', previousNodeReducer);
			renderer.setSetting('edgeReducer', previousEdgeReducer);
		});
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
		this.pathResultActive = false;
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
		this.renderLegend();
	}

	private hideStagnationHeatmap(): void {
		if (!this.stagnationActive) return;
		this.stagnationActive = false;
		this.stagnationButton.removeClass('is-active');
		this.clearHighlight();
		this.panelEl.empty();
		this.panelEl.hide();
		this.renderLegend();
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
			this.pathResultActive = false;
			this.applyFocusFilter(this.searchQuery);
			this.renderLegend();
		} else {
			this.clearHighlight();
			this.renderLegend();
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

function rgbToCss(rgb: [number, number, number]): string {
	return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/** Obsidian's ColorComponent (the Appearance panel's edge-color picker) only accepts hex - theme.ts's resolved colors are `rgb()` strings, so this converts for display. Already-hex input (a saved override) passes through unchanged. */
function toHexColor(color: string): string {
	const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
	if (!match) return color;
	const toHexPart = (value: string): string => Number(value).toString(16).padStart(2, '0');
	return `#${toHexPart(match[1]!)}${toHexPart(match[2]!)}${toHexPart(match[3]!)}`;
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
