import { FilterQuery } from './graph/filter';
import { NodeGroup } from './graph/nodeGroups';

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
	/** ForceAtlas2's scalingRatio setting - overall repulsion/attraction force scale. */
	scalingRatio: number;
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
	 * The Filter panel's current criteria - user feedback: closing the
	 * panel (or the graph view, or Obsidian itself) shouldn't lose it, the
	 * same reasoning pinnedPositions above already follows. GraphPane's
	 * filter icon shows `is-active` whenever this isn't
	 * isEmptyQuery()-empty, independent of whether the panel itself is
	 * currently open.
	 */
	filterQuery: FilterQuery;
	/**
	 * User-defined "Color & size" node groups (see graph/nodeGroups.ts) -
	 * saved state, same reasoning as filterQuery/pinnedPositions above: a
	 * group someone spent time defining shouldn't vanish on panel close or
	 * plugin reload. Empty array = no groups defined yet, not "feature off" -
	 * GraphPane.colorAndSizeButton's `is-active` tracks whether any group is
	 * *enabled*, independent of the panel being open.
	 */
	nodeGroups: NodeGroup[];
}
