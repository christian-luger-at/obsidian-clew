import { App, ColorComponent, DropdownComponent, ExtraButtonComponent, getAllTags, Menu, Setting, setIcon, setTooltip, TextComponent, TFile, ToggleComponent } from 'obsidian';
import Graph from 'graphology';
import type { Attributes } from 'graphology-types';
import type Sigma from 'sigma';
import { createRenderer, createNodeHoverDrawer, createArrowEdgePrograms } from './renderer';
import { runLayout, LayoutRun } from './layoutRunner';
import { buildVaultGraph, resetToDeterministicPositions, sizeNodesByDegree } from './vaultGraph';
import { runHierarchicalLayout, HIERARCHICAL_LAYOUT_NODE_LIMIT } from './hierarchicalLayout';
import { computeRadialLayout } from './radialLayout';
import { computeCircularLayout } from './circularLayout';
import { findPaths, PathResult } from './pathfinding';
import { PathfindingModal } from './pathfindingModal';
import { RadialLayoutModal } from './radialLayoutModal';
import { LayoutMode, LAYOUT_MODE_LABELS, LayoutModal } from './layoutModal';
import { ConfirmModal } from './confirmModal';
import { exportPathToCanvas } from './canvasExport';
import { computeCommunityStats, detectCommunities, staleness } from './stagnation';
import { readThemeColors, ThemeColors, blendToward } from './theme';
import { evaluateFilters, FilterCombineMode, FilterPreset, isAnyFilterEnabled, MAX_FILTER_PRESETS } from './filter';
import {
	CriteriaOwner,
	DEFAULT_GROUP_COLORS,
	describeCriterion,
	evaluateGroups,
	GroupCriterion,
	GroupCriterionType,
	MAX_NODE_GROUPS,
	needsClusterFreshness,
	needsContentSearch,
	NodeGroup,
	NodeGroupFacts,
	StalenessBucket,
	StringOperator,
} from './nodeGroups';
import { ClewAppearanceSettings, DEFAULT_APPEARANCE_SETTINGS } from '../settings';
import {
	computeTimelineBounds,
	computeTimelineSteps,
	cursorForElapsed,
	cursorForElapsedByCalendar,
	stepIndexAtOrBefore,
	TimelineBounds,
	TimelineDuration,
	TIMELINE_DURATIONS,
	TimelinePaceMode,
	visibleEdgesAt,
	visibleNodesAt,
} from './timeline';
import type ClewPlugin from '../main';

/** Real time between timeline playback ticks - not every rAF frame (~16ms): rebuilding the visible node/edge sets is a full graph pass, and a step-paced animation doesn't need 60fps smoothness anyway. Same reasoning/precedent as the 150ms camera-refit interval below. */
const TIMELINE_TICK_MS = 200;

/** How long a newly-revealed node/edge grows in over, instead of popping in at full size instantly (user feedback) - real wall-clock time, independent of the chosen playback duration, since a fade this short should read the same regardless of how fast the timeline itself is playing. */
const TIMELINE_FADE_MS = 400;
/** How often the fade ticker forces a re-render while anything is still growing in - Sigma reducers re-run on every refresh() on their own, this just needs to happen more often than TIMELINE_TICK_MS for the fade to read as smooth motion rather than a couple of visible jumps. */
const TIMELINE_FADE_TICK_MS = 30;

/** "10s"/"30s"/"1 min"/"3 min" - TIMELINE_DURATIONS is always whole seconds, some of them >= 60. */
function formatTimelineDuration(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	const minutes = seconds / 60;
	return `${minutes} min`;
}

/** Wall-clock budget for the initial force-layout settle when a graph is (re)built - not user-tunable (unlike gravity/scalingRatio), since a longer settle mostly just delays interactivity rather than visibly improving the result. */
const SETTLE_DURATION_MS = 2000;

/** How long ForceAtlas2 briefly re-runs after a drag ends, so neighbors visibly adapt to the dropped node's new (now fixed) position - shorter than the initial settle, since this is just a local readjustment, not settling the whole graph from scratch. */
const DRAG_SETTLE_DURATION_MS = 1500;

/** See fittedBBox()'s docstring - the floor "Reset view" fits to, in the same world units as node x/y. */
const MIN_FIT_EXTENT = 32;

/**
 * "Find path" (toolbar icon + `openPathfindingModal()` + the command in
 * main.ts) isn't ready to ship yet - user feedback: hide the icon (and the
 * command) without deleting the underlying feature (pathfinding.ts,
 * PathfindingModal, canvasExport.ts, openPathfindingModal() itself all stay
 * as-is, just unreferenced from the toolbar/command palette for now). Flip
 * back to `true` to re-enable both in one place.
 */
export const FIND_PATH_ENABLED = false;

/**
 * How long the hover-dim (everything but the hovered node/its neighbors)
 * takes to fade fully in or out - user feedback: jumping straight to the
 * dim color the instant a node is entered (and straight back on leave) read
 * as an abrupt cut, not a highlight settling in. See setupNodeHover()'s
 * dimProgress for the animation this drives.
 */
const HOVER_DIM_TRANSITION_MS = 200;

/** A persistent label at the start of every Color & size criterion row (renderCriterionRow()) - user feedback: once a folder/filename/text criterion had a value typed in, its placeholder-only hint disappeared and every free-text row looked identical. */
const CRITERION_TYPE_LABELS: Record<GroupCriterionType, string> = {
	tag: 'Tag',
	property: 'Property',
	folder: 'Folder',
	filename: 'Filename',
	text: 'Text',
	// "Activity", not "Stagnation" - user feedback: the criterion's own
	// controls (renderCriterionEditRow()'s clusterFreshness case) plus this
	// heading were still not understandable, specifically because of
	// "cluster"/"half" jargon, not because a binary choice is inherently
	// confusing (see StalenessBucket's docstring in nodeGroups.ts for the
	// full history) - "Activity" names the axis (active vs. inactive)
	// rather than presupposing "stagnant" as the default framing.
	clusterFreshness: 'Activity',
	// Not "Not edited at least"/"Minimum number of links" any more - those
	// phrases now live in the controls themselves as the clickable
	// include/exclude word (renderCriterionEditRow()'s staleDays/minLinks
	// cases), so keeping them here too would read as duplicated ("Not
	// edited at least" heading right above an "At least"/"Less than" word).
	// A plain category name instead, same role as folder/filename/tag/text.
	staleDays: 'Last edited',
	minLinks: 'Links',
};

/** Parses a criterion's number inputs (staleDays/minLinks) - empty/invalid/negative all mean "0", same as the field never being touched. */
function parsePositiveInt(value: string): number | null {
	const trimmed = value.trim();
	if (trimmed === '') return null;
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

/**
 * Lets renderCriteriaList()/renderCriterionChip()/renderCriterionEditRow()/
 * openAddCriterionMenu() stay agnostic to *which* criteria list they're
 * editing - a Color & size group's own criteria (see groupCriteriaContext())
 * or Filter's single flat list (see filterCriteriaContext()). Both panels
 * edit the exact same GroupCriterion shapes (see filter.ts's docstring for
 * why), so the criteria-list UI itself only needs a place to read/write
 * from, not two near-identical copies of the same rendering code.
 */
interface CriteriaEditorContext {
	criteria: GroupCriterion[];
	/** Index of the criterion currently expanded into its full controls - null when every criterion is shown as a chip. */
	editingIndex: number | null;
	setEditingIndex(index: number | null): void;
	/** A copy of the criterion at editingIndex, taken the moment it was expanded - see criterionEditSnapshot's own docstring on GraphPane for the full reasoning (null means "just created by + add, Cancel removes it" rather than "revert to this"). */
	snapshot: GroupCriterion | null;
	setSnapshot(snapshot: GroupCriterion | null): void;
	/** Persists the owning list (debounced) and re-applies it live (color/size or hide, depending on the panel) - does not re-render the panel itself, see rerenderPanel(). */
	onChange(): void;
	rerenderPanel(): void;
	/** id of the `folder` criterion's `<datalist>` of suggestions - each panel renders its own (see renderColorAndSizePanel()/renderFilterPanel()) so two floating panels open at once never share a DOM id. */
	folderDatalistId: string;
}

/** Debounces the expensive part of an appearance slider's onChange (disk write + live re-render/re-layout) - a slider fires on every 'input' tick while dragging, and persisting + restarting ForceAtlas2 on every single tick would both spam disk writes and make the graph flicker instead of tuning smoothly. */
function debounce(fn: () => void, delayMs: number): () => void {
	let timer: number | null = null;
	return () => {
		if (timer !== null) window.clearTimeout(timer);
		timer = window.setTimeout(fn, delayMs);
	};
}

interface AppearanceSliderSpec {
	// Excludes edgeColorOverride/nodeColorOverride (non-numeric string |
	// null settings, their own color-picker UI instead of a slider) and
	// showEdgeDirection (a boolean, its own toggle UI instead) - see
	// renderAppearancePanel()'s "Nodes"/"Edges" sections.
	key: Exclude<keyof ClewAppearanceSettings, 'edgeColorOverride' | 'nodeColorOverride' | 'showEdgeDirection'>;
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
	 * physics on every slider, including ones that don't need it. 'edgeColor'
	 * is EDGE_INTENSITY_SLIDER's own category (re-reads theme.defaultEdgeColor,
	 * same as the edge-color picker next to it - see applyEdgeColorSetting()).
	 * 'edgeArrow' is EDGE_ARROW_SIZE_SLIDER's own (re-registers the sized
	 * arrow programs - see applyEdgeArrowSize()).
	 */
	apply: 'size' | 'label' | 'layout' | 'edgeColor' | 'edgeArrow';
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
/**
 * Node-specific sliders, rendered in renderAppearancePanel()'s "Nodes"
 * section right alongside the node-color picker - not part of
 * APPEARANCE_SLIDER_GROUPS below, which is for topics that get their own
 * separate heading. Grouping every node-related setting (color, all three
 * size sliders) together, and every edge-related one (color, intensity)
 * together under "Edges", is what user feedback specifically asked for -
 * they were previously split across a shared "Colors" section and a
 * separately-headed "Node size" group with nothing edge-specific at all.
 */
const NODE_SIZE_SLIDERS: AppearanceSliderSpec[] = [
	{
		key: 'nodeBaseSize',
		name: 'Base node size',
		desc: 'Size of a note with no links.',
		min: 0.5,
		max: 12,
		step: 0.1,
		apply: 'size',
	},
	{
		key: 'nodeImageBaseSize',
		name: 'Cover-image node size',
		desc: 'Size of a note with a cover image.',
		min: 1,
		max: 12,
		step: 0.1,
		apply: 'size',
	},
	{
		key: 'nodeDegreeGrowth',
		name: 'Hub growth',
		desc: 'How much bigger heavily-linked notes get.',
		min: 0,
		max: 2,
		step: 0.1,
		apply: 'size',
	},
];

/** Edge-specific slider, rendered in renderAppearancePanel()'s "Edges" section right alongside the edge-color picker - see NODE_SIZE_SLIDERS' docstring for why this isn't part of APPEARANCE_SLIDER_GROUPS below. */
const EDGE_INTENSITY_SLIDER: AppearanceSliderSpec = {
	key: 'edgeIntensity',
	name: 'Edge intensity',
	desc: 'How strongly edges stand out. Ignored with a custom color.',
	min: 0,
	max: 1,
	step: 0.05,
	apply: 'edgeColor',
};

/** Only meaningful (and only rendered in the Appearance panel) while ClewAppearanceSettings.showEdgeDirection is on. */
const EDGE_ARROW_SIZE_SLIDER: AppearanceSliderSpec = {
	key: 'edgeArrowSize',
	name: 'Arrow size',
	desc: 'Size of the direction arrowhead.',
	min: 0.5,
	max: 5,
	step: 0.5,
	apply: 'edgeArrow',
};

interface AppearanceSliderGroup {
	heading: string;
	sliders: AppearanceSliderSpec[];
	/**
	 * Restricts this group to the layout mode(s) its sliders actually
	 * affect - omitted for groups relevant regardless of layout (Labels).
	 * User feedback: with 6 layout-specific sliders (physics + all 3
	 * alternative layouts' spacing) always shown regardless of which layout
	 * was even active, the panel was mostly showing controls that did
	 * nothing in the current mode. Checked against GraphPane.layoutMode in
	 * renderAppearancePanel() - re-rendered by activateLayoutMode() so
	 * switching layout while the panel is open updates it immediately.
	 */
	showForLayout?: (mode: LayoutMode) => boolean;
}

