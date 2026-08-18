import Graph from 'graphology';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Default pixel width of one day along the X axis - user-tunable (Settings
 * tab, see settings.ts's ClewAppearanceSettings.timelineDayWidth). Unlike
 * circularLayout.ts's radius or radialLayout.ts's ring spacing (both purely
 * ordinal - "one ring/step further out"), this one directly controls how
 * much horizontal space a real gap in vault history takes up, so it's the
 * one layout constant here that actually changes what the layout *means*,
 * not just how spread out it looks.
 */
const DEFAULT_DAY_WIDTH = 8;

/** Default vertical spacing between notes sharing the same day - user-tunable (ClewAppearanceSettings.timelineRowSpacing). */
const DEFAULT_ROW_SPACING = 60;

/**
 * Backlog Rang 13 (research) / Rang 1 (build): a fifth layout, X axis = note
 * age. Answers "how has this vault grown over time, and where are the
 * quiet/busy stretches?" - a question none of the other four layouts
 * (force's organic clustering, hierarchical's link-direction flow, radial's
 * distance-from-one-note, circular's single ring) are built to show, and
 * the one thing the existing Timeline scrubber (timeline.ts) can only
 * *play through*, not show all at once as a static shape.
 *
 * ctime only, same "deliberate, acknowledged simplification" as
 * timeline.ts's own playback (see its docstring) - no per-edge history,
 * just each note's own creation time. `ctimeByNode` is threaded in from
 * GraphPane's own `ctimeByPath` (populated in setFiles()) rather than read
 * from graph node attributes, matching timeline.ts's functions - ctime
 * isn't stored on the graph itself, only kept alongside it.
 *
 * X is real elapsed time (`dayWidth` pixels per day since the vault's
 * earliest note), not rank/order the way circularLayout.ts's ring position
 * or radialLayout.ts's ring distance are - the whole point of a timeline
 * layout is showing actual gaps and bursts in vault history, which a
 * rank-based placement (every occupied day equally spaced, like circular's
 * BFS order) would flatten away entirely.
 *
 * Notes are bucketed to whole calendar days (relative to the vault's
 * earliest note, not the calendar) rather than placed at their exact ctime
 * pixel - keeps notes created within the same working session vertically
 * stacked in one readable column instead of smeared across near-identical
 * x positions a fraction of a pixel apart.
 *
 * Nodes with no ctime entry (ghost/tag/attachment nodes - see
 * vaultGraph.ts, none of which carry a real file's creation time) get one
 * additional column past the last dated day, same "don't discard, just
 * visually set apart" approach as radialLayout.ts's overflow ring for
 * nodes unreachable from the focus note.
 */
export function computeTimelineLayout(
	graph: Graph,
	ctimeByNode: Map<string, number>,
	dayWidth: number = DEFAULT_DAY_WIDTH,
	rowSpacing: number = DEFAULT_ROW_SPACING,
): void {
	const datedNodes: string[] = [];
	const undatedNodes: string[] = [];
	graph.forEachNode((node) => {
		if (ctimeByNode.has(node)) datedNodes.push(node);
		else undatedNodes.push(node);
	});

	if (datedNodes.length === 0) {
		// Nothing to anchor a timeline to (e.g. a graph made entirely of
		// ghost/tag nodes) - still lay everything out deterministically
		// rather than leaving positions untouched.
		placeColumn(graph, sorted(undatedNodes), 0, rowSpacing);
		return;
	}

	let minCtime = Infinity;
	for (const node of datedNodes) minCtime = Math.min(minCtime, ctimeByNode.get(node)!);

	const nodesByDayIndex = new Map<number, string[]>();
	let maxDayIndex = 0;
	for (const node of datedNodes) {
		const dayIndex = Math.floor((ctimeByNode.get(node)! - minCtime) / MS_PER_DAY);
		maxDayIndex = Math.max(maxDayIndex, dayIndex);
		const bucket = nodesByDayIndex.get(dayIndex);
		if (bucket) bucket.push(node);
		else nodesByDayIndex.set(dayIndex, [node]);
	}

	for (const [dayIndex, nodes] of nodesByDayIndex) {
		placeColumn(graph, sorted(nodes), dayIndex * dayWidth, rowSpacing);
	}

	if (undatedNodes.length > 0) {
		placeColumn(graph, sorted(undatedNodes), (maxDayIndex + 2) * dayWidth, rowSpacing);
	}
}

/** Deterministic order within a column (same reasoning as radialLayout.ts's per-ring sort: the same graph should always produce the same arrangement, not depend on iteration order). */
function sorted(nodes: string[]): string[] {
	return [...nodes].sort();
}

/** Places one vertical column of notes, centered on y = 0. */
function placeColumn(graph: Graph, nodes: string[], x: number, rowSpacing: number): void {
	const offset = ((nodes.length - 1) * rowSpacing) / 2;
	nodes.forEach((node, i) => {
		graph.setNodeAttribute(node, 'x', x);
		graph.setNodeAttribute(node, 'y', i * rowSpacing - offset);
	});
}
