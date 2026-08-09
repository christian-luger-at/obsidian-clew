/**
 * 'force' is the only mode with live physics (ForceAtlas2) and the only one
 * dragging (GraphPane.setupNodeDragging) or pinning (finishDrag) works
 * against - the other three lay the whole graph out fresh from a pure
 * function each time, with no per-node "leave this one alone" concept.
 */
export type LayoutMode = 'force' | 'hierarchical' | 'radial' | 'circular';

export const LAYOUT_MODE_LABELS: Record<LayoutMode, string> = {
	force: 'Force',
	hierarchical: 'Hierarchical',
	radial: 'Radial',
	circular: 'Circular',
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
		description:
			'The default. Physics pulls linked notes toward each other, so related notes settle into organic clusters - the best general-purpose overview of how the whole vault connects.',
	},
	{
		mode: 'hierarchical',
		description:
			'Arranges notes top-down by link direction, like a tree or outline. Best when the vault has a real hierarchy - MOCs, outlines, structured notes - that a physics-based clustering would otherwise obscure.',
	},
	{
		mode: 'radial',
		description:
			'Rings every note out from one you pick, by link distance - its direct links on the first ring, their links on the next, and so on. Best for "how does the rest of the vault relate to this one note?".',
	},
	{
		mode: 'circular',
		description:
			"Places every note evenly around a single circle. The simplest arrangement for spotting recurring connection patterns as arcs across the circle - patterns force layout's clustering can hide.",
	},
];