const APPEARANCE_SLIDER_GROUPS: AppearanceSliderGroup[] = [
	{
		heading: 'Physics (force layout)',
		showForLayout: (mode) => mode === 'force',
		sliders: [
			{
				key: 'gravity',
				name: 'Gravity',
				desc: 'Pull toward the center.',
				min: 0.01,
				max: 0.5,
				step: 0.01,
				apply: 'layout',
			},
			{
				key: 'scalingRatio',
				name: 'Scaling ratio',
				desc: 'Repulsion between notes.',
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
				desc: 'Note size needed before its name shows.',
				min: 2,
				max: 30,
				step: 1,
				apply: 'label',
			},
			{
				key: 'labelDensity',
				name: 'Label density',
				desc: 'How many labels can show at once.',
				min: 0,
				max: 2,
				step: 0.1,
				apply: 'label',
			},
		],
	},
	{
		heading: 'Radial layout spacing',
		showForLayout: (mode) => mode === 'radial',
		sliders: [
			{
				key: 'radialRingSpacing',
				name: 'Radial ring spacing',
				desc: 'Distance between rings.',
				min: 40,
				max: 300,
				step: 10,
				apply: 'layout',
			},
		],
	},
	{
		heading: 'Circular layout spacing',
		showForLayout: (mode) => mode === 'circular',
		sliders: [
			{
				key: 'circularRadius',
				name: 'Circular layout radius',
				desc: 'Radius of the ring.',
				min: 100,
				max: 800,
				step: 20,
				apply: 'layout',
			},
		],
	},
	{
		heading: 'Hierarchical layout spacing',
		showForLayout: (mode) => mode === 'hierarchical',
		sliders: [
			{
				key: 'hierarchicalNodeSpacing',
				name: 'Hierarchical node spacing',
				desc: 'Space between notes on the same level.',
				min: 10,
				max: 100,
				step: 5,
				apply: 'layout',
			},
			{
				key: 'hierarchicalRankSpacing',
				name: 'Hierarchical level spacing',
				desc: 'Space between levels.',
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
	private readonly emptyStateEl: HTMLElement;
	private readonly panelEl: HTMLElement;
	private readonly legendEl: HTMLElement;
	private readonly appearancePanelEl: HTMLElement;
	private readonly filterButton: HTMLButtonElement;
	private readonly filterPanelEl: HTMLElement;
	// Reassigned on every renderFilterPanel() call (rebuilt from scratch
	// each time the panel opens, same as colorAndSizeGroupsContainerEl
	// below - the exact same list/edit-form architecture, just for
	// FilterPreset instead of NodeGroup, see filter.ts's docstring).
	private filterListContainerEl!: HTMLElement;
	/** Index (into plugin.settings.filterPresets) of the filter row currently being dragged - same role as draggedGroupIndex below, see setupGroupRowDrag()'s docstring. Reordering filters has no effect on which notes match (OR across filters, see filter.ts's docstring) - it's purely a user-organization convenience, same drag-and-drop UI as Color & size for consistency (user feedback). */
	private draggedFilterIndex: number | null = null;
	/** Debounces the disk write (not the live filter apply, which stays instant) - filter criteria/name changes on every keystroke, and persisting on every single one would spam disk writes for no benefit. Same pattern as debouncedSaveNodeGroups. */
	private readonly debouncedSaveFilterPresets = debounce(() => void this.plugin.saveSettings(), 250);
	/** id of the filter currently expanded into its edit form - null when every filter is shown collapsed. Same role as editingGroupId below, for filter.ts's FilterPreset list instead of nodeGroups. */
	private editingFilterId: string | null = null;
	/** The Filter panel's own editingCriterionIndex/criterionEditSnapshot - see those fields' docstrings below. A separate pair from Color & size's, scoped to whichever filter is being edited (editingFilterId) - both panels can otherwise be mid-edit independently (e.g. switching panels without finishing an edit). */
	private editingFilterCriterionIndex: number | null = null;
	private filterCriterionEditSnapshot: GroupCriterion | null = null;
	private readonly layoutButton: HTMLButtonElement;
	private readonly colorAndSizeButton: HTMLButtonElement;
	private readonly colorAndSizePanelEl: HTMLElement;
	// Reassigned on every renderColorAndSizePanel() call, same reasoning as
	// filterTagsContainerEl above.
	private colorAndSizeGroupsContainerEl!: HTMLElement;
	/** Index (into plugin.settings.nodeGroups) of the group row currently being dragged - see setupGroupRowDrag()'s docstring. null outside an active drag. */
	private draggedGroupIndex: number | null = null;
	/** id of the group currently expanded into its edit form - null when every group is shown collapsed. Editing operates directly on the real object in plugin.settings.nodeGroups (see debouncedSaveNodeGroups's docstring) - there's no separate draft/Save/Cancel step any more (user feedback: every change should just save immediately). */
	private editingGroupId: string | null = null;
	/** Debounces the disk write for node-group edits (name/color/criteria/etc. change on every keystroke) - the live graph apply (applyNodeGroups()) stays instant, only the write to disk is coalesced. Same pattern as debouncedSaveFilterQuery above. */
	private readonly debouncedSaveNodeGroups = debounce(() => void this.plugin.saveSettings(), 250);
	/**
	 * Index into the editing group's criteria of the one criterion currently
	 * shown expanded (its full type-specific controls) instead of as a
	 * compact chip - null when every criterion is shown as a chip. User
	 * feedback: every criterion always showing its full controls at once
	 * read as cluttered/hard to scan ("unübersichtlich") once a group had
	 * more than one or two; a chip per criterion (see nodeGroups.ts's
	 * describeCriterion()) that expands on click keeps the common case (a
	 * few configured criteria) compact, at the cost of an extra click to
	 * edit one.
	 */
	private editingCriterionIndex: number | null = null;
	/**
	 * A copy of the criterion at editingCriterionIndex, taken the moment it
	 * was expanded - lets its "Cancel" button revert live edits made during
	 * this one editing session (everything else auto-saves immediately, but
	 * a half-finished criterion edit - e.g. picking a property key before
	 * typing its value - should still be revertable). null specifically
	 * means "this criterion was just created by '+ add', not opened from an
	 * existing chip" - Cancel then removes it outright instead of
	 * "reverting" to a blank criterion that would just sit there unconfigured.
	 */
	private criterionEditSnapshot: GroupCriterion | null = null;
	/** Every distinct tag/frontmatter-property-key/folder across the current file set, for criterion dropdowns - shared by Color & size and Filter, since both edit the exact same GroupCriterion shapes (see filter.ts's docstring); refreshed alongside the graph in refreshCriteriaOptions(). */
	private availableTags: string[] = [];
	private availableProperties: string[] = [];
	private availableFolders: string[] = [];
	/** Lowercased "title\ncontent" per note path - only populated when at least one enabled group has a `text` criterion (see nodeGroups.ts's needsContentSearch()); refreshed by refreshNoteContentCache(). Reading every note's body is a real I/O cost, so this stays empty (and unused) otherwise. */
	private noteContentCache = new Map<string, string>();
	private readonly appearanceButton: HTMLButtonElement;
	private renderer: Sigma | null = null;
	private layout: LayoutRun | null = null;
	private graph: Graph | null = null;
	private files: TFile[] = [];
	private mtimeByPath = new Map<string, number>();
	private layoutMode: LayoutMode = 'force';
	private theme: ThemeColors;
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
	/** Whether a found path result is the reason nodes/edges are currently colored - see renderLegend()'s precedence over this vs. the filter, which visually overrides a path's reducer when active. */
	private pathResultActive = false;
	/** Remembers the radial layout's chosen focus note so an appearance-panel change can re-apply it (reapplyActiveLayout()) without re-prompting for a note. */
	private radialFocusNode: string | null = null;

	/**
	 * ctime-based time-lapse (see timeline.ts's docstring for the
	 * ctime-only approximation this makes). Its own bottom-center scrubber
	 * bar rather than sharing the Filter/Color & size/Appearance panel
	 * system - see toggleTimelinePanel()'s docstring for why it doesn't
	 * need closeOtherPanels().
	 */
	private readonly timelineButton: HTMLButtonElement;
	private readonly timelinePanelEl: HTMLElement;
	private timelinePlayButton!: HTMLButtonElement;
	private timelineScrubberEl: HTMLInputElement | null = null;
	private timelineDateLabelEl!: HTMLElement;
	/** Note ctimes for the current file set - refreshed in setFiles(), same lifecycle as mtimeByPath above. */
	private ctimeByPath = new Map<string, number>();
	/** null exactly when there are no notes at all (see timeline.ts's computeTimelineBounds()) - the toolbar button/panel are inert until setFiles() populates this. */
	private timelineBounds: TimelineBounds | null = null;
	/** Every distinct ctime present, ascending (see timeline.ts's computeTimelineSteps()) - what playback paces through, refreshed alongside timelineBounds in setFiles(). */
	private timelineSteps: number[] = [];
	/** ms-epoch playback position - `timelineBounds.end` ("today") is the deliberate at-rest value; applyTimeline() treats that as a no-op, see its own docstring. */
	private timelineCursor = 0;
	// timelineTotalDuration/timelinePaceMode themselves live in
	// plugin.settings.timeline, not as fields here - user feedback: these
	// (the duration/pace-mode dropdowns' picks) should persist across
	// restarts the same as every other panel's saved state
	// (filterPresets, nodeGroups, ...), not reset to their defaults every
	// time the graph view reopens. See settings.ts's ClewTimelineSettings.
	private timelinePlaying = false;
	private timelineIntervalId: number | null = null;
	/** Date.now() offset such that `(Date.now() - timelinePlaybackStartedAt) / 1000` is the correct "elapsed" argument for cursorForElapsed() - set once when playback (re)starts (see startTimelinePlayback()), not tracked per-tick, so ticks never accumulate drift. */
	private timelinePlaybackStartedAt = 0;
	/** The node/edge ids applyTimeline() last made visible - compared against on the next call to find newly-revealed ones (see timelineAppearedAt) rather than re-fading everything already on screen. */
	private timelineVisibleNodes = new Set<string>();
	private timelineVisibleEdges = new Set<string>();
	/** Date.now() a node/edge id first became visible - drives timelineFadeProgress()'s grow-in (user feedback: new notes/links should visibly appear, not just instantly be there). Shared by node and edge ids since graphology keys them separately and this is only ever looked up by the id the caller already knows the kind of. */
	private timelineAppearedAt = new Map<string, number>();
	private timelineFadeIntervalId: number | null = null;

	constructor(
		private readonly app: App,
		private readonly containerEl: HTMLElement,
		private readonly plugin: ClewPlugin,
	) {
		this.containerEl.classList.add('clew-graph-view');
		this.theme = readThemeColors(this.containerEl, this.plugin.settings.appearance.edgeIntensity);

		// Sigma's kill() clears every child of the element it's given, so it
		// gets its own sub-container - otherwise re-rendering would wipe the
		// button/panel below along with the canvases.
		this.graphContainerEl = this.containerEl.createDiv({ cls: 'clew-graph-canvas' });

		// A centered overlay card (same look as the Filter/Color & size
		// panels) shown whenever there's nothing to draw - either the vault
		// has no notes at all, or an active filter matches none of them (see
		// updateEmptyState()) - user feedback: an empty canvas with no
		// explanation reads as broken, not "nothing to show yet". Hidden by
		// default; toggled by updateEmptyState(), never emptied/rebuilt like
		// the other panels since its content only ever needs one of two
		// fixed shapes (see showEmptyState()).
		this.emptyStateEl = this.containerEl.createDiv({ cls: 'clew-empty-state' });
		this.emptyStateEl.hide();

		// A vertical icon rail (left edge) rather than a horizontal row of
		// 6 text buttons - user feedback: the text-button row got covered/
		// blended into a large, busy graph (no backing panel, and it wrapped
		// onto multiple lines as controls were added). Icon + tooltip keeps
		// each control recognizable at a glance without the width a label
		// needs; `.clew-toolbar`'s own background/border/shadow (styles.css)
		// gives it the same solid "floating panel" look as the legend and
		// appearance panel already have, instead of sitting directly on the
		// canvas. `.clew-topbar` is a flex-column positioning wrapper
		// (top-right) - the filter panel (filterPanelEl below) is its second
		// child, dropping straight down below the rail rather than jumping
		// to the opposite (bottom-right) corner like the appearance panel -
		// user feedback that it doesn't need to match Appearance's position.
		const topbarEl = this.containerEl.createDiv({ cls: 'clew-topbar' });
		const toolbarEl = topbarEl.createDiv({ cls: 'clew-toolbar' });

		const iconButton = (icon: string, tooltip: string): HTMLButtonElement => {
			const button = toolbarEl.createEl('button', { cls: 'clickable-icon' });
			setIcon(button, icon);
			setTooltip(button, tooltip);
			return button;
		};

		// A single button opening a dropdown menu (Obsidian's own Menu API,
		// same as its native dropdowns) rather than 4 separate toolbar
		// buttons or a segmented control - user feedback: the segmented
		// control (an earlier version of this) took up too much toolbar
		// width for something picked infrequently. The button's own tooltip
		// always shows the current mode (updated by activateLayoutMode()),
		// so the active layout is visible without opening the menu - but
		// per later feedback, without the accent-highlight treatment other
		// active toolbar toggles get, since the tooltip already says which
		// mode is active.
		this.layoutButton = iconButton('layout-grid', `Layout: ${LAYOUT_MODE_LABELS.force}`);
		this.layoutButton.addEventListener('click', () => this.openLayoutModal());

		// Panning/zooming away with no way back was a real gap - the camera
		// only got reset automatically as a side effect of switching layouts
		// (resetCameraAndRefresh(), used by every setXLayout() method below),
		// never on its own.
		const centerButton = iconButton('maximize', 'Reset view');
		centerButton.addEventListener('click', () => void this.resetCameraAndRefresh());

		// Tucked behind its own icon (like Find path is behind its icon,
		// opening a modal) rather than an always-visible input - user
		// feedback: a persistent filter box competed for space in the
		// toolbar/topbar. Toggles filterPanelEl's visibility instead of
		// opening a modal, since this is a live filter you watch the graph
		// react to while typing, not a one-shot dialog you submit and close.
		// `is-active` here tracks whether a filter is actually *set*
		// (updateFilterButtonState(), called from applyFilter()) rather
		// than whether the panel happens to be open - the filter keeps
		// running in the background once you close the panel (it's saved
		// state, see settings.ts's ClewSettings.filterQuery), so the icon
		// needs to keep saying so.
		this.filterButton = iconButton('filter', 'Filter…');
		this.filterButton.addEventListener('click', () => this.toggleFilterPanel());

		// Doc section 3.1 / GitHub issue #1: user-defined named groups of
		// notes (see nodeGroups.ts), each with its own color/size and one or
		// more matching criteria - replaced the old "pick one frontmatter
		// property, or the built-in Cluster freshness gradient, to color/size
		// the whole graph by" modal entirely (user feedback: a single
		// property dropdown couldn't express "notes tagged #project OR in
		// the Work folder" as one visual group).
		this.colorAndSizeButton = iconButton('palette', 'Color & size…');
		this.colorAndSizeButton.addEventListener('click', () => this.toggleColorAndSizePanel());

		if (FIND_PATH_ENABLED) {
			const findPathButton = iconButton('route', 'Find path…');
			findPathButton.addEventListener('click', () => this.openPathfindingModal());
		}

		// Chat decision, 2026-08-04: a ctime-based time-lapse instead of the
		// full "real time slider" backlog item (GitHub issue #6, which needs
		// a background snapshot index that doesn't exist yet) - see
		// timeline.ts's docstring for the approximation this makes.
		this.timelineButton = iconButton('history', 'Timeline…');
		this.timelineButton.addEventListener('click', () => this.toggleTimelinePanel());

		this.appearanceButton = iconButton('sliders-horizontal', 'Appearance…');
		this.appearanceButton.addEventListener('click', () => this.toggleAppearancePanel());

		// Both live inside topbarEl, right below the icon rail (see
		// topbarEl's own comment above) - not siblings of appearancePanelEl,
		// so neither shares a corner with it (each still gets its own
		// distinct screen position). Only one of the three is ever actually
		// shown at a time though - see closeOtherPanels(). Empty shells here
		// - contents are (re)built fresh every time they open, same
		// reasoning as renderAppearancePanel().
		this.filterPanelEl = topbarEl.createDiv({ cls: 'clew-filter-panel' });
		this.filterPanelEl.hide();
		this.colorAndSizePanelEl = topbarEl.createDiv({ cls: 'clew-filter-panel' });
		this.colorAndSizePanelEl.hide();

		// Top-left - opposite the top-right icon rail/filter panel, so it
		// doesn't compete with either for space.
		this.panelEl = this.containerEl.createDiv({ cls: 'clew-path-panel' });
		this.panelEl.hide();

		// Bottom-left - opposite the bottom-right appearance panel and the
		// top-right icon rail/filter panel, so it doesn't compete with
		// either for space.
		this.legendEl = this.containerEl.createDiv({ cls: 'clew-legend' });

		// Bottom-right - the one remaining free corner.
		this.appearancePanelEl = this.containerEl.createDiv({ cls: 'clew-appearance-panel' });
		this.appearancePanelEl.hide();

		// Bottom-center - a horizontal scrubber bar, not another corner
		// panel, so it doesn't compete with Filter/Color & size/Appearance
		// for space (see toggleTimelinePanel()'s docstring for why it also
		// doesn't need closeOtherPanels()).
		this.timelinePanelEl = this.containerEl.createDiv({ cls: 'clew-timeline-panel' });
		this.timelinePanelEl.hide();

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
		this.activateLayoutMode('force');
		this.pathResultActive = false;
		// A vault refresh mid-playback (a note created/edited while playing)
		// would otherwise keep animating against a file set/graph that no
		// longer matches what's about to be rebuilt below.
		this.stopTimelinePlayback();
		this.stopTimelineFadeTicker();
		this.timelineVisibleNodes = new Set();
		this.timelineVisibleEdges = new Set();
		this.timelineAppearedAt.clear();

		this.files = files;
		this.mtimeByPath = new Map(files.map((file) => [file.path, file.stat.mtime]));
		this.ctimeByPath = new Map(files.map((file) => [file.path, file.stat.ctime]));
		this.timelineBounds = computeTimelineBounds(this.ctimeByPath);
		this.timelineSteps = computeTimelineSteps(this.ctimeByPath);
		// Back to "today" - see timelineCursor's own docstring. Rebuilding
		// the panel (if it was left open across this refresh) keeps its
		// slider bounds/value in sync rather than showing stale ones.
		this.timelineCursor = this.timelineBounds?.end ?? 0;
		if (this.timelinePanelEl.isShown()) this.renderTimelinePanel();
		this.refreshCriteriaOptions();
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
			edgeArrowSize: appearance.edgeArrowSize,
		});
		this.applyEdgeDirection();
		this.setupNodeDragging();
		this.setupNodeClick();
		this.setupNodeHover();
		this.layout = runLayout(this.graph, this.layoutOptions(SETTLE_DURATION_MS));
		// Re-applies the saved filter (see settings.ts's
		// ClewSettings.filterQuery) to the freshly-built graph - a no-op if
		// it's empty (isEmptyQuery() branch inside applyFilter()).
		this.applyFilter();
		// Re-evaluates the saved node groups (see settings.ts's
		// ClewSettings.nodeGroups) against the freshly-built file set -
		// updates the button state and, if a group needs note content (see
		// nodeGroups.ts's needsContentSearch()), refreshes that cache and
		// repaints again once it lands.
		this.applyNodeGroups();

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

	/**
	 * The theme's edge color (with theme.ts's contrast-safety fallback
	 * already applied), unless the user picked an explicit override - see
	 * ClewAppearanceSettings.edgeColorOverride - then blended toward the
	 * background by edgeIntensity either way. Applied here (once, after
	 * the override-or-default choice), not inside theme.ts's
	 * defaultEdgeColor computation (an earlier version) - baked into
	 * defaultEdgeColor, the intensity slider silently stopped doing
	 * anything the moment an override was set, since this method would
	 * then never even read defaultEdgeColor at all.
	 */
	private resolvedEdgeColor(): string {
		const base = this.plugin.settings.appearance.edgeColorOverride ?? this.theme.defaultEdgeColor;
		return blendToward(base, this.theme.backgroundColor, this.plugin.settings.appearance.edgeIntensity);
	}

	/** The theme's default (non-cover-image) note color, unless the user picked an explicit override - see ClewAppearanceSettings.nodeColorOverride. */
	private resolvedNodeColor(): string {
		return this.plugin.settings.appearance.nodeColorOverride ?? this.theme.graphColor;
	}

	private applyEdgeColorSetting(): void {
		// Re-reads theme.defaultEdgeColor (not just the override) - needed so
		// an edgeIntensity slider change actually takes effect, since that
		// only affects theme.ts's own blend-toward-background computation,
		// not resolvedEdgeColor()'s own edgeColorOverride ?? branch.
		this.theme = readThemeColors(this.containerEl, this.plugin.settings.appearance.edgeIntensity);
		this.renderer?.setSetting('defaultEdgeColor', this.resolvedEdgeColor());
		this.renderer?.refresh();
	}

	/**
	 * Sets every edge's `type` attribute directly (same pattern as
	 * paintVisualEncoding() setting node `color` - not a reducer, since
	 * this needs to actually stick as the base attribute every other edge
	 * reducer (hover, the filter, path highlight, cluster focus) spreads
	 * `...attr` from and otherwise leaves alone), rather than installing a
	 * permanent edgeReducer of its own. `undefined` (showEdgeDirection off,
	 * or GitHub's own default) falls back to sigma's own `defaultEdgeType`
	 * ('line') - see applyEdgeDefaults() in sigma's source.
	 */
	private applyEdgeDirection(): void {
		if (!this.graph) return;
		const { showEdgeDirection } = this.plugin.settings.appearance;
		this.graph.forEachEdge((edge, attr) => {
			const type = showEdgeDirection ? (attr.mutual ? 'doubleArrow' : 'arrow') : undefined;
			this.graph!.setEdgeAttribute(edge, 'type', type);
		});
		this.renderer?.refresh();
	}

	/** Rebuilds the 'arrow'/'doubleArrow' edge programs at the new size and re-registers them - see createArrowEdgePrograms()'s docstring for why sigma's own edgeProgramClasses diffing makes this a live update, not a renderer recreation. */
	private applyEdgeArrowSize(): void {
		if (!this.renderer) return;
		const current = this.renderer.getSetting('edgeProgramClasses');
		this.renderer.setSetting('edgeProgramClasses', {
			...current,
			...createArrowEdgePrograms(this.plugin.settings.appearance.edgeArrowSize),
		});
		this.renderer.refresh();
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
			this.closeOtherPanels('appearance');
			this.renderAppearancePanel();
			this.appearancePanelEl.show();
			this.appearanceButton.addClass('is-active');
		}
	}

	/**
	 * Hides whichever of Filter/Color & size/Appearance is currently open,
	 * other than `keep` - user feedback: only one of these three should be
	 * open at a time ("immer nur einen Dialog anzeigen"), reversing an
	 * earlier decision that let them stack in their own corners. Called
	 * right before a toggle*Panel() method shows its own panel, not on
	 * every render - closing one panel to open another is a single user
	 * action, not something that should also fire on e.g. a live criteria
	 * update repainting an already-open panel.
	 */
	private closeOtherPanels(keep: 'filter' | 'colorAndSize' | 'appearance'): void {
		if (keep !== 'filter' && this.filterPanelEl.isShown()) {
			this.filterPanelEl.hide();
			this.editingFilterId = null;
			this.editingFilterCriterionIndex = null;
			this.filterCriterionEditSnapshot = null;
		}
		if (keep !== 'colorAndSize' && this.colorAndSizePanelEl.isShown()) {
			this.colorAndSizePanelEl.hide();
			this.editingGroupId = null;
			this.editingCriterionIndex = null;
			this.criterionEditSnapshot = null;
		}
		if (keep !== 'appearance' && this.appearancePanelEl.isShown()) {
			this.appearancePanelEl.hide();
			this.appearanceButton.removeClass('is-active');
		}
	}

	/**
	 * Rebuilt from scratch each time the panel opens (not built once and
	 * left standing) so it always reflects the current settings - notably
	 * after "Reset to defaults", where every slider needs to visibly jump
	 * back rather than silently disagree with the values it just wrote.
	 *
	 * `.empty()` below resets the panel's own scroll position to 0 - a real
	 * problem since this also gets called mid-drag by any *layout* slider
	 * (activateLayoutMode(), called from reapplyActiveLayout()'s
	 * setForceLayout()/setHierarchicalLayout()/etc., re-renders the panel
	 * whenever it's open so its layout-specific slider groups stay in
	 * sync). Without saving/restoring scrollTop, nudging e.g. "Hierarchical
	 * level spacing" (near the bottom) yanked the panel back up to the top
	 * on every single tick - user feedback ("springt zur ersten
	 * Einstellung"). Saved/restored here (not per-caller) so every
	 * renderAppearancePanel() call is covered, including "Reset to
	 * defaults".
	 */
	private renderAppearancePanel(): void {
		const previousScrollTop = this.appearancePanelEl.scrollTop;
		this.appearancePanelEl.empty();
		const headerEl = this.appearancePanelEl.createDiv({ cls: 'clew-appearance-panel-header' });
		headerEl.createEl('h4', { text: 'Graph appearance' });
		const closeButton = headerEl.createEl('button', { cls: 'clickable-icon' });
		setIcon(closeButton, 'x');
		setTooltip(closeButton, 'Close');
		closeButton.addEventListener('click', () => this.toggleAppearancePanel());

		// Grouped by topic (Nodes, then Edges) rather than by control type
		// (a shared "Colors" section plus a separately-headed "Node size"
		// group, the previous layout) - user feedback: every node-related
		// setting should sit together, likewise every edge-related one.
		new Setting(this.appearancePanelEl).setName('Nodes').setHeading();
		new Setting(this.appearancePanelEl)
			.setName('Node color')
			.setDesc('Theme color by default; pick to override. Ignores cover images and visual encoding.')
			.addColorPicker((picker) =>
				picker.setValue(toHexColor(this.resolvedNodeColor())).onChange((value) => {
					this.plugin.settings.appearance.nodeColorOverride = value;
					void this.plugin.saveSettings();
					this.applyNodeSizeSettings();
				}),
			)
			.addExtraButton((button) =>
				button
					.setIcon('rotate-ccw')
					.setTooltip('Reset to theme color')
					.onClick(() => {
						this.plugin.settings.appearance.nodeColorOverride = null;
						void this.plugin.saveSettings();
						this.applyNodeSizeSettings();
						this.renderAppearancePanel();
					}),
			);
		for (const spec of NODE_SIZE_SLIDERS) this.renderAppearanceSlider(spec);

		new Setting(this.appearancePanelEl).setName('Edges').setHeading();
		new Setting(this.appearancePanelEl)
			.setName('Edge color')
			.setDesc('Theme color by default; pick to override.')
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
		this.renderAppearanceSlider(EDGE_INTENSITY_SLIDER);
		new Setting(this.appearancePanelEl)
			.setName('Show edge direction')
			.setDesc('Arrowhead pointing to the linked note. Mutual links get both.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.appearance.showEdgeDirection).onChange((value) => {
					this.plugin.settings.appearance.showEdgeDirection = value;
					void this.plugin.saveSettings();
					this.applyEdgeDirection();
					// Arrow size only makes sense - and is only shown - while
					// this is on, so the panel needs a full re-render to
					// show/hide that slider, not just a live-reapply.
					this.renderAppearancePanel();
				}),
			);
		if (this.plugin.settings.appearance.showEdgeDirection) this.renderAppearanceSlider(EDGE_ARROW_SIZE_SLIDER);

		for (const group of APPEARANCE_SLIDER_GROUPS) {
			if (group.showForLayout && !group.showForLayout(this.layoutMode)) continue;
			new Setting(this.appearancePanelEl).setName(group.heading).setHeading();
			for (const spec of group.sliders) this.renderAppearanceSlider(spec);
		}

		// Moved here from the plugin's Settings tab - user feedback: a
		// dragged/pinned node's position is graph-view state you tune while
		// looking at the graph (same reasoning as every other Appearance
		// setting), not something that belongs on a separate Settings
		// screen. This was the plugin Settings tab's only content, so that
		// tab was removed entirely rather than left empty - see main.ts.
		const pinnedCount = Object.keys(this.plugin.settings.pinnedPositions).length;
		new Setting(this.appearancePanelEl)
			.setName('Pinned node positions')
			.setDesc(
				pinnedCount === 0
					? 'No notes have a manually pinned position yet - drag a node to pin it.'
					: `${pinnedCount} note${pinnedCount === 1 ? '' : 's'} currently pinned.`,
			)
			.addButton((button) =>
				button
					.setButtonText('Clear all')
					.setDisabled(pinnedCount === 0)
					.onClick(async () => {
						this.plugin.settings.pinnedPositions = {};
						await this.plugin.saveSettings();
						this.clearPinnedPositions();
						this.renderAppearancePanel();
					}),
			);

		new Setting(this.appearancePanelEl)
			.setName('Reset to defaults')
			.addButton((button) =>
				button.setButtonText('Reset').onClick(async () => {
					this.plugin.settings.appearance = { ...DEFAULT_APPEARANCE_SETTINGS };
					await this.plugin.saveSettings();
					this.applyEdgeColorSetting();
					this.applyNodeSizeSettings();
					this.applyLabelSettings();
					this.applyEdgeDirection();
					this.applyEdgeArrowSize();
					this.reapplyActiveLayout();
					this.renderAppearancePanel();
				}),
			);

		this.appearancePanelEl.scrollTop = previousScrollTop;
	}

	/** Renders one Appearance-panel slider from its spec - shared by the "Nodes"/"Edges" sections above and the APPEARANCE_SLIDER_GROUPS loop, all of which need the identical Setting+addSlider+debounced-apply wiring. */
	private renderAppearanceSlider(spec: AppearanceSliderSpec): void {
		// A fresh debouncer per slider (not shared) - each one only ever
		// needs to coalesce that single slider's own rapid 'input' events,
		// not compete with other sliders' timers.
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

	private applyAppearanceCategory(category: AppearanceSliderSpec['apply']): void {
		if (category === 'size') this.applyNodeSizeSettings();
		else if (category === 'label') this.applyLabelSettings();
		else if (category === 'edgeColor') this.applyEdgeColorSetting();
		else if (category === 'edgeArrow') this.applyEdgeArrowSize();
		else this.reapplyActiveLayout();
	}

	/**
	 * Reveals the Timeline panel or hides it - unlike
	 * toggleFilterPanel()/toggleColorAndSizePanel()/toggleAppearancePanel(),
	 * doesn't call closeOtherPanels(): the Timeline bar lives bottom-center,
	 * a screen region none of those three occupy, so there's no space
	 * conflict to resolve. Closing it always snaps back to "today"
	 * (timelineCursor = timelineBounds.end) rather than leaving it wherever
	 * it was mid-scrub - reopening later should start from a predictable
	 * state, not silently resume a stale position.
	 */
	private toggleTimelinePanel(): void {
		if (this.timelinePanelEl.isShown()) {
			this.stopTimelinePlayback();
			this.timelinePanelEl.hide();
			if (this.timelineBounds) this.timelineCursor = this.timelineBounds.end;
		} else {
			if (!this.timelineBounds) return;
			// The start of the vault's history, not "today" (user feedback:
			// opening the panel used to leave the scrubber at rest on the
			// far right, since that's the no-op position - but the natural
			// thing to want on opening a *timeline* is to see the beginning,
			// ready to press Play, the same convention a video player uses).
			this.timelineCursor = this.timelineRestCursor(this.timelineBounds);
			this.renderTimelinePanel();
			this.timelinePanelEl.show();
		}
		this.applyTimeline();
	}

	/**
	 * One compact row (user feedback: the previous header+description+
	 * controls layout took up too much of the graph) - Play, scrubber,
	 * date, duration, an (i) tooltip carrying the explanation that used to
	 * be a permanent paragraph, then Close. Rebuilt from scratch each time
	 * the panel opens (same reasoning as renderAppearancePanel()) so its
	 * slider bounds/value always reflect the current file set, not a stale
	 * one from before the last setFiles().
	 */
	private renderTimelinePanel(): void {
		this.timelinePanelEl.empty();
		const bounds = this.timelineBounds;
		if (!bounds) return;

		const rowEl = this.timelinePanelEl.createDiv({ cls: 'clew-timeline-row' });

		this.timelinePlayButton = rowEl.createEl('button', { cls: 'clickable-icon' });
		this.updateTimelinePlayButton();
		this.timelinePlayButton.disabled = this.timelineSteps.length < 2;
		this.timelinePlayButton.addEventListener('click', () => this.toggleTimelinePlayback());

		// A plain native range input, not Obsidian's SliderComponent - full
		// control over exactly what's in the DOM here (no ambiguity about
		// what Obsidian's own wrapper might render alongside it), and day-
		// granularity ms-epoch values are small/simple enough to not need
		// SliderComponent's dynamic-tooltip machinery anyway (this.timelineDateLabelEl
		// below already shows a real date, not a raw number).
		const scrubber = rowEl.createEl('input', { cls: 'clew-timeline-scrubber' });
		scrubber.type = 'range';
		scrubber.min = String(this.timelineRestCursor(bounds));
		scrubber.max = String(bounds.end);
		scrubber.step = '1';
		scrubber.value = String(this.timelineCursor);
		scrubber.disabled = bounds.start === bounds.end;
		scrubber.addEventListener('input', () => {
			this.stopTimelinePlayback();
			this.timelineCursor = Number(scrubber.value);
			this.applyTimeline();
		});
		this.timelineScrubberEl = scrubber;

		this.timelineDateLabelEl = rowEl.createDiv({ cls: 'clew-timeline-date' });
		this.updateTimelineDateLabel();

		const durationDropdown = new DropdownComponent(rowEl);
		for (const duration of TIMELINE_DURATIONS) durationDropdown.addOption(String(duration), formatTimelineDuration(duration));
		durationDropdown.setValue(String(this.plugin.settings.timeline.totalDuration)).onChange((value) => {
			this.plugin.settings.timeline.totalDuration = Number(value) as TimelineDuration;
			void this.plugin.saveSettings();
		});

		// A labeled dropdown, not an icon toggle (user feedback: the earlier
		// ⚡/📅 icons "sind total verwirrend" - words read unambiguously
		// where an icon needs a tooltip to explain itself).
		const paceModeDropdown = new DropdownComponent(rowEl);
		paceModeDropdown.addOption('steps', 'Even pace');
		paceModeDropdown.addOption('calendar', 'Real time');
		paceModeDropdown.setValue(this.plugin.settings.timeline.paceMode).onChange((value) => {
			this.plugin.settings.timeline.paceMode = value as TimelinePaceMode;
			void this.plugin.saveSettings();
			// Changing the pace mode mid-playthrough would otherwise jump
			// the cursor (the two modes' "how far along" fractions read
			// differently against the same real elapsed time) - restarting
			// from the current position keeps it visually continuous.
			// stopTimelinePlayback() first: startTimelinePlayback() doesn't
			// clear an existing interval on its own, since it's normally
			// only ever called while not already playing (see
			// toggleTimelinePlayback()).
			if (this.timelinePlaying) {
				this.stopTimelinePlayback();
				this.startTimelinePlayback();
			}
		});

		const closeButton = rowEl.createEl('button', { cls: 'clickable-icon' });
		setIcon(closeButton, 'x');
		setTooltip(closeButton, 'Close');
		closeButton.addEventListener('click', () => this.toggleTimelinePanel());

		if (this.timelineSteps.length < 2) {
			this.timelinePanelEl.createEl('p', {
				cls: 'clew-filter-empty-note',
				text: 'Every note here was created at essentially the same time - nothing to replay yet.',
			});
		}
	}

	private updateTimelinePlayButton(): void {
		setIcon(this.timelinePlayButton, this.timelinePlaying ? 'pause' : 'play');
		setTooltip(this.timelinePlayButton, this.timelinePlaying ? 'Pause' : 'Play');
	}

	private updateTimelineDateLabel(): void {
		if (!this.timelineDateLabelEl || !this.timelineBounds) return;
		const atToday = this.timelineCursor >= this.timelineBounds.end;
		this.timelineDateLabelEl.setText(atToday ? 'Today' : new Date(this.timelineCursor).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }));
	}

	/**
	 * Unlike filterButton (see its own docstring, tracking "is a filter
	 * enabled" independent of the panel) - tied to the panel simply being
	 * open. A bug in an earlier version tracked "is the timeline actually
	 * holding something back right now" instead, which meant the icon lost
	 * its highlight the moment playback reached "today" (cursor no longer
	 * < end), even with the panel still open and clearly in "Timeline
	 * mode" - user-reported.
	 */
	private updateTimelineButtonState(): void {
		this.timelineButton.toggleClass('is-active', this.timelinePanelEl.isShown());
	}

	/**
	 * `bounds.start` itself is the earliest note's own ctime, so a cursor
	 * *at* it (`ctime <= cursor` in timeline.ts's visibleNodesAt()) already
	 * matches that note - user feedback: with the scrubber sitting at the
	 * very left, before ever touching Play, that note (and any edges to
	 * other notes sharing its ctime) was already visible, at full size,
	 * with no grow-in. One ms earlier makes "all the way left" mean
	 * "before anything existed" instead, matching a video player's own 0:00
	 * convention - the very first note only appears once the scrubber (or
	 * playback) actually moves off that leftmost position, same as every
	 * later one.
	 */
	private timelineRestCursor(bounds: TimelineBounds): number {
		return bounds.start - 1;
	}

	/**
	 * Re-derives which nodes/edges are "born" by timelineCursor, intersects
	 * that with the current filter's match set (if any filter is enabled -
	 * see currentFilterMatches()), and hides the rest. An active filter
	 * stays in effect throughout scrubbing/playback (user feedback: "Wenn
	 * ein Filter gesetzt ist, wird dieser bei Animate nicht berücksichtigt"
	 * - an earlier version had the timeline silently override the filter
	 * entirely, the same way Find-path/Stagnation already override each
	 * other in this file, which turned out not to be the wanted behavior
	 * here). At "today" (timelineCursor === timelineBounds.end) this is a
	 * deliberate no-op that hands the reducer back to applyFilter()
	 * instead - opening the Timeline panel, or playback simply finishing,
	 * never changes what's on screen on its own. Still mutually exclusive
	 * with Find-path/Stagnation, which don't compose with anything here.
	 */
	private applyTimeline(): void {
		this.updateTimelineButtonState();
		this.updateTimelineDateLabel();
		if (this.timelineScrubberEl) this.timelineScrubberEl.value = String(this.timelineCursor);
		if (!this.graph || !this.timelineBounds) return;
		const graph = this.graph;

		if (this.timelineCursor >= this.timelineBounds.end) {
			this.stopTimelineFadeTicker();
			this.timelineVisibleNodes = new Set();
			this.timelineVisibleEdges = new Set();
			this.timelineAppearedAt.clear();
			this.applyFilter();
			return;
		}

		this.pathResultActive = false;
		this.panelEl.empty();
		this.panelEl.hide();

		// An active filter stays in effect while scrubbing/playing (user
		// feedback: "Wenn ein Filter gesetzt ist, wird dieser bei Animate
		// nicht berücksichtigt") - the timeline narrows further within
		// whatever the filter already allows, rather than overriding it
		// outright the way it does with Find-path/Stagnation. `null` means
		// no filter is enabled, i.e. no extra restriction (see filter.ts's
		// isAnyFilterEnabled() docstring for why that's not the same as
		// "matches nothing").
		const filterMatches = this.currentFilterMatches();
		let visibleNodes = visibleNodesAt(this.ctimeByPath, this.timelineCursor);
		let visibleEdges = visibleEdgesAt(graph, this.ctimeByPath, this.timelineCursor);
		if (filterMatches) {
			visibleNodes = new Set([...visibleNodes].filter((node) => filterMatches.has(node)));
			visibleEdges = new Set([...visibleEdges].filter((edge) => graph.extremities(edge).every((node) => visibleNodes.has(node))));
		}

		// Grow-in (user feedback: new notes/links should visibly appear, not
		// just instantly be there) - only nodes/edges just now crossing from
		// hidden to visible get stamped, so scrubbing within an already-
		// revealed range doesn't re-fade everything already on screen.
		const now = Date.now();
		for (const node of visibleNodes) if (!this.timelineVisibleNodes.has(node)) this.timelineAppearedAt.set(node, now);
		for (const edge of visibleEdges) if (!this.timelineVisibleEdges.has(edge)) this.timelineAppearedAt.set(edge, now);
		this.timelineVisibleNodes = visibleNodes;
		this.timelineVisibleEdges = visibleEdges;
		this.startTimelineFadeTicker();

		this.renderer?.setSetting('nodeReducer', (node, attr) => {
			if (!visibleNodes.has(node)) return { ...attr, hidden: true };
			const fade = this.timelineFadeProgress(node);
			if (fade >= 1) return attr;
			return { ...attr, size: ((attr.size as number | undefined) ?? 1) * fade };
		});
		this.renderer?.setSetting('edgeReducer', (edge, attr) => {
			if (!visibleEdges.has(edge)) return { ...attr, hidden: true };
			const fade = this.timelineFadeProgress(edge);
			if (fade >= 1) return attr;
			return { ...attr, size: ((attr.size as number | undefined) ?? 1) * fade };
		});
		this.renderLegend();
	}

	/** 0-1 growth progress for a node/edge id, based on how long ago timelineAppearedAt recorded it becoming visible - 1 (full size) once TIMELINE_FADE_MS has passed, or for anything not currently mid-fade at all. Floored well above 0 rather than starting at literally 0: a node that's shrunk to nothing isn't just invisible, it's also unclickable/unhoverable for that first instant, which reads as a glitch rather than a fade. */
	private timelineFadeProgress(id: string): number {
		const appearedAt = this.timelineAppearedAt.get(id);
		if (appearedAt === undefined) return 1;
		const elapsed = Date.now() - appearedAt;
		if (elapsed >= TIMELINE_FADE_MS) return 1;
		return Math.max(0.15, elapsed / TIMELINE_FADE_MS);
	}

	/** Sigma reducers already re-run on every refresh() on their own - this just forces refreshes often enough, for as long as anything in timelineAppearedAt is still within its fade window, for that to read as smooth growth rather than a couple of visible jumps. Self-stopping: the last tick that finds nothing still fading clears its own interval. */
	private startTimelineFadeTicker(): void {
		if (this.timelineFadeIntervalId !== null) return;
		this.timelineFadeIntervalId = window.setInterval(() => {
			this.renderer?.refresh();
			const now = Date.now();
			let stillFading = false;
			for (const appearedAt of this.timelineAppearedAt.values()) {
				if (now - appearedAt < TIMELINE_FADE_MS) {
					stillFading = true;
					break;
				}
			}
			if (!stillFading) this.stopTimelineFadeTicker();
		}, TIMELINE_FADE_TICK_MS);
	}

	private stopTimelineFadeTicker(): void {
		if (this.timelineFadeIntervalId !== null) {
			window.clearInterval(this.timelineFadeIntervalId);
			this.timelineFadeIntervalId = null;
		}
	}

	private toggleTimelinePlayback(): void {
		if (this.timelinePlaying) this.stopTimelinePlayback();
		else this.startTimelinePlayback();
	}

	/**
	 * Resumes from wherever timelineCursor already sits (mid-scrub) rather
	 * than always restarting from the very beginning - computed by finding
	 * that position's own "how far along" fraction (step index in 'steps'
	 * mode, real date position in 'calendar' mode - see
	 * timelinePaceMode's own docstring) and converting it back to an
	 * equivalent "elapsed" offset, so a mid-playthrough Pause/Play doesn't
	 * jump anywhere. Once a full playthrough has already reached "today",
	 * though, Play restarts from the beginning instead of doing nothing.
	 */
	private startTimelinePlayback(): void {
		if (!this.timelineBounds || this.timelineSteps.length < 2) return;
		if (this.timelineCursor >= this.timelineBounds.end) this.timelineCursor = this.timelineRestCursor(this.timelineBounds);

		const fractionAlready =
			this.plugin.settings.timeline.paceMode === 'steps'
				? Math.max(0, stepIndexAtOrBefore(this.timelineSteps, this.timelineCursor)) / this.timelineSteps.length
				: (this.timelineCursor - this.timelineBounds.start) / (this.timelineBounds.end - this.timelineBounds.start || 1);
		const startOffsetS = fractionAlready * this.plugin.settings.timeline.totalDuration;
		this.timelinePlaybackStartedAt = Date.now() - startOffsetS * 1000;

		this.timelinePlaying = true;
		this.updateTimelinePlayButton();
		this.timelineIntervalId = window.setInterval(() => this.tickTimelinePlayback(), TIMELINE_TICK_MS);
	}

	private stopTimelinePlayback(): void {
		if (this.timelineIntervalId !== null) {
			window.clearInterval(this.timelineIntervalId);
			this.timelineIntervalId = null;
		}
		if (this.timelinePlaying) {
			this.timelinePlaying = false;
			this.updateTimelinePlayButton();
		}
	}

	private tickTimelinePlayback(): void {
		if (!this.timelineBounds || this.timelineSteps.length < 2) {
			this.stopTimelinePlayback();
			return;
		}
		const elapsedS = (Date.now() - this.timelinePlaybackStartedAt) / 1000;
		this.timelineCursor =
			this.plugin.settings.timeline.paceMode === 'steps'
				? cursorForElapsed(this.timelineSteps, elapsedS, this.plugin.settings.timeline.totalDuration)
				: cursorForElapsedByCalendar(this.timelineBounds, elapsedS, this.plugin.settings.timeline.totalDuration);
		this.applyTimeline();
		if (elapsedS >= this.plugin.settings.timeline.totalDuration) this.stopTimelinePlayback();
	}

	destroy(): void {
		this.stopTimelinePlayback();
		this.stopTimelineFadeTicker();
		this.layout?.stop();
		this.renderer?.kill();
		if (GraphPane.active === this) GraphPane.active = null;
	}

	openPathfindingModal(): void {
		if (!this.graph) return;
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
			if (primaryNodes.has(node))
				return { ...attr, color: this.theme.primaryPathColor, labelColor: this.theme.primaryPathColor, zIndex: 2, forceLabel: true };
			if (allNodes.has(node)) return { ...attr, color: this.theme.altPathColor, labelColor: this.theme.altPathColor, zIndex: 1 };
			return { ...attr, color: this.theme.dimNodeColor, labelColor: this.theme.dimNodeColor };
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
	 * The "nothing else active" color/size - a node's color/size comes from
	 * the first *enabled* node group (see nodeGroups.ts) whose criteria it
	 * matches, falling back to `type` (plain vs. cover-image, plus the
	 * current theme - see vaultGraph.ts's docstring on why it doesn't set
	 * `color` itself) for color and the degree-based default for size.
	 * sizeNodesByDegree() always runs first to (re-)establish that true
	 * baseline, then each matched group's own size (if it set one) overlays
	 * on top - so a note that stops matching any group, or starts matching
	 * a group with no size override, never keeps a stale size left over
	 * from a previous evaluation.
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

		const groupByNode = evaluateGroups(this.buildCriteriaFacts(), this.plugin.settings.nodeGroups);

		for (const [node, group] of groupByNode) {
			if (group.sizeMultiplier === null) continue;
			// Scales the size sizeNodesByDegree() just computed rather than
			// replacing it outright - see NodeGroup.sizeMultiplier's own
			// docstring for why (a hub note in the group should still read as
			// bigger than a leaf note in the same group, not collapse to one
			// uniform size).
			const baseSize = graph.getNodeAttribute(node, 'size') as number;
			graph.setNodeAttribute(node, 'size', baseSize * group.sizeMultiplier);
		}
		graph.forEachNode((node, attr) => {
			const defaultColor = attr.type === 'image' ? this.theme.imageNodeColor : this.resolvedNodeColor();
			graph.setNodeAttribute(node, 'color', groupByNode.get(node)?.color ?? defaultColor);
		});
	}

	/**
	 * Gathers per-note facts once per call (not cached across calls - a
	 * vault refresh or filter/group edit can happen between them, and
	 * re-scanning is cheap relative to a metadataCache lookup per file) for
	 * nodeGroups.ts's pure evaluateGroups()/matchesGroup() to match against
	 * - shared by paintVisualEncoding() (Color & size) and applyFilter()
	 * (Filter), since both now match the exact same GroupCriterion shapes
	 * against the exact same facts (see filter.ts's docstring). `content`
	 * and `clusterStaleness` are the two facts real I/O/computation backs -
	 * both stay at their empty/null default unless a group or filter
	 * actually needs them (see nodeGroups.ts's needsContentSearch()/
	 * needsClusterFreshness() and this file's allCriteriaOwners()), so a
	 * vault with no `text`/`clusterFreshness` criteria in use never pays
	 * for either.
	 */
	private buildCriteriaFacts(): Map<string, NodeGroupFacts> {
		const clusterStalenessByNode = needsClusterFreshness(this.allCriteriaOwners()) ? this.computeClusterStaleness() : null;
		const result = new Map<string, NodeGroupFacts>();
		for (const file of this.files) {
			const cache = this.app.metadataCache.getFileCache(file);
			const folder = file.parent?.path ?? '';
			result.set(file.path, {
				label: file.basename,
				folder: folder === '/' ? '' : folder,
				content: this.noteContentCache.get(file.path) ?? '',
				tags: (cache ? getAllTags(cache) : null) ?? [],
				frontmatter: cache?.frontmatter ?? {},
				clusterStaleness: clusterStalenessByNode?.get(file.path) ?? null,
				mtime: this.mtimeByPath.get(file.path) ?? file.stat.mtime,
				degree: this.graph?.degree(file.path) ?? 0,
			});
		}
		return result;
	}

	/** Louvain communities (stagnation.ts) turned into a 0-1 staleness value per node, relative to every other community present - backs the `clusterFreshness` group criterion. Only called when at least one enabled group actually uses it (needsClusterFreshness()) - Louvain detection is a real per-open computational cost, not worth paying unconditionally. */
	private computeClusterStaleness(): Map<string, number> {
		if (!this.graph) return new Map();
		const communities = detectCommunities(this.graph);
		const stats = computeCommunityStats(communities, (nodeId) => this.mtimeByPath.get(nodeId) ?? 0);
		const newestValues = stats.map((s) => s.newestMtime);
		const minNewest = Math.min(...newestValues);
		const maxNewest = Math.max(...newestValues);
		const stalenessByCommunity = new Map(stats.map((s) => [s.communityId, staleness(s.newestMtime, minNewest, maxNewest)]));
		const result = new Map<string, number>();
		for (const [node, communityId] of communities) {
			const value = stalenessByCommunity.get(communityId);
			if (value !== undefined) result.set(node, value);
		}
		return result;
	}

	/** Node groups and filter presets combined - see nodeGroups.ts's CriteriaOwner docstring for why needsContentSearch()/needsClusterFreshness() can treat both lists as one for buildCriteriaFacts()'s/refreshCriteriaContent()'s "does anything currently active need this" checks. */
	private allCriteriaOwners(): CriteriaOwner[] {
		return [...this.plugin.settings.nodeGroups, ...this.plugin.settings.filterPresets];
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
	 * state happens to be set. Neither the filter nor node groups (Color &
	 * size) get a legend entry of their own - user feedback - a filter's
	 * active criteria (shown right in its own panel as chips) and a
	 * group's own name (shown right in its row in the Color & size panel)
	 * are already the label; while a filter is active, this just falls
	 * through to whatever (if anything) a shown path result would show,
	 * same as it did before the filter existed.
	 */
	private renderLegend(): void {
		this.legendEl.empty();

		if (this.pathResultActive) {
			this.addLegendItem(this.theme.primaryPathColor, 'Shortest path');
			this.addLegendItem(this.theme.altPathColor, 'Alternative path');
			this.addLegendItem(this.theme.dimNodeColor, 'Not on a shown path');
		}
	}

	private addLegendItem(color: string, label: string): void {
		const item = this.legendEl.createDiv({ cls: 'clew-legend-item' });
		item.createSpan({ cls: 'clew-legend-swatch' }).style.backgroundColor = color;
		item.createSpan({ text: label });
	}

	/**
	 * Called by StandaloneGraphView on Obsidian's 'css-change' workspace
	 * event (theme switches don't reload the plugin, so nothing else would
	 * trigger a re-read of the CSS variables theme.ts resolves colors from).
	 *
	 * Simplest correct behavior, not the most clever one: drops back to the
	 * neutral default coloring rather than trying to detect which mode
	 * (path result / the filter) was active and replay it with fresh
	 * colors - matches the existing precedent that every mode already
	 * resets on a vault refresh (setFiles()), and a user-initiated theme
	 * switch is rare enough that this isn't worth the added complexity of
	 * remembering and reapplying arbitrary mode state. Layout mode (force
	 * vs. hierarchical) and node groups are left untouched here, unlike the
	 * filter - neither is actually theme-dependent (a group's color is
	 * always a fixed, user-picked value, not derived from `this.theme`), so
	 * there's nothing about them a theme switch would make stale.
	 * paintVisualEncoding() still re-runs below, since its *fallback* color
	 * (nodes matching no enabled group) does use `this.theme`.
	 */
	refreshTheme(): void {
		if (!this.graph) return;
		this.theme = readThemeColors(this.containerEl, this.plugin.settings.appearance.edgeIntensity);
		this.renderer?.setSetting('defaultEdgeColor', this.resolvedEdgeColor());
		// `attribute: 'labelColor'` here too (not just createRenderer()'s
		// initial setting) - a bare `{ color }` would silently drop the
		// per-node labelColor override the dim reducers rely on (see
		// renderer.ts's labelColor docstring), reverting every dimmed
		// node's label back to full brightness the next time the theme
		// changes while a highlight happens to be active.
		this.renderer?.setSetting('labelColor', { attribute: 'labelColor', color: this.theme.labelColor });
		this.renderer?.setSetting('defaultDrawNodeHover', createNodeHoverDrawer(this.theme.backgroundColor));

		this.panelEl.empty();
		this.panelEl.hide();
		this.paintVisualEncoding();
		// Re-applies the saved filter with fresh theme colors instead of
		// unconditionally clearing it - it's saved state now (see
		// settings.ts's ClewSettings.filterQuery), not something a theme
		// switch should reset. Already a no-op when there's nothing to
		// filter (isEmptyQuery() branch inside, same as clearHighlight()
		// would have done).
		this.applyFilter();
		this.renderer?.refresh();
		this.renderLegend();
	}

	/**
	 * Opens the "Layout" dialog (layoutModal.ts) fresh each time, rather than
	 * a persistent DOM structure - it's only a few options and this way "is
	 * hierarchical too large for this graph" is always read straight from
	 * the current graph, not tracked as separate instance state that could
	 * drift out of sync with it. Replaced an earlier dropdown menu (user
	 * feedback: picking a layout should come with an explanation of what
	 * each one is for) - see LayoutModal's own docstring for why radial
	 * routes to openRadialLayoutModal() instead of being just another
	 * onSelect case.
	 */
	private openLayoutModal(): void {
		const tooLargeForHierarchical = (this.graph?.order ?? 0) > HIERARCHICAL_LAYOUT_NODE_LIMIT;
		new LayoutModal(
			this.app,
			this.layoutMode,
			tooLargeForHierarchical,
			(mode) => {
				if (mode === this.layoutMode) return;
				if (mode === 'force') this.setForceLayout();
				else if (mode === 'hierarchical') this.setHierarchicalLayout();
				else if (mode === 'circular') this.setCircularLayout();
			},
			() => this.openRadialLayoutModal(),
		).open();
	}

	/**
	 * Updates layoutMode and the toolbar button's own tooltip to match -
	 * kept in one place so they can never disagree. Deliberately no
	 * `is-active` accent highlight here (unlike the other toolbar toggles) -
	 * user feedback: the tooltip already says which layout is active, so
	 * highlighting it too was redundant.
	 */
	private activateLayoutMode(mode: LayoutMode): void {
		this.layoutMode = mode;
		setTooltip(this.layoutButton, `Layout: ${LAYOUT_MODE_LABELS[mode]}`);
		// The Appearance panel's layout-specific slider groups (Physics,
		// Radial/Circular/Hierarchical spacing) are filtered by this mode -
		// re-render so switching layout while the panel is already open
		// swaps them immediately instead of only on next open/close.
		if (this.appearancePanelEl.isShown()) this.renderAppearancePanel();
	}

	private setHierarchicalLayout(): void {
		if (!this.graph) return;
		this.layout?.stop();

		// dagre.layout() is synchronous and, at the sizes this is allowed to
		// run at, can still take a few seconds (see hierarchicalLayout.ts) -
		// disable the button and show that something is happening, then
		// yield one tick so that actually paints before the blocking call
		// starts, rather than the UI just looking frozen for that long.
		this.layoutButton.disabled = true;
		setTooltip(this.layoutButton, 'Computing layout…');

		window.setTimeout(() => {
			if (!this.graph) return;
			const appearance = this.plugin.settings.appearance;
			runHierarchicalLayout(this.graph, {
				nodesep: appearance.hierarchicalNodeSpacing,
				ranksep: appearance.hierarchicalRankSpacing,
			});
			void this.resetCameraAndRefresh();

			this.layoutButton.disabled = false;
			this.activateLayoutMode('hierarchical');
		}, 0);
	}

	private setCircularLayout(): void {
		if (!this.graph) return;
		this.layout?.stop();
		computeCircularLayout(this.graph, this.plugin.settings.appearance.circularRadius);
		this.activateLayoutMode('circular');
		void this.resetCameraAndRefresh();
	}

	private openRadialLayoutModal(): void {
		if (!this.graph) return;
		new RadialLayoutModal(this.app, this.files, (focusFile) => this.setRadialLayout(focusFile.path)).open();
	}

	private setRadialLayout(focusPath: string): void {
		if (!this.graph) return;
		this.layout?.stop();
		this.radialFocusNode = focusPath;
		computeRadialLayout(this.graph, focusPath, this.plugin.settings.appearance.radialRingSpacing);
		this.activateLayoutMode('radial');
		void this.resetCameraAndRefresh();
	}

	private setForceLayout(): void {
		if (!this.graph) return;
		this.activateLayoutMode('force');

		// Restores the deterministic seed rather than letting FA2 relax from
		// wherever the previous layout left nodes - otherwise the "same
		// graph looks the same on reopen" guarantee (see vaultGraph.ts)
		// would depend on layout-switch history, not just the graph itself.
		// Pinned nodes (GitHub issue #12) are restored to their pin instead,
		// and kept fixed - none of the other layouts respect pins, so this
		// is what makes a pin survive a round trip through any of them.
		resetToDeterministicPositions(this.graph, this.plugin.settings.pinnedPositions);
		// Unlike the other layouts (which compute final positions
		// synchronously, so fitting the camera right after is fitting the
		// real result), ForceAtlas2 relaxes asynchronously over
		// SETTLE_DURATION_MS starting from the tight deterministic seed
		// scatter just reset above - calling resetCameraAndRefresh() only
		// once, synchronously here (an earlier version of this) fit/locked
		// the camera to that seed's tiny bounding box, not the spread-out
		// settled layout, so the graph looked "wrong" (cramped into a
		// corner or oddly zoomed) until something else (a manual "Reset
		// view" click, made well after settling) recomputed the fit.
		// Only fitting once at the *end* (onSettled) instead had the
		// opposite problem - user feedback: "die Anzeige ist zuerst sehr
		// klein und braucht 2 sec, um die richtige Grösse zu haben" - the
		// camera stayed frozen at whatever the *previous* layout had framed
		// for the entire settle, while nodes visibly spread out underneath
		// it, then jumped to the correct framing all at once. Refitting
		// repeatedly while it settles (instant snaps, `duration: 0` - an
		// animated tween restarting every tick would fight itself and look
		// worse, not better) tracks the growing extent live instead; the
		// final onSettled fit still uses the default animated reset, so the
		// very last adjustment reads as a deliberate settle, not a snap.
		const refitIntervalId = window.setInterval(() => void this.resetCameraAndRefresh(true), 150);
		this.layout = runLayout(this.graph, {
			...this.layoutOptions(SETTLE_DURATION_MS),
			onSettled: () => {
				window.clearInterval(refitIntervalId);
				void this.resetCameraAndRefresh();
			},
		});
	}

	/**
	 * Called from the Appearance panel's "Pinned node positions" -> "Clear
	 * all" button - without this, a previously-pinned node stayed frozen in
	 * its old spot until the graph view was closed and reopened, since
	 * clearing the setting alone doesn't retroactively un-fix a node
	 * already `fixed: true` in the currently-rendered graph. Only
	 * meaningful in force mode - none of the other layouts respect `fixed`
	 * either way, so by the time the user switches back to force,
	 * setForceLayout() already reads the (by-then-already-cleared) setting
	 * correctly on its own, with nothing extra needed here.
	 */
	private clearPinnedPositions(): void {
		if (this.layoutMode === 'force') this.setForceLayout();
	}

	/**
	 * Called from StandaloneGraphView's onResize() and its workspace-level
	 * 'resize'/'active-leaf-change' listeners - covers both a genuine size
	 * change (see createRenderer()'s allowInvalidContainer docstring in
	 * renderer.ts: a vault-change refresh that ran while this view's tab was
	 * in the background creates the renderer against a 0x0 container) and
	 * plain tab-switching/opening a note, neither of which changes this
	 * leaf's pixel size at all - user-reported: the graph goes blank
	 * switching away to Obsidian's own Graph View and back, or just opening
	 * a note, and only "Center" (resetCameraAndRefresh) brought it back.
	 *
	 * Debounced (see debouncedHandleResize below) - workspace's own
	 * 'resize' event is documented as "a WorkspaceItem resized or the
	 * layout changed", not specifically *this* leaf, so it fires for any
	 * pane's layout churn, not just a genuine size change here. User-
	 * reported: the graph visibly stutters while the file-explorer sidebar
	 * is open (present the whole time, not something toggling size), which
	 * pointed at that sidebar's own routine internal updates (e.g.
	 * highlighting the active file) generating a stream of these events -
	 * each one, undebounced, forced a real Sigma resize (bypassing its own
	 * "unchanged, skip" guard) plus an explicit repaint, so a burst of them
	 * meant a burst of real WebGL work with nothing about this leaf's own
	 * size actually having changed.
	 */
	handleResize(): void {
		this.debouncedHandleResize();
	}

	/**
	 * A single debounced instance (not re-created per handleResize() call,
	 * which would defeat debouncing entirely) - see handleResize()'s own
	 * docstring. 100ms: short enough that a genuine tab-switch/resize still
	 * feels immediate, long enough to collapse a burst of same-tick
	 * 'resize' events (the actual reported problem) into one real call.
	 */
	private readonly debouncedHandleResize = debounce(() => {
		this.renderer?.resize(true);
		this.renderer?.refresh();
	}, 100);

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
	 *
	 * `instant` (duration: 0) skips the tween - setForceLayout() calls this
	 * repeatedly while ForceAtlas2 settles to keep the camera tracking the
	 * growing extent live, and a real animated tween restarting on every one
	 * of those ticks would fight itself instead of looking smooth.
	 */
	private async resetCameraAndRefresh(instant = false): Promise<void> {
		const bbox = this.fittedBBox();
		if (bbox) this.renderer?.setCustomBBox(bbox);
		await this.renderer?.getCamera().animatedReset(instant ? { duration: 0 } : undefined);
		this.renderer?.refresh();
	}

	/**
	 * The bounding box "Reset view"'s camera.animatedReset() fits to -
	 * sigma's own default (fitting to the graph's raw node extent, a fixed
	 * 30px stagePadding) zooms in on a sparse graph so tightly it fills
	 * almost the entire pane: a settled few-node graph naturally spans only
	 * a handful of world units (measured directly: ~5-20 for 2-5 notes at
	 * default gravity/scalingRatio, vs. 25-45+ for 10+), and sigma's padding
	 * is a fixed pixel amount, negligible against a typical pane width
	 * regardless of how small that world-space extent is. Flooring the
	 * fitted extent at MIN_FIT_EXTENT leaves comfortable empty space around
	 * a sparse graph instead, while barely affecting anything with enough
	 * notes to already reach this scale on its own - large graphs need no
	 * special-casing, since "fit everything" is already the right behavior
	 * there once there's enough content to naturally exceed the floor.
	 */
	private fittedBBox(): { x: [number, number]; y: [number, number] } | null {
		if (!this.graph || this.graph.order === 0) return null;
		let xMin = Infinity;
		let xMax = -Infinity;
		let yMin = Infinity;
		let yMax = -Infinity;
		this.graph.forEachNode((_node, attr) => {
			const x = attr.x as number;
			const y = attr.y as number;
			if (x < xMin) xMin = x;
			if (x > xMax) xMax = x;
			if (y < yMin) yMin = y;
			if (y > yMax) yMax = y;
		});
		const centerX = (xMin + xMax) / 2;
		const centerY = (yMin + yMax) / 2;
		const half = Math.max(xMax - xMin, yMax - yMin, MIN_FIT_EXTENT) / 2;
		return { x: [centerX - half, centerX + half], y: [centerY - half, centerY + half] };
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

		// The Appearance panel's own "Pinned node positions" count/"Clear
		// all" button (renderAppearancePanel()) only reads
		// plugin.settings.pinnedPositions at render time - without this, a
		// note dragged while that panel was already open left it showing a
		// stale count until closed and reopened (user feedback: "funktioniert
		// nicht immer - nur wenn eine Notiz vor dem Öffnen des
		// Appearance-Dialogs verschoben wurde").
		if (this.appearancePanelEl.isShown()) this.renderAppearancePanel();
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
	 * whatever cluster-freshness/the filter/a path result already painted
	 * them, or their normal baked-in color otherwise) - they're exempted
	 * from dimming, not recolored. Their label shows if it would anyway
	 * (same labelSizeThreshold/labelDensity rule as any other node, not
	 * forced) - user feedback: being able to read which notes a hovered
	 * note connects to, without also opening a path-finding query, is the
	 * actual point of this feature.
	 *
	 * Composes with whatever mode is currently active (default coloring,
	 * cluster freshness, the filter, a shown path result) rather than
	 * replacing it: saves the current nodeReducer/edgeReducer via
	 * renderer.getSetting() before overlaying the hover highlight, and
	 * restores exactly those saved reducers on mouse-leave - so hovering
	 * while, say, the filter is active leaves non-hovered nodes/edges
	 * respecting the filter's `hidden` untouched (see the node/edge
	 * reducers below reading `base`, not raw `attr`, in their "everyone
	 * else" branches - an earlier version used `attr` there and leaked
	 * every filtered-out node/edge back into view for the hover's
	 * duration), and un-hovering returns to the filtered view exactly as
	 * it was, not a reset to plain default coloring.
	 */
	private setupNodeHover(): void {
		if (!this.renderer) return;
		const renderer = this.renderer;

		// Bridges state between the enterNode/leaveNode handlers below - both
		// registered once (not re-registered per hover, which would leak a
		// new leaveNode listener - closured over a *fresh* previous-reducer
		// pair - on every single hover instead of reusing one).
		let hoveredNode: string | null = null;
		let neighbors = new Set<string>();
		let incidentEdges = new Set<string>();
		let previousNodeReducer = renderer.getSetting('nodeReducer');
		let previousEdgeReducer = renderer.getSetting('edgeReducer');

		// How dimmed everything but the hovered node/its neighbors currently
		// is: 0 = not dimmed at all, 1 = fully at the dim floor. Animated
		// (rather than jumping straight to 1 the instant a node is entered,
		// and straight back to 0 on leave) per user feedback: an instant
		// flip to the dim color for every other node/edge read as an abrupt,
		// jarring cut rather than a highlight settling in - "es soll einen
		// fliessenden Übergang zur inaktiven Farbe geben". A per-node
		// distance-graded *color* falloff (an earlier attempt at this same
		// feedback) was the wrong axis entirely - the ask was for the
		// transition over *time* to be smooth, not the transition over
		// *graph distance*.
		let dimProgress = 0;
		let animationFrame: number | null = null;

		const cancelAnimation = (): void => {
			if (animationFrame !== null) {
				window.cancelAnimationFrame(animationFrame);
				animationFrame = null;
			}
		};

		const animateDimProgressTo = (target: number, onComplete?: () => void): void => {
			cancelAnimation();
			const start = dimProgress;
			const startTime = performance.now();
			// Scaled by how far progress actually has to move, so interrupting
			// a fade partway through (e.g. hovering a new node right as the
			// previous one's dim is still fading out) redirects smoothly
			// instead of restarting a full-length animation from wherever it
			// happened to be.
			const duration = HOVER_DIM_TRANSITION_MS * Math.abs(target - start);
			const step = (now: number): void => {
				const t = duration === 0 ? 1 : Math.min(1, (now - startTime) / duration);
				dimProgress = start + (target - start) * t;
				renderer.refresh();
				if (t < 1) {
					animationFrame = window.requestAnimationFrame(step);
				} else {
					animationFrame = null;
					onComplete?.();
				}
			};
			animationFrame = window.requestAnimationFrame(step);
		};

		const nodeReducer = (n: string, attr: Attributes) => {
			const base = previousNodeReducer ? previousNodeReducer(n, attr) : attr;
			// Same reasoning as the incident-edge color below: a chosen node
			// color override shouldn't get silently replaced by the theme's
			// accent color the moment the node is hovered.
			if (n === hoveredNode) {
				const color = this.plugin.settings.appearance.nodeColorOverride ?? this.theme.matchColor;
				return { ...base, color, image: undefined, zIndex: 2, forceLabel: true };
			}
			// No forceLabel here (unlike the hovered node above) - user
			// feedback: neighbor labels should only show when they'd
			// naturally clear labelRenderedSizeThreshold/labelDensity, same
			// as any other node, not unconditionally. Staying undimmed
			// (this branch returns `base` as-is, skipping the dim blend
			// below) is already the highlight - a neighbor doesn't also
			// need a forced label to read as "part of the hover".
			if (neighbors.has(n)) return base;
			// A cover-image node (type: 'image', see vaultGraph.ts) ignores
			// `color` entirely once its texture has loaded - @sigma/node-image's
			// NodeImageProgram only falls back to the color attribute when it
			// has no image reference to draw, so `color` alone is a silent
			// no-op on it. Clearing `image` alongside `color` is what actually
			// forces the fallback - there's no way to partially fade a loaded
			// image texture (no per-node opacity support), so it drops to its
			// blended flat color as soon as any dimming starts, rather than
			// fading the thumbnail itself.
			// blendToward's factor is "how much of the original color remains"
			// (1 = original, 0 = fully the target) - the inverse of dimProgress
			// (0 = not dimmed, 1 = fully dimmed).
			// `base`, not raw `attr` - a filter's `hidden: true` (or anything
			// else a previously-installed reducer computed) lives only in
			// `base`, never in the graph's own raw attributes, since Filter
			// mode never bakes `hidden` onto the graph itself. Spreading
			// `attr` here instead (an earlier version of this) silently
			// dropped that `hidden` for every node in this branch - i.e.
			// every non-hovered, non-neighbor node - the instant a hover
			// started, making the whole filtered-out set flash back into
			// view (dimmed, but no longer hidden) for as long as the hover
			// lasted. Reported as "hovering shows nodes/edges the filter
			// should be hiding".
			const color = blendToward(base.color as string, this.theme.dimNodeColor, 1 - dimProgress);
			// `image` isn't part of sigma's own NodeDisplayData type (only
			// Clew's own `attr`/Attributes-typed data carries it) - `base`'s
			// type is a union of both, so this needs the same cast `color`
			// above didn't (color exists on both sides of that union).
			const image = dimProgress > 0 ? undefined : ((base as Attributes).image as string | undefined);
			// The label fades in step with the dot (same computed color,
			// same dimProgress) instead of staying full-brightness while
			// everything around it dims - user feedback.
			return { ...base, color, image, labelColor: color };
		};
		const edgeReducer = (e: string, attr: Attributes) => {
			const base = previousEdgeReducer ? previousEdgeReducer(e, attr) : attr;
			if (incidentEdges.has(e)) {
				// If the user picked a custom edge color, honor it for the
				// highlighted neighbor edges too instead of always forcing
				// the theme's accent color - otherwise a deliberately chosen
				// edge color would still get silently overridden the moment
				// you hover, which is exactly the kind of "override doesn't
				// actually apply everywhere" gap edgeColorOverride exists to
				// avoid. Falls back to the usual accent color when no
				// override is set, unchanged from before.
				const color = this.plugin.settings.appearance.edgeColorOverride ?? this.theme.matchColor;
				return { ...base, color, size: 2, zIndex: 2 };
			}
			// Color alone reads as barely-there on an edge: dimEdgeColor
			// (--text-faint) and the default edge color (--graph-line) are
			// both already faint, low-saturation grays, so the blend between
			// them is a much smaller visual jump than a node's vivid accent
			// color fading to near-black - user feedback ("die Kanten aber
			// nicht") that the edge dim wasn't registering at all. Thinning
			// the edge alongside the color blend gives a second, unmistakable
			// signal that doesn't depend on the two colors being distinguishable.
			// vaultGraph.ts never sets an edge `size` (sigma defaults it to
			// 0.5 itself, but only *after* the reducer runs - see sigma's own
			// applyEdgeDefaults) - base.size is undefined here for every real
			// edge, so this must fall back to that same 0.5 itself, or the
			// multiplication below produces NaN and breaks the edge entirely.
			// `base`, not raw `attr`, for the same reason as the node
			// reducer above - a filtered-out edge's `hidden: true` only
			// exists in `base`.
			const baseSize = typeof base.size === 'number' ? base.size : 0.5;
			const size = baseSize * (1 - 0.5 * dimProgress);
			return { ...base, color: blendToward(this.resolvedEdgeColor(), this.theme.dimEdgeColor, 1 - dimProgress), size };
		};

		renderer.on('enterNode', (payload) => {
			if (this.draggedNode || !this.graph) return;
			hoveredNode = payload.node;
			neighbors = new Set(this.graph.neighbors(hoveredNode));
			incidentEdges = new Set(this.graph.edges(hoveredNode));

			// Only capture/install once, the first time a hover starts from
			// fully settled (undimmed) - not on every enterNode, which would
			// otherwise re-capture *this* reducer as "previous" on a quick
			// hop between two nodes and lose whatever mode (the filter, a
			// path result, cluster freshness) was active before hovering
			// began at all.
			if (animationFrame === null && dimProgress === 0) {
				previousNodeReducer = renderer.getSetting('nodeReducer');
				previousEdgeReducer = renderer.getSetting('edgeReducer');
				renderer.setSetting('nodeReducer', nodeReducer);
				renderer.setSetting('edgeReducer', edgeReducer);
			}
			animateDimProgressTo(1);
		});

		renderer.on('leaveNode', () => {
			if (!hoveredNode) return;
			hoveredNode = null;
			animateDimProgressTo(0, () => {
				renderer.setSetting('nodeReducer', previousNodeReducer);
				renderer.setSetting('edgeReducer', previousEdgeReducer);
			});
		});
	}

	/**
	 * Rebuilt from scratch each time the panel opens (not built once and
	 * left standing), same list/edit-form architecture as Color & size's
	 * renderColorAndSizePanel() (create/edit/delete/enable, no separate
	 * Save step) - user feedback: "es fehlt die gesamte Logik für
	 * erstellen/editieren/löschen von Filtern (wie in Color & Size)". Each
	 * filter's own criteria use the exact same chip/edit-row UI a group's
	 * criteria do (renderCriteriaList()/openAddCriterionMenu()); unlike a
	 * group, a filter has no color/size, and several enabled filters
	 * combine with OR rather than "first match wins" (see filter.ts's
	 * docstring), so there's no drag-to-reorder here either.
	 */
	private renderFilterPanel(): void {
		this.filterPanelEl.empty();
		const headerEl = this.filterPanelEl.createDiv({ cls: 'clew-appearance-panel-header' });
		headerEl.createEl('h4', { text: 'Filter' });
		const closeButton = headerEl.createEl('button', { cls: 'clickable-icon' });
		setIcon(closeButton, 'x');
		setTooltip(closeButton, 'Close');
		closeButton.addEventListener('click', () => this.toggleFilterPanel());

		// How several *enabled* filters combine - one level above each
		// filter's own criteria (which always AND, same as a node group's -
		// see filter.ts's docstring) - user feedback: "Das ist auf der
		// falschen Ebene [...] soll für die Kombination von ganzen Filtern
		// gelten", after an earlier version put this choice on each
		// filter's own criteria instead. A single control for the whole
		// panel, not per-filter - it describes how the *list* combines, not
		// any one filter's own behavior.
		new Setting(this.filterPanelEl).setName('Show if it matches').addDropdown((dropdown) =>
			dropdown
				.addOption('or', 'At least one filter')
				.addOption('and', 'Every filter')
				.setValue(this.plugin.settings.filterCombineMode)
				.onChange((value) => {
					this.plugin.settings.filterCombineMode = value as FilterCombineMode;
					void this.plugin.saveSettings();
					this.applyFilters();
				}),
		);

		// Shared by every `folder` criterion row's text input, own id per
		// panel (see CriteriaEditorContext's folderDatalistId docstring) so
		// this and Color & size's own datalist never collide if both panels
		// are open at once.
		const datalist = this.filterPanelEl.createEl('datalist', { attr: { id: 'clew-filter-folders' } });
		for (const folder of this.availableFolders) datalist.createEl('option', { value: folder });

		this.filterListContainerEl = this.filterPanelEl.createDiv({ cls: 'clew-group-list' });
		this.renderFilterList();

		const addButton = this.filterPanelEl.createEl('button', { text: '+ new filter', cls: 'clew-filter-add-button' });
		addButton.disabled = this.plugin.settings.filterPresets.length >= MAX_FILTER_PRESETS || this.editingFilterId !== null;
		addButton.addEventListener('click', () => this.startCreatingFilter());
	}

	private renderFilterList(): void {
		this.filterListContainerEl.empty();
		const presets = this.plugin.settings.filterPresets;

		if (presets.length === 0) {
			this.filterListContainerEl.createEl('p', { text: 'No filters yet.', cls: 'clew-filter-empty-note' });
		}

		presets.forEach((preset, index) => {
			if (this.editingFilterId === preset.id) this.renderFilterEditForm(preset);
			else this.renderFilterRow(preset, index);
		});
	}

	/** A filter's collapsed row - same shape as a Color & size group's row (renderGroupRow()), including the drag handle (user feedback), minus the color swatch (a filter has no color). Reordering is purely a user-organization convenience here - see draggedFilterIndex's docstring for why it doesn't affect matching. */
	private renderFilterRow(preset: FilterPreset, index: number): void {
		const row = this.filterListContainerEl.createDiv({ cls: 'clew-group-row' });
		row.setAttribute('draggable', 'true');

		const handle = row.createSpan({ cls: 'clew-group-drag-handle' });
		setIcon(handle, 'grip-vertical');
		setTooltip(handle, 'Drag to reorder');

		row.createSpan({ cls: 'clew-group-name', text: preset.name });

		new ExtraButtonComponent(row).setIcon('pencil').setTooltip('Edit').onClick(() => this.toggleEditingFilter(preset.id));
		new ExtraButtonComponent(row).setIcon('trash').setTooltip('Delete').onClick(() => this.deleteFilter(preset.id));

		new ToggleComponent(row).setValue(preset.enabled).onChange((value) => {
			preset.enabled = value;
			void this.plugin.saveSettings();
			this.applyFilters();
		});

		this.setupFilterRowDrag(row, index);
	}

	/** Whole-row HTML5 drag-and-drop for the filter list - same mechanics as setupGroupRowDrag(), just reordering plugin.settings.filterPresets (and with no effect on which notes match, unlike a node group's drag - see draggedFilterIndex's docstring). */
	private setupFilterRowDrag(row: HTMLElement, index: number): void {
		row.addEventListener('dragstart', (evt) => {
			this.draggedFilterIndex = index;
			row.addClass('is-dragging');
			evt.dataTransfer?.setData('text/plain', String(index));
		});
		row.addEventListener('dragend', () => {
			row.removeClass('is-dragging');
			this.draggedFilterIndex = null;
			this.filterListContainerEl.findAll('.clew-group-row').forEach((el) => el.removeClass('is-drag-over'));
		});
		row.addEventListener('dragover', (evt) => {
			if (this.draggedFilterIndex === null || this.draggedFilterIndex === index) return;
			evt.preventDefault(); // required for 'drop' to fire at all
			row.addClass('is-drag-over');
		});
		row.addEventListener('dragleave', () => row.removeClass('is-drag-over'));
		row.addEventListener('drop', (evt) => {
			evt.preventDefault();
			if (this.draggedFilterIndex === null || this.draggedFilterIndex === index) return;
			this.reorderFilter(this.draggedFilterIndex, index);
		});
	}

	/** Moves the filter at `from` to just before the filter at `to`'s current (pre-move) position - see setupGroupRowDrag()'s docstring for why "before", not "onto", is the drop semantic. */
	private reorderFilter(from: number, to: number): void {
		const presets = this.plugin.settings.filterPresets;
		const [moved] = presets.splice(from, 1);
		presets.splice(from < to ? to - 1 : to, 0, moved!);
		void this.plugin.saveSettings();
		this.renderFilterList();
	}

	/**
	 * The full edit form for `preset` - same shape as a Color & size
	 * group's own edit form (renderGroupEditForm()) minus the color picker
	 * and "Scale size" toggle/slider, which don't apply to a filter (see
	 * filter.ts's docstring). Every field mutates `preset` directly,
	 * persists (debouncedSaveFilterPresets) and re-applies (applyFilter())
	 * right away - no separate Save/Cancel step, same reasoning as node
	 * groups.
	 */
	private renderFilterEditForm(preset: FilterPreset): void {
		// Flattened the same way as Color & size's own edit form
		// (renderGroupEditForm()) - user feedback that the flattening should
		// apply here too, not just there. No "Filter"/"Criteria" Setting
		// headings any more; the name field (no color swatch - a filter has
		// none) and the "x" that closes the form sit on one row, with the
		// criteria list directly beneath. 'clew-group-edit-flat' drops the
		// left-inset that existed only to line child rows up with those now-
		// removed headings - see styles.css.
		const formEl = this.filterListContainerEl.createDiv({ cls: 'clew-group-edit clew-group-edit-flat' });

		const nameRowEl = formEl.createDiv({ cls: 'clew-group-name-row' });
		new TextComponent(nameRowEl).setValue(preset.name).onChange((value) => {
			preset.name = value;
			this.debouncedSaveFilterPresets();
		});
		new ExtraButtonComponent(nameRowEl).setIcon('x').setTooltip('Close').onClick(() => this.toggleEditingFilter(preset.id));

		const criteriaEl = formEl.createDiv({ cls: 'clew-group-criteria' });
		this.renderCriteriaList(criteriaEl, this.filterCriteriaContext(preset));

		const addCriterionButton = formEl.createEl('button', { text: '+ add', cls: 'clew-filter-add-button' });
		addCriterionButton.addEventListener('click', (evt) => this.openAddCriterionMenu(evt, this.filterCriteriaContext(preset)));
	}

	/** Creates a new filter, saves it immediately, and opens it in edit mode - same reasoning as startCreatingGroup(): no separate Save step, it exists (and is persisted) from the moment it's created, even before any criteria are added (an empty-criteria filter just doesn't match anything yet). */
	private startCreatingFilter(): void {
		if (this.plugin.settings.filterPresets.length >= MAX_FILTER_PRESETS) return;
		const preset: FilterPreset = {
			id: `filter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			name: `Filter ${this.plugin.settings.filterPresets.length + 1}`,
			enabled: true,
			criteria: [],
		};
		this.plugin.settings.filterPresets.push(preset);
		void this.plugin.saveSettings();
		this.editingFilterId = preset.id;
		this.editingFilterCriterionIndex = null;
		this.filterCriterionEditSnapshot = null;
		this.applyFilters();
		this.renderFilterPanel();
	}

	/** Expands a filter's row into its edit form, or collapses it if it's already the one open - same reasoning as toggleEditingGroup(): every field already persists as it changes, so this is purely a display toggle. */
	private toggleEditingFilter(id: string): void {
		this.editingFilterId = this.editingFilterId === id ? null : id;
		this.editingFilterCriterionIndex = null;
		this.filterCriterionEditSnapshot = null;
		this.renderFilterPanel();
	}

	private deleteFilter(id: string): void {
		const preset = this.plugin.settings.filterPresets.find((p) => p.id === id);
		if (!preset) return;
		new ConfirmModal(this.app, 'Delete filter?', `"${preset.name}" and its criteria will be permanently deleted.`, 'Delete', () => {
			this.plugin.settings.filterPresets = this.plugin.settings.filterPresets.filter((p) => p.id !== id);
			void this.plugin.saveSettings();
			if (this.editingFilterId === id) {
				this.editingFilterId = null;
				this.editingFilterCriterionIndex = null;
				this.filterCriterionEditSnapshot = null;
			}
			this.applyFilters();
			this.renderFilterPanel();
		}).open();
	}

	/**
	 * Bridges one filter's own criteria + editing state into the same
	 * CriteriaEditorContext shape a Color & size group's criteria use (see
	 * groupCriteriaContext()) - lets renderCriteriaList()/
	 * renderCriterionChip()/renderCriterionEditRow()/openAddCriterionMenu()
	 * stay agnostic to which panel called them.
	 */
	private filterCriteriaContext(preset: FilterPreset): CriteriaEditorContext {
		return {
			criteria: preset.criteria,
			editingIndex: this.editingFilterCriterionIndex,
			setEditingIndex: (index) => {
				this.editingFilterCriterionIndex = index;
			},
			snapshot: this.filterCriterionEditSnapshot,
			setSnapshot: (snapshot) => {
				this.filterCriterionEditSnapshot = snapshot;
			},
			onChange: () => {
				this.debouncedSaveFilterPresets();
				this.applyFilters();
			},
			rerenderPanel: () => this.renderFilterPanel(),
			folderDatalistId: 'clew-filter-folders',
		};
	}

	/**
	 * Call after ANY change to plugin.settings.filterPresets (add/edit/
	 * delete/enable-toggle) - the filter analogue of applyNodeGroups().
	 * Re-applies the filter immediately with whatever's already cached,
	 * then - only if a filter now needs note content - awaits a fresh read
	 * and re-applies again, so a first-ever (or newly re-enabled) `text`
	 * criterion isn't left showing stale (empty) matches. A previous
	 * version had callers invoke applyFilter() directly instead of this -
	 * a real bug: enabling a filter whose `text` criterion was set up
	 * while nothing else needed note content (so noteContentCache was
	 * still empty) never re-checked that need, permanently matching zero
	 * notes until some unrelated criteria edit happened to trigger a
	 * refresh - user feedback ("Filter = old" showed no results only when
	 * enabled *after* a content-independent Color & size criterion).
	 */
	private applyFilters(): void {
		// If the timeline is actively narrowing the graph (mid-scrub, not
		// resting at "today"), a filter edit made in that state should stay
		// intersected with it (see applyTimeline()'s own docstring) rather
		// than this unconditionally handing the reducer back to a plain
		// filter-only view until the scrubber is next touched.
		if (this.timelineBounds && this.timelineCursor < this.timelineBounds.end) this.applyTimeline();
		else this.applyFilter();
		void this.refreshCriteriaContent();
	}

	/** Reflects whether any filter is currently *enabled* (not whether the panel is open, or whether an enabled filter actually matched anything) - see filterButton's own docstring in the constructor. */
	private updateFilterButtonState(): void {
		this.filterButton.toggleClass('is-active', isAnyFilterEnabled(this.plugin.settings.filterPresets));
	}

	/**
	 * The current filter's match set, or `null` if no filter is enabled -
	 * `null` specifically means "no restriction" (everything matches), not
	 * "matches nothing" (see filter.ts's isAnyFilterEnabled() docstring).
	 * Shared by applyFilter() and applyTimeline(), which needs to know this
	 * to keep an active filter in effect while scrubbing/playing (user
	 * feedback: "Wenn ein Filter gesetzt ist, wird dieser bei Animate nicht
	 * berücksichtigt") rather than silently overriding it the way Find-path/
	 * Stagnation already override each other in this file.
	 */
	private currentFilterMatches(): Set<string> | null {
		const presets = this.plugin.settings.filterPresets;
		if (!isAnyFilterEnabled(presets)) return null;
		return evaluateFilters(this.buildCriteriaFacts(), presets, this.plugin.settings.filterCombineMode);
	}

	/**
	 * Re-evaluates every enabled filter against every note (OR across
	 * filters - see filter.ts's docstring) and hides every non-matching
	 * node/edge - called on every filter/criterion change, not just a
	 * toggle, so e.g. adding a criterion updates the graph immediately
	 * too, and from setFiles()/refreshTheme() so filters keep applying
	 * across a vault refresh or theme switch instead of silently dropping
	 * (they're saved state now, not transient - see settings.ts's
	 * ClewSettings.filterPresets). "nur die passenden Knoten anzeigen" - an
	 * edge only stays visible when *both* extremities match - showing a
	 * match's edge to a hidden neighbor would look broken and defeats
	 * "only show what matches" anyway. The match set is precomputed as a
	 * Set before installing the edge reducer (same pattern as
	 * applyHighlight()'s primaryEdges/altEdges) - graphology's
	 * extremities() is a lookup, not free, and the reducer runs once per
	 * edge per frame.
	 */
	private applyFilter(): void {
		this.updateFilterButtonState();
		if (!this.graph) return;
		const graph = this.graph;
		const matches = this.currentFilterMatches();

		if (!matches) {
			this.clearHighlight();
			this.renderLegend();
			this.updateEmptyState();
			return;
		}

		// Mutually exclusive with a shown path result, same as it is with
		// find-path itself - clears its state directly rather than only
		// overwriting reducers, so re-toggling one of them later doesn't
		// resurrect stale UI. Active node groups (if any) are left alone -
		// they're a baseline the filter reducer temporarily paints over,
		// not something the filter needs to clear.
		this.panelEl.empty();
		this.panelEl.hide();
		this.pathResultActive = false;

		const visibleEdges = new Set(graph.edges().filter((edge) => graph.extremities(edge).every((node) => matches.has(node))));
		this.renderer?.setSetting('nodeReducer', (node, attr) => ({ ...attr, hidden: !matches.has(node) }));
		this.renderer?.setSetting('edgeReducer', (edge, attr) => ({ ...attr, hidden: !visibleEdges.has(edge) }));
		this.renderLegend();
		this.updateEmptyState(matches.size);
	}

	/**
	 * Shows/hides the empty-state card - vault has no notes at all (checked
	 * first, takes priority) or an active filter matches none of them
	 * (`filterMatchCount === 0`, passed by applyFilter() from the match set
	 * it just computed rather than re-evaluating filters here). Called from
	 * every applyFilter() exit path (including the "no filter enabled"
	 * early return, so a vault that's empty independent of any filter still
	 * shows the right card) and indirectly from setFiles() (which always
	 * calls applyFilter() on a fresh file set).
	 */
	private updateEmptyState(filterMatchCount?: number): void {
		if (this.files.length === 0) {
			this.showEmptyState('vault');
		} else if (filterMatchCount === 0) {
			this.showEmptyState('filter');
		} else {
			this.emptyStateEl.hide();
		}
	}

	/**
	 * Rebuilt from scratch each time (not left standing and toggled) -
	 * cheap (a handful of elements) and simpler than tracking which of the
	 * two fixed shapes is currently showing. 'vault': nothing actionable
	 * from inside the graph view, so no button - just an explanation.
	 * 'filter': an active filter is the *reason* nothing shows, so a
	 * "Reset filter" button (disables every currently enabled filter) is
	 * the one obvious next step, right there instead of requiring a trip
	 * to the Filter panel.
	 */
	private showEmptyState(kind: 'vault' | 'filter'): void {
		this.emptyStateEl.empty();
		const cardEl = this.emptyStateEl.createDiv({ cls: 'clew-empty-state-card' });
		setIcon(cardEl.createDiv({ cls: 'clew-empty-state-icon' }), kind === 'vault' ? 'file-text' : 'search-x');
		cardEl.createDiv({ cls: 'clew-empty-state-heading', text: kind === 'vault' ? 'No notes in this vault' : 'No notes found' });
		cardEl.createDiv({
			cls: 'clew-empty-state-sub',
			text: kind === 'vault' ? 'Create a note to see it appear here.' : 'Your active filter has no matches.',
		});
		if (kind === 'filter') {
			const resetButton = cardEl.createEl('button', { text: 'Reset filter' });
			resetButton.addEventListener('click', () => {
				for (const preset of this.plugin.settings.filterPresets) preset.enabled = false;
				void this.plugin.saveSettings();
				this.applyFilters();
				if (this.filterPanelEl.isShown()) this.renderFilterPanel();
			});
		}
		this.emptyStateEl.show();
	}

	/**
	 * Repopulates availableTags/availableProperties/availableFolders from
	 * the current file set and re-renders whichever of Filter/Color & size
	 * is currently open - called from setFiles(). Shared by both panels
	 * (see this file's availableTags docstring) since Filter and Color &
	 * size criteria are the exact same GroupCriterion shapes now. Doesn't
	 * prune stale values out of existing criteria: a saved criterion is a
	 * deliberate choice, and silently rewriting it out from under the user
	 * just because a tag momentarily isn't present in the currently loaded
	 * file set would be more surprising than leaving it matching zero notes.
	 */
	private refreshCriteriaOptions(): void {
		const tags = new Set<string>();
		const properties = new Set<string>();
		const folders = new Set<string>();
		for (const file of this.files) {
			const cache = this.app.metadataCache.getFileCache(file);
			for (const tag of (cache ? getAllTags(cache) : null) ?? []) tags.add(tag);
			for (const key of Object.keys(cache?.frontmatter ?? {})) properties.add(key);
			const folder = file.parent?.path ?? '';
			if (folder !== '' && folder !== '/') folders.add(folder);
		}

		this.availableTags = [...tags].sort();
		this.availableProperties = [...properties].sort();
		this.availableFolders = [...folders].sort();

		if (this.filterPanelEl.isShown()) this.renderFilterPanel();
		if (this.colorAndSizePanelEl.isShown()) this.renderColorAndSizePanel();
	}

	/** Reveals the filter panel (behind its own icon, like Find path is behind a modal) or just hides it - the filter itself (see applyFilter()) keeps running either way, since it's saved state now, not something closing the panel should reset. */
	private toggleFilterPanel(): void {
		if (this.filterPanelEl.isShown()) {
			this.filterPanelEl.hide();
			this.editingFilterId = null;
			this.editingFilterCriterionIndex = null;
			this.filterCriterionEditSnapshot = null;
			return;
		}
		this.closeOtherPanels('filter');
		this.renderFilterPanel();
		this.filterPanelEl.show();
	}

	/** Reflects whether any node group is currently *enabled* (not whether the panel is open, or whether an enabled group actually matched anything) - see colorAndSizeButton's own docstring in the constructor. */
	private updateColorAndSizeButtonState(): void {
		this.colorAndSizeButton.toggleClass('is-active', this.plugin.settings.nodeGroups.some((group) => group.enabled));
	}

	/** Reads every note's title + body content into noteContentCache - real I/O (vault.cachedRead() per file), so only called when at least one enabled group has a `text` criterion (see nodeGroups.ts's needsContentSearch()); the cache is cleared instead once nothing needs it any more. */
	private async refreshNoteContentCache(): Promise<void> {
		const entries = await Promise.all(
			this.files.map(async (file): Promise<[string, string]> => [
				file.path,
				`${file.basename}\n${await this.app.vault.cachedRead(file)}`.toLowerCase(),
			]),
		);
		this.noteContentCache = new Map(entries);
	}

	/** Synchronous repaint using whatever's already in noteContentCache - the part of applyNodeGroups() every group-definition change needs *immediately*, split out so refreshNodeGroupContent() below can call it again once fresh content lands, without redoing the button-state/graph-guard bookkeeping twice. */
	private repaintNodeGroups(): void {
		this.updateColorAndSizeButtonState();
		if (!this.graph) return;
		this.paintVisualEncoding();
		this.renderer?.refresh();
		this.renderLegend();
	}

	/**
	 * The async half of applyNodeGroups()/filterCriteriaContext()'s onChange
	 * - refreshes (or clears) noteContentCache to match whether any enabled
	 * group *or the filter* currently needs it (see filter.ts's docstring
	 * for why both now share the exact same `text` criterion), repainting
	 * both again only when that cache actually changed.
	 */
	private async refreshCriteriaContent(): Promise<void> {
		if (needsContentSearch(this.allCriteriaOwners())) {
			await this.refreshNoteContentCache();
		} else if (this.noteContentCache.size > 0) {
			this.noteContentCache = new Map();
		} else {
			return;
		}
		this.repaintNodeGroups();
		this.applyFilter();
	}

	/**
	 * Call after ANY change to plugin.settings.nodeGroups (add/edit/delete/
	 * reorder/enable-toggle - every field in the edit form calls this too,
	 * since there's no separate Save step any more - user feedback) or from
	 * setFiles()/refreshTheme(), so groups keep applying across a vault
	 * refresh or theme switch instead of silently dropping (they're saved
	 * state, not transient). Repaints immediately with whatever's already
	 * cached, then - only if a group needs note content - awaits a fresh
	 * read and repaints again, so a first-ever `text` criterion isn't left
	 * showing stale (empty) matches until some unrelated repaint happens to
	 * fire.
	 */
	private applyNodeGroups(): void {
		this.repaintNodeGroups();
		void this.refreshCriteriaContent();
	}

	/**
	 * Rebuilt from scratch on open and on every group add/edit/delete/
	 * reorder (not built once and left standing), same reasoning as
	 * renderFilterPanel()/renderAppearancePanel(). The group at
	 * editingGroupId renders its full form in place of its collapsed row.
	 */
	private renderColorAndSizePanel(): void {
		this.colorAndSizePanelEl.empty();
		const headerEl = this.colorAndSizePanelEl.createDiv({ cls: 'clew-appearance-panel-header' });
		headerEl.createEl('h4', { text: 'Color & size' });
		const closeButton = headerEl.createEl('button', { cls: 'clickable-icon' });
		setIcon(closeButton, 'x');
		setTooltip(closeButton, 'Close');
		closeButton.addEventListener('click', () => this.toggleColorAndSizePanel());

		// Shared by every `folder` criterion row's text input (renderCriterionRow())
		// as free-text-with-suggestions (a native <datalist>) rather than a
		// dropdown - user feedback: a vault can have many folders, a rigid
		// dropdown doesn't scale the way it does for tags/properties.
		const datalist = this.colorAndSizePanelEl.createEl('datalist', { attr: { id: 'clew-color-size-folders' } });
		for (const folder of this.availableFolders) datalist.createEl('option', { value: folder });

		this.colorAndSizeGroupsContainerEl = this.colorAndSizePanelEl.createDiv({ cls: 'clew-group-list' });
		this.renderNodeGroupList();

		const addButton = this.colorAndSizePanelEl.createEl('button', { text: '+ new group', cls: 'clew-filter-add-button' });
		addButton.disabled = this.plugin.settings.nodeGroups.length >= MAX_NODE_GROUPS || this.editingGroupId !== null;
		addButton.addEventListener('click', () => this.startCreatingGroup());
	}

	private renderNodeGroupList(): void {
		this.colorAndSizeGroupsContainerEl.empty();
		const groups = this.plugin.settings.nodeGroups;

		if (groups.length === 0) {
			this.colorAndSizeGroupsContainerEl.createEl('p', { text: 'No groups yet.', cls: 'clew-filter-empty-note' });
		}

		groups.forEach((group, index) => {
			if (this.editingGroupId === group.id) this.renderGroupEditForm(group);
			else this.renderGroupRow(group, index);
		});
	}

	/** A group's collapsed row - a drag handle (reordering directly controls match precedence, see nodeGroups.ts's docstring), an always-live enabled toggle, a static color swatch, its name, and edit/delete - deliberately plain elements (not a full Setting per row) rather than the padding a Setting row costs, same reasoning Filter's tag pills used. */
	private renderGroupRow(group: NodeGroup, index: number): void {
		const row = this.colorAndSizeGroupsContainerEl.createDiv({ cls: 'clew-group-row' });
		row.setAttribute('draggable', 'true');

		const handle = row.createSpan({ cls: 'clew-group-drag-handle' });
		setIcon(handle, 'grip-vertical');
		setTooltip(handle, 'Drag to reorder');

		row.createSpan({ cls: 'clew-group-swatch' }).style.backgroundColor = group.color;
		row.createSpan({ cls: 'clew-group-name', text: group.name });

		new ExtraButtonComponent(row).setIcon('pencil').setTooltip('Edit').onClick(() => this.toggleEditingGroup(group.id));
		new ExtraButtonComponent(row).setIcon('trash').setTooltip('Delete').onClick(() => this.deleteGroup(group.id));

		// After delete, not near the drag handle (user feedback) - the
		// enable toggle is the row's own "is this active" state, not part
		// of the reorder/edit/delete action cluster.
		new ToggleComponent(row).setValue(group.enabled).onChange((value) => {
			group.enabled = value;
			void this.plugin.saveSettings();
			this.applyNodeGroups();
		});

		this.setupGroupRowDrag(row, index);
	}

	/**
	 * Whole-row HTML5 drag-and-drop (not just the handle - `draggable` on the
	 * row keeps the drag image showing the full row, same as most list UIs;
	 * the handle exists so hovering it, not the whole row, is what signals
	 * "you can drag this") - replaced the previous up/down arrow buttons
	 * entirely (user feedback), directly reordering `plugin.settings.nodeGroups`,
	 * which controls match precedence (see nodeGroups.ts's docstring).
	 * Dropping always means "move the dragged group to just before this
	 * one" - simpler and more predictable than also detecting which half of
	 * the target row the pointer is over.
	 */
	private setupGroupRowDrag(row: HTMLElement, index: number): void {
		row.addEventListener('dragstart', (evt) => {
			this.draggedGroupIndex = index;
			row.addClass('is-dragging');
			// Firefox refuses to start a drag at all without data actually
			// set on the DataTransfer - the value itself is unused, reorderGroup
			// reads this.draggedGroupIndex instead (renderNodeGroupList()
			// rebuilds every row from scratch mid-drag on hover, which would
			// otherwise lose data stashed only in the dragstart event).
			evt.dataTransfer?.setData('text/plain', String(index));
		});
		row.addEventListener('dragend', () => {
			row.removeClass('is-dragging');
			this.draggedGroupIndex = null;
			this.colorAndSizeGroupsContainerEl.findAll('.clew-group-row').forEach((el) => el.removeClass('is-drag-over'));
		});
		row.addEventListener('dragover', (evt) => {
			if (this.draggedGroupIndex === null || this.draggedGroupIndex === index) return;
			evt.preventDefault(); // required for 'drop' to fire at all
			row.addClass('is-drag-over');
		});
		row.addEventListener('dragleave', () => row.removeClass('is-drag-over'));
		row.addEventListener('drop', (evt) => {
			evt.preventDefault();
			if (this.draggedGroupIndex === null || this.draggedGroupIndex === index) return;
			this.reorderGroup(this.draggedGroupIndex, index);
		});
	}

	/** Moves the group at `from` to just before the group at `to`'s current (pre-move) position - see setupGroupRowDrag()'s docstring for why "before", not "onto", is the drop semantic. */
	private reorderGroup(from: number, to: number): void {
		const groups = this.plugin.settings.nodeGroups;
		const [moved] = groups.splice(from, 1);
		groups.splice(from < to ? to - 1 : to, 0, moved!);
		void this.plugin.saveSettings();
		this.applyNodeGroups();
		this.renderNodeGroupList();
	}

	/** Creates a new group, saves it immediately, and opens it in edit mode - user feedback: no separate "Save" step any more, a group exists (and is persisted) from the moment it's created, even before any criteria are added (an empty-criteria group just doesn't match anything yet - see nodeGroups.ts's matchesGroup()). */
	private startCreatingGroup(): void {
		if (this.plugin.settings.nodeGroups.length >= MAX_NODE_GROUPS) return;
		const color = DEFAULT_GROUP_COLORS[this.plugin.settings.nodeGroups.length % DEFAULT_GROUP_COLORS.length]!;
		const group: NodeGroup = {
			id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			name: `Group ${this.plugin.settings.nodeGroups.length + 1}`,
			color,
			sizeMultiplier: null,
			enabled: true,
			criteria: [],
		};
		this.plugin.settings.nodeGroups.push(group);
		void this.plugin.saveSettings();
		this.editingGroupId = group.id;
		this.editingCriterionIndex = null;
		this.criterionEditSnapshot = null;
		this.applyNodeGroups();
		this.renderColorAndSizePanel();
	}

	/** Expands a group's row into its edit form, or collapses it if it's already the one open - there's nothing to save/discard on either transition any more (every field already persists as it changes - see debouncedSaveNodeGroups's docstring), so this is purely a display toggle. */
	private toggleEditingGroup(id: string): void {
		this.editingGroupId = this.editingGroupId === id ? null : id;
		this.editingCriterionIndex = null;
		this.criterionEditSnapshot = null;
		this.renderColorAndSizePanel();
	}

	private deleteGroup(id: string): void {
		const group = this.plugin.settings.nodeGroups.find((g) => g.id === id);
		if (!group) return;
		new ConfirmModal(this.app, 'Delete group?', `"${group.name}" and its criteria will be permanently deleted.`, 'Delete', () => {
			this.plugin.settings.nodeGroups = this.plugin.settings.nodeGroups.filter((g) => g.id !== id);
			void this.plugin.saveSettings();
			if (this.editingGroupId === id) {
				this.editingGroupId = null;
				this.editingCriterionIndex = null;
				this.criterionEditSnapshot = null;
			}
			this.applyNodeGroups();
			this.renderColorAndSizePanel();
		}).open();
	}

	/** A blank starting point for a newly-added criterion of the chosen type - pre-fills the first available property (if any) rather than leaving an empty dropdown, so a freshly-added row already reads as a real (if not yet meaningful) criterion. `tag` starts with no tags picked (its own pill UI adds them) rather than guessing one. */
	private blankCriterion(type: GroupCriterionType): GroupCriterion {
		switch (type) {
			case 'clusterFreshness':
				return { type, bucket: 'stagnant' };
			case 'text':
				return { type, query: '' };
			case 'folder':
				return { type, folder: '' };
			case 'filename':
				return { type, query: '' };
			case 'tag':
				return { type, tags: [] };
			case 'property':
				return { type, key: this.availableProperties[0] ?? '', operator: 'contains', value: '' };
			case 'staleDays':
				return { type, days: 30 };
			case 'minLinks':
				return { type, count: 1 };
		}
	}

	/** Bridges a group's own criteria + editing state into CriteriaEditorContext - see that interface's docstring. */
	private groupCriteriaContext(group: NodeGroup): CriteriaEditorContext {
		return {
			criteria: group.criteria,
			editingIndex: this.editingCriterionIndex,
			setEditingIndex: (index) => {
				this.editingCriterionIndex = index;
			},
			snapshot: this.criterionEditSnapshot,
			setSnapshot: (snapshot) => {
				this.criterionEditSnapshot = snapshot;
			},
			onChange: () => {
				this.debouncedSaveNodeGroups();
				this.applyNodeGroups();
			},
			rerenderPanel: () => this.renderColorAndSizePanel(),
			folderDatalistId: 'clew-color-size-folders',
		};
	}

	/**
	 * The "+ add" menu shared by a Color & size group's criteria and
	 * Filter's own criteria (see CriteriaEditorContext's docstring) - same
	 * Menu-based pattern the "Layout" toolbar button used before it became
	 * a dialog (see openLayoutModal()) rather than a separate type
	 * dropdown + "add" button next to it - user feedback: picking a type,
	 * then having to also click a second control to actually add it, was
	 * an extra step for what's really one action ("add a criterion of this
	 * type").
	 */
	private openAddCriterionMenu(evt: MouseEvent, ctx: CriteriaEditorContext): void {
		const menu = new Menu();
		const addOption = (type: GroupCriterionType, label: string): void => {
			menu.addItem((item) =>
				item.setTitle(label).onClick(() => {
					ctx.criteria.push(this.blankCriterion(type));
					// Opens straight into its expanded controls rather than
					// showing as an unconfigured chip first - it needs setting
					// up right away, and there's nothing useful a collapsed
					// "(none picked)" chip would show in the meantime.
					// snapshot stays null - see CriteriaEditorContext's docstring
					// for why that's what makes this criterion's "Cancel" remove
					// it outright instead of "reverting" it to blank.
					ctx.setEditingIndex(ctx.criteria.length - 1);
					ctx.setSnapshot(null);
					ctx.onChange();
					ctx.rerenderPanel();
				}),
			);
		};
		// Ordered by expected usage frequency, most common first (user
		// feedback) - not alphabetical, not by GroupCriterionType's own
		// declaration order.
		addOption('text', 'Text (name & content)');
		addOption('tag', 'Tag');
		addOption('property', 'Property');
		addOption('folder', 'Folder');
		addOption('filename', 'Filename');
		addOption('staleDays', 'Not edited at least (days)');
		addOption('clusterFreshness', 'Activity');
		addOption('minLinks', 'Minimum number of links');
		menu.showAtMouseEvent(evt);
	}

	/**
	 * The full edit form for `group` - a real entry in
	 * plugin.settings.nodeGroups, not a staged copy (user feedback: every
	 * change should just save immediately, no separate Save/Cancel step).
	 * Every field mutates `group` directly, persists (debouncedSaveNodeGroups)
	 * and repaints (applyNodeGroups()) right away. "Done" at the bottom only
	 * collapses the form back to the group's row - there's nothing left to
	 * commit or discard by then.
	 */
	private renderGroupEditForm(group: NodeGroup): void {
		// 'clew-group-edit-flat' in addition to the shared 'clew-group-edit'
		// (still used as-is by Filter's own renderFilterEditForm()) - this
		// form dropped its "Group"/"Criteria" Setting headings (flattened,
		// see below), so it no longer needs the child-row left-inset that
		// exists purely to line their text up with a Setting's own indent -
		// see styles.css's `.clew-group-edit-flat` rule.
		const formEl = this.colorAndSizeGroupsContainerEl.createDiv({ cls: 'clew-group-edit clew-group-edit-flat' });

		// Flattened from a separate "Group" heading row + always-visible
		// "Scale size" toggle row into one line - user feedback: three
		// stacked boxes (this form's own background, a "Criteria" heading
		// section, and each criterion's own box) before reaching any actual
		// criteria read as cluttered. The color picker and name field are
		// the two things every group needs; "Scale size" (rarely used) is
		// tucked behind the "..." menu instead of always claiming a row of
		// its own, and "x" (closes the form back to the group's row) moved
		// here rather than under a now-removed heading.
		const nameRowEl = formEl.createDiv({ cls: 'clew-group-name-row' });
		new ColorComponent(nameRowEl).setValue(group.color).onChange((value) => {
			group.color = value;
			this.debouncedSaveNodeGroups();
			this.applyNodeGroups();
		});
		new TextComponent(nameRowEl).setValue(group.name).onChange((value) => {
			group.name = value;
			this.debouncedSaveNodeGroups();
			this.applyNodeGroups();
		});
		const optionsButton = new ExtraButtonComponent(nameRowEl).setIcon('more-vertical').setTooltip('More options');
		optionsButton.onClick(() => this.openGroupOptionsMenu(optionsButton.extraSettingsEl, group));
		new ExtraButtonComponent(nameRowEl).setIcon('x').setTooltip('Close').onClick(() => this.toggleEditingGroup(group.id));

		// No description here (user feedback: not needed) - "Scale size"
		// off by default (sizeMultiplier starts null, see startCreatingGroup())
		// plus the slider's own live tooltip while dragging cover it well
		// enough without a permanent explanatory line.
		if (group.sizeMultiplier !== null) {
			new Setting(formEl).setName('Size multiplier').addSlider((slider) =>
				slider
					.setLimits(0.3, 3, 0.1)
					.setValue(group.sizeMultiplier!)
					.setDynamicTooltip()
					.onChange((value) => {
						group.sizeMultiplier = value;
						this.debouncedSaveNodeGroups();
						this.applyNodeGroups();
					}),
			);
		}

		// No "Criteria" heading/description any more (removed on feedback,
		// same flattening as above) - AND-across-everything still isn't
		// user-configurable (a per-group AND/OR choice, then nested AND/OR
		// blocks, were both "too complicated for a first implementation" -
		// see nodeGroups.ts's docstring), there's just nothing left to say
		// about that here once the list sits directly under the name.
		const criteriaEl = formEl.createDiv({ cls: 'clew-group-criteria' });
		this.renderCriteriaList(criteriaEl, this.groupCriteriaContext(group));

		// A single button opening a type-picker menu (same Menu-based pattern
		// the "Layout" toolbar button used before it became a dialog - see
		// openLayoutModal()) rather than a separate type
		// dropdown + "add" button next to it - user feedback: picking a
		// type, then having to also click a second control to actually add
		// it, was an extra step for what's really one action ("add a
		// criterion of this type").
		const addCriterionButton = formEl.createEl('button', { text: '+ add', cls: 'clew-filter-add-button' });
		addCriterionButton.addEventListener('click', (evt) => this.openAddCriterionMenu(evt, this.groupCriteriaContext(group)));
	}

	/** The "..." menu next to a group's name (renderGroupEditForm()) - currently just "Scale size", the one group-level option beyond name/color/criteria. Pulled out of the form's main flow (previously a permanent, always-visible toggle row) since it's rarely used and was competing with the name/criteria for attention - user feedback on flattening the panel's hierarchy. Positioned off `anchorEl`'s own bounding box rather than a MouseEvent so it works the same regardless of how it was triggered. */
	private openGroupOptionsMenu(anchorEl: HTMLElement, group: NodeGroup): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle('Scale size')
				.setChecked(group.sizeMultiplier !== null)
				.onClick(() => {
					group.sizeMultiplier = group.sizeMultiplier !== null ? null : 1;
					void this.plugin.saveSettings();
					this.applyNodeGroups();
					this.renderColorAndSizePanel();
				}),
		);
		const rect = anchorEl.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom });
	}

	/**
	 * Renders ctx.criteria as a row of compact chips (nodeGroups.ts's
	 * describeCriterion()), each expandable in place into its full
	 * type-specific controls - every criterion must match (AND), see
	 * nodeGroups.ts's docstring for why there's no OR/nesting here. User
	 * feedback: every criterion always showing its full controls read as
	 * cluttered once a list had more than one or two - a chip you click to
	 * edit keeps the common case (scanning what's already set) compact.
	 * Shared by Color & size's per-group criteria and Filter's own single
	 * list - see CriteriaEditorContext's docstring.
	 */
	private renderCriteriaList(container: HTMLElement, ctx: CriteriaEditorContext): void {
		container.empty();
		if (ctx.criteria.length === 0) return; // no placeholder text - user feedback
		const listEl = container.createDiv({ cls: 'clew-criteria-chips' });
		ctx.criteria.forEach((criterion, index) => {
			if (index === ctx.editingIndex) this.renderCriterionEditRow(listEl, ctx, index, criterion);
			else this.renderCriterionChip(listEl, ctx, index, criterion);
		});
	}

	/** A criterion collapsed to its plain-language summary (nodeGroups.ts's describeCriterion()) - click to expand its full controls in place (snapshotting it first so its own "Cancel" can revert - see CriteriaEditorContext's docstring), or the "x" to remove it directly without expanding first. */
	private renderCriterionChip(container: HTMLElement, ctx: CriteriaEditorContext, index: number, criterion: GroupCriterion): void {
		const chip = container.createDiv({ cls: 'clew-filter-pill clew-criterion-chip' });
		setTooltip(chip, 'Click to edit');
		chip.createSpan({ text: describeCriterion(criterion) });
		chip.addEventListener('click', () => {
			ctx.setEditingIndex(index);
			ctx.setSnapshot(structuredClone(criterion));
			ctx.rerenderPanel();
		});

		const removeButton = chip.createSpan({ cls: 'clew-filter-pill-remove' });
		setIcon(removeButton, 'x');
		setTooltip(removeButton, 'Remove');
		removeButton.addEventListener('click', (evt) => {
			evt.stopPropagation(); // otherwise also triggers the chip's own click-to-expand
			ctx.criteria.splice(index, 1);
			ctx.onChange();
			ctx.rerenderPanel();
		});
	}

	/**
	 * One criterion's full type-specific controls (see nodeGroups.ts's
	 * GroupCriterion union), shown in place of its chip while
	 * ctx.editingIndex points at it. "Done" persists and collapses back to
	 * a chip (every field already applied live/saved as it changed -
	 * "Done" here mirrors the group form's own "Done", a display toggle,
	 * not a commit). "Cancel" reverts to ctx.snapshot instead - see
	 * CriteriaEditorContext's docstring for why a brand new (never-had-a-
	 * snapshot) criterion gets removed instead of "reverted".
	 */
	private renderCriterionEditRow(container: HTMLElement, ctx: CriteriaEditorContext, index: number, criterion: GroupCriterion): void {
		const editEl = container.createDiv({ cls: 'clew-criterion-edit' });
		const applyLive = (): void => ctx.onChange();
		const rerender = (): void => {
			ctx.onChange();
			ctx.rerenderPanel();
		};
		const finishEditing = (): void => {
			ctx.setEditingIndex(null);
			ctx.setSnapshot(null);
			ctx.onChange();
			ctx.rerenderPanel();
		};

		const controlsEl = editEl.createDiv({ cls: 'clew-criterion-controls' });

		// The type as the first segment of the row (not its own heading
		// line above the fields any more - user feedback: a criterion being
		// edited taking 4 stacked lines, most of them just for "Property" or
		// "Text", read as heavier than the single-line summary it collapses
		// back to). Only "Activity" gets a tooltip explaining its mechanism -
		// every other type is self-evident from its own controls (a tag
		// picker, a folder path, ...), but "an inactive/active area of the
		// vault" (this criterion's dropdown, below) still begs the question
		// of what decides that without at least one sentence of explanation.
		const typeBadgeEl = controlsEl.createSpan({ cls: 'clew-criterion-type-badge', text: CRITERION_TYPE_LABELS[criterion.type] });
		if (criterion.type === 'clusterFreshness') {
			setTooltip(
				typeBadgeEl,
				'Notes are grouped into tightly-linked neighborhoods, then compared by how recently each neighborhood was edited overall.',
			);
		}

		switch (criterion.type) {
			case 'tag':
				controlsEl.createSpan({ cls: 'clew-criterion-label', text: 'Has' });
				this.renderNegateWord(controlsEl, criterion, { include: 'any of', exclude: 'none of' }, applyLive);
				this.renderTagPills(controlsEl, criterion.tags, applyLive);
				break;
			case 'property': {
				const keyDropdown = new DropdownComponent(controlsEl);
				for (const key of this.availableProperties) keyDropdown.addOption(key, key);
				if (criterion.key && !this.availableProperties.includes(criterion.key)) keyDropdown.addOption(criterion.key, criterion.key);
				keyDropdown.setValue(criterion.key).onChange((value) => {
					criterion.key = value;
					applyLive();
				});

				new DropdownComponent(controlsEl)
					.addOption('contains', 'Contains')
					.addOption('equals', 'Equals')
					.addOption('notEquals', 'Not equals')
					.addOption('isEmpty', 'Is empty')
					.addOption('isNotEmpty', 'Is not empty')
					.setValue(criterion.operator)
					.onChange((value) => {
						criterion.operator = value as StringOperator;
						rerender(); // the value field's visibility depends on the operator
					});

				if (criterion.operator !== 'isEmpty' && criterion.operator !== 'isNotEmpty') {
					new TextComponent(controlsEl).setPlaceholder('Value').setValue(criterion.value).onChange((value) => {
						criterion.value = value;
						applyLive();
					});
				}
				break;
			}
			case 'folder': {
				controlsEl.createSpan({ cls: 'clew-criterion-label', text: 'Folder' });
				this.renderNegateWord(controlsEl, criterion, { include: 'is', exclude: 'is not' }, applyLive);
				const input = new TextComponent(controlsEl).setPlaceholder('Includes subfolders').setValue(criterion.folder);
				input.inputEl.setAttribute('list', ctx.folderDatalistId);
				input.onChange((value) => {
					criterion.folder = value;
					applyLive();
				});
				break;
			}
			case 'filename':
				controlsEl.createSpan({ cls: 'clew-criterion-label', text: 'Filename' });
				this.renderNegateWord(controlsEl, criterion, { include: 'contains', exclude: 'does not contain' }, applyLive);
				new TextComponent(controlsEl).setValue(criterion.query).onChange((value) => {
					criterion.query = value;
					applyLive();
				});
				break;
			case 'text':
				controlsEl.createSpan({ cls: 'clew-criterion-label', text: 'Title or content' });
				this.renderNegateWord(controlsEl, criterion, { include: 'contains', exclude: 'does not contain' }, applyLive);
				new TextComponent(controlsEl).setValue(criterion.query).onChange((value) => {
					criterion.query = value;
					applyLive();
				});
				break;
			case 'clusterFreshness':
				// "Notes in [an inactive/active area of the vault]" - not
				// "in the most stagnant half of clusters" (an earlier
				// version) - user feedback: still not understandable, not
				// because a binary choice is inherently confusing (an even
				// earlier numeric/percentage version was already simplified
				// to this one for exactly that reason - see
				// StalenessBucket's docstring in nodeGroups.ts) but because
				// of "cluster"/"half" jargon with no obvious vault-editing
				// meaning. Same mechanism, described without naming it. No
				// negate word here (unlike the other 6 types below) - the
				// bucket dropdown already offers an equivalent choice, see
				// GroupCriterion's own negate docstring.
				controlsEl.createSpan({ cls: 'clew-criterion-label', text: 'Notes in' });
				new DropdownComponent(controlsEl)
					.addOption('stagnant', 'An inactive area of the vault')
					.addOption('fresh', 'An active area of the vault')
					.setValue(criterion.bucket)
					.onChange((value) => {
						criterion.bucket = value as StalenessBucket;
						applyLive();
					});
				break;
			case 'staleDays': {
				this.renderNegateWord(controlsEl, criterion, { include: 'At least', exclude: 'Less than' }, applyLive);
				const input = new TextComponent(controlsEl).setValue(String(criterion.days));
				input.inputEl.type = 'number';
				input.inputEl.min = '0';
				input.onChange((value) => {
					criterion.days = parsePositiveInt(value) ?? 0;
					applyLive();
				});
				controlsEl.createSpan({ cls: 'clew-criterion-label', text: 'days ago' });
				break;
			}
			case 'minLinks': {
				this.renderNegateWord(controlsEl, criterion, { include: 'At least', exclude: 'Fewer than' }, applyLive);
				const input = new TextComponent(controlsEl).setValue(String(criterion.count));
				input.inputEl.type = 'number';
				input.inputEl.min = '0';
				input.onChange((value) => {
					criterion.count = parsePositiveInt(value) ?? 0;
					applyLive();
				});
				controlsEl.createSpan({ cls: 'clew-criterion-label', text: 'links' });
				break;
			}
		}

		// Check/cancel now sit at the end of the same row as the fields
		// (previously forced onto their own line below - user feedback that
		// pushed a criterion's edit form to 4 stacked lines total). Still a
		// child of controlsEl, not a sibling, so `margin-left: auto` (see
		// styles.css) can pin it to the row's right edge and let it wrap
		// onto its own line only when the fields before it actually need
		// the space (e.g. a tag criterion's pills).
		const actionsEl = controlsEl.createDiv({ cls: 'clew-criterion-edit-actions' });
		new ExtraButtonComponent(actionsEl).setIcon('check').setTooltip('Done').onClick(finishEditing);
		new ExtraButtonComponent(actionsEl).setIcon('x').setTooltip('Cancel').onClick(() => {
			// A snapshot means this criterion existed before this edit
			// session started (opened by clicking its chip) - revert to it
			// rather than deleting, so "Cancel" actually means cancel, not
			// delete (user feedback). null means it was just created by
			// "+ add" this session, with nothing to revert to - removing it
			// is the only sensible "cancel" then, rather than leaving an
			// unconfigured chip behind.
			if (ctx.snapshot) ctx.criteria[index] = ctx.snapshot;
			else ctx.criteria.splice(index, 1);
			finishEditing();
		});
	}

	/**
	 * The clickable word that both shows and toggles a criterion's
	 * `negate` flag - see GroupCriterion's own `negate` docstring for why
	 * this replaced a standalone "Exclude" toggle: the label itself is the
	 * only control, no separate switch/checkbox/dropdown next to it.
	 * `labels.include`/`labels.exclude` are each type's own natural
	 * wording (e.g. "is"/"is not", "contains"/"does not contain") - see
	 * describeCriterion() in nodeGroups.ts for the matching chip text.
	 * Mutates its own text directly (not ctx.rerenderPanel()) so clicking
	 * it doesn't rebuild the whole edit row.
	 */
	private renderNegateWord(container: HTMLElement, criterion: GroupCriterion, labels: { include: string; exclude: string }, onChange: () => void): void {
		const wordEl = container.createSpan({ cls: 'clew-criterion-negate-word' });
		const render = (): void => {
			const negated = criterion.negate ?? false;
			wordEl.setText(negated ? labels.exclude : labels.include);
			wordEl.toggleClass('is-negated', negated);
		};
		render();
		setTooltip(wordEl, 'Click to include/exclude');
		wordEl.addEventListener('click', () => {
			criterion.negate = !(criterion.negate ?? false);
			render();
			onChange();
		});
	}

	/** Selected tags as removable pills + a compact "+ tag…" add-select - same pattern as Filter's renderFilterTagRows(), inlined here since a `tag` criterion's `tags` array is scoped to just this one row, not a whole panel section. */
	private renderTagPills(container: HTMLElement, tags: string[], onChange: () => void): void {
		const pillsEl = container.createDiv({ cls: 'clew-filter-pills clew-criterion-tag-pills' });
		const render = (): void => {
			pillsEl.empty();
			tags.forEach((tag, index) => {
				const pill = pillsEl.createDiv({ cls: 'clew-filter-pill' });
				pill.createSpan({ text: tag });
				const removeButton = pill.createSpan({ cls: 'clew-filter-pill-remove' });
				setIcon(removeButton, 'x');
				setTooltip(removeButton, 'Remove');
				removeButton.addEventListener('click', () => {
					tags.splice(index, 1);
					render();
					onChange();
				});
			});
			const remaining = this.availableTags.filter((tag) => !tags.includes(tag));
			if (remaining.length > 0) {
				const addSelect = pillsEl.createEl('select', { cls: 'dropdown clew-filter-add-select' });
				addSelect.createEl('option', { text: '+ tag…', value: '' });
				for (const tag of remaining) addSelect.createEl('option', { text: tag, value: tag });
				addSelect.value = '';
				addSelect.addEventListener('change', () => {
					if (!addSelect.value) return;
					tags.push(addSelect.value);
					render();
					onChange();
				});
			}
		};
		render();
	}

	/** Reveals the Color & size panel or just hides it - every group/criterion edit is already saved as it happens (see debouncedSaveNodeGroups's docstring), so closing mid-edit has nothing left to discard; it just collapses any open edit form for next time. */
	private toggleColorAndSizePanel(): void {
		if (this.colorAndSizePanelEl.isShown()) {
			this.colorAndSizePanelEl.hide();
			this.editingGroupId = null;
			this.editingCriterionIndex = null;
			this.criterionEditSnapshot = null;
			return;
		}
		this.closeOtherPanels('colorAndSize');
		this.renderColorAndSizePanel();
		this.colorAndSizePanelEl.show();
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
