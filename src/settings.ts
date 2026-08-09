import { FilterCombineMode, FilterPreset } from './graph/filter';
import { NodeGroup } from './graph/nodeGroups';
import { DEFAULT_TIMELINE_DURATION, DEFAULT_TIMELINE_PACE_MODE, TimelineDuration, TimelinePaceMode } from './graph/timeline';

export interface PinnedPosition {
	x: number;
	y: number;
}

/**
 * Every number here was previously a hardcoded constant scattered across
 * vaultGraph.ts/layoutRunner.ts/renderer.ts/radialLayout.ts/circularLayout.ts/
 * hierarchicalLayout.ts - user feedback comparing Clew's graph against
 * Obsidian's own core Graph View led to three rounds of manually re-tuning
 * node size alone in one session, which is exactly the friction a UI
 * setting removes. Grouped by what part of the rendering they affect, not
 * by which file they happen to live in.
 *
 * The controls for these live in the graph view itself (GraphPane's
 * "Appearance…" panel), not this plugin Settings tab - the user tunes them
 * while watching the graph react, which the Settings tab (a separate
 * screen, no live graph visible) can't offer. This interface and its
 * defaults still live here since ClewSettings is the persisted shape
 * (loadData()/saveData()) regardless of which UI edits it.
 */
export interface ClewAppearanceSettings {
	/** Plain-note node size at degree 0 (vaultGraph.ts's sizeNodesByDegree). */
	nodeBaseSize: number;
	/** Cover-image node size at degree 0 - kept separately tunable since NodeImageProgram needs a minimum footprint to stay recognizable. */
	nodeImageBaseSize: number;
	/** Multiplier on log(1 + degree) - how much bigger a hub node gets than a leaf. */
	nodeDegreeGrowth: number;
	/** ForceAtlas2's gravity setting (layoutRunner.ts) - pull toward the center. */
	gravity: number;
	/**
	 * ForceAtlas2's scalingRatio setting - not an independent "repulsion"
	 * force despite the UI label (Chat decision, 2026-08-09: "Stimmen die
	 * aktuell implementierten Wertegrenzen?" - ForceAtlas2 has no separate
	 * per-edge attraction dial; every edge pulls with the same fixed
	 * strength, see vaultGraph.ts's own docstring on deliberately not
	 * setting an edge `weight` attribute). This scales repulsion *relative
	 * to* that fixed attraction, so raising it reads as "more repulsion"
	 * even though it's really "repulsion winning more of the tug-of-war."
	 */
	scalingRatio: number;
	/**
	 * ForceAtlas2's outboundAttractionDistribution setting ("Dissuade
	 * Hubs" in Gephi) - redistributes a hub note's outbound attraction
	 * across its neighbors by degree, instead of every neighbor pulling
	 * with the same fixed strength regardless of how many other notes the
	 * hub also links to. Makes a hub's neighbors spread out around it
	 * instead of clumping directly on top of it. Off by default (matches
	 * ForceAtlas2's own default) - a hub-heavy vault is exactly the case
	 * this helps with, but it's a real change to how notes settle, not a
	 * universally-better default.
	 */
	dissuadeHubs: boolean;
	/**
	 * ForceAtlas2's linLogMode setting - attraction grows with log(distance)
	 * instead of linearly with it, which pulls tightly-linked notes into
	 * noticeably denser, more separated clusters (Gephi's own docs describe
	 * this as better for "community"-shaped graphs). Off by default (matches
	 * ForceAtlas2's own default and the graph's existing look) - a bigger
	 * visual change than a plain slider nudge, opt-in rather than a new
	 * baseline everyone's used to seeing switches under them.
	 */
	linLogMode: boolean;
	/** sigma's labelRenderedSizeThreshold (renderer.ts) - on-screen node size a label must cross to render. */
	labelSizeThreshold: number;
	/** sigma's labelDensity (renderer.ts) - how many labels are allowed to render per area at a given zoom. */
	labelDensity: number;
	/** Distance between successive rings in the radial layout (radialLayout.ts). */
	radialRingSpacing: number;
	/** Ring radius in the circular layout (circularLayout.ts). */
	circularRadius: number;
	/** dagre's nodesep (hierarchicalLayout.ts) - spacing between nodes on the same rank. */
	hierarchicalNodeSpacing: number;
	/** dagre's ranksep (hierarchicalLayout.ts) - spacing between ranks. */
	hierarchicalRankSpacing: number;
	/**
	 * null = auto (the current theme's --graph-line, with an automatic
	 * contrast-safety fallback if that's too hard to see against the
	 * background - see theme.ts's ensureContrast()); otherwise a
	 * user-picked hex color that overrides both, for the rare theme where
	 * even the corrected color still doesn't look right to a given user.
	 * Also used (instead of the theme's accent color) for the highlighted
	 * edges to a hovered node's neighbors, so a chosen edge color doesn't
	 * get silently overridden the moment you hover - see GraphPane's
	 * setupNodeHover().
	 */
	edgeColorOverride: string | null;
	/**
	 * How much of the *resolved* edge color (edgeColorOverride if set,
	 * otherwise the theme's) survives GraphPane's resolvedEdgeColor()
	 * blend toward the background - 1 = unblended, 0 = fully the
	 * background (a deliberate, user-dialed choice, not clamped to any
	 * minimum-contrast floor the way the raw theme color is via
	 * ensureContrast()). User feedback: 0.6 (the original hardcoded
	 * default) still read as too prominent, 0.45 better but asked to be
	 * user-tunable rather than another guessed constant. Applied uniformly
	 * to whichever color is active - an earlier version baked this into
	 * theme.ts's defaultEdgeColor computation directly, which meant it
	 * silently stopped doing anything the moment edgeColorOverride was
	 * set (reported: "edge intensity doesn't work anymore once you set a
	 * color").
	 */
	edgeIntensity: number;
	/**
	 * null = auto (the current theme's --graph-node); otherwise a
	 * user-picked hex color that overrides the default (non-cover-image)
	 * note color - same logic as edgeColorOverride, including that it's
	 * also used (instead of the theme's accent color) for the hovered node
	 * itself. Doesn't affect cover-image nodes (theme.ts's imageNodeColor,
	 * a deliberately distinct accent) or a note colored by a node group
	 * (graph/nodeGroups.ts) - a group's own color always wins, same as
	 * edgeColorOverride never affecting search/path edge coloring.
	 */
	nodeColorOverride: string | null;
	/**
	 * Whether edges show an arrowhead pointing from the linking note to the
	 * note it links to - off by default, since a fully-arrowed vault-scale
	 * graph is a lot more visual noise than most people want by default,
	 * and most vaults have plenty of mutual/circular links anyway. A
	 * mutual link (both notes link to each other - vaultGraph.ts's
	 * `mutual` edge attribute) gets a double-headed arrow instead of an
	 * arbitrary single direction.
	 */
	showEdgeDirection: boolean;
	/** Scales sigma's own default arrowhead length/wideness (both, together - see renderer.ts's createArrowEdgePrograms()) - 1 = sigma's own default size. Only visible while showEdgeDirection is on. */
	edgeArrowSize: number;
}

