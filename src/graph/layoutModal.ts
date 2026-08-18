/**
 * 'force' is the only mode with live physics (ForceAtlas2) and the only one
 * dragging (GraphPane.setupNodeDragging) or pinning (finishDrag) works
 * against - the other three lay the whole graph out fresh from a pure
 * function each time, with no per-node "leave this one alone" concept.
 */
export type LayoutMode = 'force' | 'hierarchical' | 'radial' | 'circular' | 'timeline' | 'cluster';

export const LAYOUT_MODE_LABELS: Record<LayoutMode, string> = {
	force: 'Force',
	hierarchical: 'Hierarchical',
	radial: 'Radial',
	circular: 'Circular',
	timeline: 'Timeline',
	cluster: 'Cluster',
};

export interface LayoutOption {
	mode: LayoutMode;
	description: string;
}

/**
 * What each layout is actually *for*, in plain language - see the layout
 * modules' own docstrings (hierarchicalLayout.ts, radialLayout.ts,
 * circularLayout.ts) for the underlying algorithm each of these summarizes.
 * Rendered by GraphPane's Layout panel (renderLayoutPanel()) - this used to
 * back a dedicated LayoutModal, folded into the panel system alongside
 * every other dialog (Dialog-Management redesign, round 2: user feedback
 * "'Find path' und 'Layout' sind immer noch Dialoge, die anders aussehen" -
 * native Obsidian Modals read as visually distinct from the
 * `.clew-filter-panel` box treatment everything else already used).
 */
export const LAYOUT_OPTIONS: LayoutOption[] = [
	{
		mode: 'force',
		// Shortened on user feedback ("Texte kürzen bei Dialog-Beschreibung
		// für Layouts") - the pre-shortening wording is preserved in this
		// file's git history if the fuller framing is ever needed again.
		description: 'Physics clusters linked notes together - the default, best general-purpose overview.',
	},
	{
		mode: 'hierarchical',
		description: 'Top-down by link direction, like an outline. Best for a vault with a real hierarchy.',
	},
	{
		mode: 'radial',
		description: 'Rings out from one note you pick, by link distance. Best for "how does everything relate to this note?".',
	},
	{
		mode: 'circular',
		description: 'Every note evenly spaced on one circle. Good for spotting recurring connection patterns.',
	},
	{
		mode: 'timeline',
		description: "Left to right by creation date, real gaps and all. Best for spotting quiet stretches and bursts in your vault's history.",
	},
	{
		mode: 'cluster',
		description: 'Pulls each detected community into its own separate region. Best for seeing where one community ends and another begins.',
	},
];