export const DEFAULT_APPEARANCE_SETTINGS: ClewAppearanceSettings = {
	nodeBaseSize: 2.5,
	nodeImageBaseSize: 4.5,
	nodeDegreeGrowth: 0.6,
	gravity: 0.3,
	scalingRatio: 10,
	dissuadeHubs: false,
	linLogMode: false,
	labelSizeThreshold: 9,
	labelDensity: 0.5,
	radialRingSpacing: 120,
	circularRadius: 400,
	hierarchicalNodeSpacing: 40,
	hierarchicalRankSpacing: 80,
	edgeColorOverride: null,
	edgeIntensity: 0.45,
	nodeColorOverride: null,
	showEdgeDirection: false,
	edgeArrowSize: 1,
};

/**
 * Which of the Diagnostics panel's four sections (graphPane.ts's
 * renderDiagnosticsPanel()) are shown - user feedback: broken links aren't
 * always a real problem (many people deliberately link to notes that don't
 * exist yet, a common "stub first, write later" workflow), so someone who
 * doesn't want that noise should be able to turn just that section off,
 * without losing Orphans/Isolated clusters/Structural deviation too. Lives
 * in Obsidian's own Settings tab (settingsTab.ts), not the graph view's own
 * panels - unlike ClewAppearanceSettings above, this isn't something you'd
 * tune while watching the graph react; it's a one-time "what do I even want
 * to see" choice.
 */
export interface ClewDiagnosticsSettings {
	showOrphans: boolean;
	showBrokenLinks: boolean;
	showIsolatedClusters: boolean;
	/** GitHub issue #5 - Louvain communities whose notes are scattered across several folders despite linking each other heavily. */
	showStructuralDeviation: boolean;
}

export const DEFAULT_DIAGNOSTICS_SETTINGS: ClewDiagnosticsSettings = {
	showOrphans: true,
	showBrokenLinks: true,
	showIsolatedClusters: true,
	showStructuralDeviation: true,
};

export interface ClewSettings {
	/**
	 * Manually dragged node positions, keyed by note path - GitHub issue
	 * #12. Not stored in the note's frontmatter (that would be file-content
	 * editing, a much bigger/riskier feature category per the product-vision
	 * doc's "Editability" backlog) - a position is presentation state, not
	 * note content, so it lives in the plugin's own data (this file, backed
	 * by Obsidian's loadData()/saveData()) instead.
	 */
	pinnedPositions: Record<string, PinnedPosition>;
	appearance: ClewAppearanceSettings;
	/**
	 * User-defined filters (see graph/filter.ts) - saved state, same
	 * reasoning as nodeGroups below: a filter someone spent time defining
	 * shouldn't vanish on panel close or plugin reload. Empty array = no
	 * filters defined yet, not "feature off" - GraphPane.filterButton's
	 * `is-active` tracks whether any filter is *enabled* (see filter.ts's
	 * isAnyFilterEnabled()), independent of the panel being open.
	 */
	filterPresets: FilterPreset[];
	/**
	 * How several *enabled* filters combine - "any" (OR, the default) or
	 * "all" (AND) - see filter.ts's docstring for the full reasoning. A
	 * single global choice, not per-filter (user feedback: "Das ist auf der
	 * falschen Ebene [...] soll für die Kombination von ganzen Filtern
	 * gelten" - an earlier version put an AND/OR choice on each filter's
	 * own criteria instead, one level too low).
	 */
	filterCombineMode: FilterCombineMode;
	/**
	 * User-defined "Color & size" node groups (see graph/nodeGroups.ts) -
	 * saved state, same reasoning as filterQuery/pinnedPositions above: a
	 * group someone spent time defining shouldn't vanish on panel close or
	 * plugin reload. Empty array = no groups defined yet, not "feature off" -
	 * GraphPane.colorAndSizeButton's `is-active` tracks whether any group is
	 * *enabled*, independent of the panel being open.
	 */
	nodeGroups: NodeGroup[];
	/**
	 * The Timeline panel's own duration/pace-mode picks (see
	 * graph/timeline.ts) - user feedback: these should persist across
	 * restarts like every other panel's saved state (filterPresets,
	 * nodeGroups, ...), not reset to their defaults every time the graph
	 * view reopens. The scrubber's own position isn't included - that's
	 * always session state (see GraphPane.toggleTimelinePanel()'s
	 * docstring: opening the panel always starts at the beginning).
	 */
	timeline: ClewTimelineSettings;
	/** See ClewDiagnosticsSettings's own docstring. */
	diagnostics: ClewDiagnosticsSettings;
	/**
	 * Whether the two ready-made filters (filter.ts's
	 * DEFAULT_FILTER_PRESETS - "Show existing notes"/"Show non-existing
	 * notes") are present in `filterPresets` at all - Obsidian's own
	 * Settings tab (settingsTab.ts), not the graph view's own panels, same
	 * reasoning as `diagnostics` above (a one-time "what do I even want
	 * available" choice). main.ts's syncDefaultPresets() adds/removes them
	 * by their fixed `id`s whenever this changes, rather than this flag
	 * being checked live everywhere a filter list is read - so a user's own
	 * customization of one (renamed, recolored, more criteria added)
	 * survives as long as this stays on; toggling off removes it, toggling
	 * back on re-seeds a fresh copy.
	 */
	showDefaultFilters: boolean;
	/** Same mechanism as showDefaultFilters, for nodeGroups.ts's DEFAULT_NODE_GROUPS ("Non-existing notes", orange) instead. */
	showDefaultColorGroups: boolean;
}

export interface ClewTimelineSettings {
	totalDuration: TimelineDuration;
	paceMode: TimelinePaceMode;
}

export const DEFAULT_TIMELINE_SETTINGS: ClewTimelineSettings = {
	totalDuration: DEFAULT_TIMELINE_DURATION,
	paceMode: DEFAULT_TIMELINE_PACE_MODE,
};
