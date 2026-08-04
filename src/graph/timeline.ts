import Graph from 'graphology';

/**
 * ctime-based time-lapse timeline (chat decision, 2026-08-04): notes appear
 * in creation order; an edge appears the moment both its endpoints exist,
 * since Obsidian records no history of *when* a link was actually added -
 * only each file's own ctime/mtime. This is a deliberate, acknowledged
 * approximation, the same one Obsidian's own core Graph View "Animate"
 * feature makes (nodes ordered by ctime only, no per-edge history) - see
 * GitHub issue #6's docstring for why a *precise* version of this needs a
 * background snapshot index instead, which doesn't exist yet.
 *
 * Kept Obsidian/DOM-free (same reasoning as filter.ts/nodeGroups.ts) so the
 * ordering/visibility math is unit-testable without a real vault; GraphPane
 * is the only caller that touches actual TFile.stat.ctime values.
 */

export interface TimelineBounds {
	/** Earliest node's ctime (ms epoch). */
	start: number;
	/** Latest node's ctime (ms epoch) - "today" for an actively edited vault. */
	end: number;
}

/** `null` with no nodes at all - nothing to animate. `start === end` (a single-day-old vault, or literally one note) is valid and means the playback range is a single instant. */
export function computeTimelineBounds(ctimeByNode: Map<string, number>): TimelineBounds | null {
	if (ctimeByNode.size === 0) return null;
	let start = Infinity;
	let end = -Infinity;
	for (const ctime of ctimeByNode.values()) {
		if (ctime < start) start = ctime;
		if (ctime > end) end = ctime;
	}
	return { start, end };
}

/** Every node whose ctime has "happened" by `cursor`. */
export function visibleNodesAt(ctimeByNode: Map<string, number>, cursor: number): Set<string> {
	const result = new Set<string>();
	for (const [node, ctime] of ctimeByNode) {
		if (ctime <= cursor) result.add(node);
	}
	return result;
}

/**
 * An edge is "born" the moment its later endpoint appears - the earliest
 * point at which both notes (and therefore a possible link between them)
 * could exist, not when the link itself was actually added (unknowable -
 * see this module's docstring). A node missing from `ctimeByNode` (stale
 * graph vs. a since-changed file set) is treated as not-yet-born, so its
 * edges simply never show rather than throwing.
 */
export function visibleEdgesAt(graph: Graph, ctimeByNode: Map<string, number>, cursor: number): Set<string> {
	const result = new Set<string>();
	graph.forEachEdge((edge, _attr, source, target) => {
		const sourceCtime = ctimeByNode.get(source) ?? Infinity;
		const targetCtime = ctimeByNode.get(target) ?? Infinity;
		if (Math.max(sourceCtime, targetCtime) <= cursor) result.add(edge);
	});
	return result;
}

/**
 * Every distinct creation moment present, ascending - several notes
 * sharing the exact same ctime collapse into one shared step (they really
 * did appear together, see visibleNodesAt()) rather than each getting its
 * own pacing slot in playback.
 *
 * Playback below paces evenly across these steps, in real playback time,
 * rather than by raw calendar distance between them - most active vaults
 * have a handful of old notes and a dense cluster of recent ones (or, as
 * discovered testing against `test-vault`: many notes literally share one
 * ctime, e.g. everything a `gen-test-vault.mjs` run itself just created).
 * Pacing by calendar day would spend nearly the *entire* playback slowly
 * crawling through the sparse old tail, then reveal that whole dense
 * cluster in a single instant at the very end - reads as "Play does
 * nothing" for most of a session. Pacing by step index instead guarantees
 * playback visibly progresses throughout, and lets a total *duration* -
 * not an abstract calendar-days/second rate that depends entirely on how
 * spread out the vault's own dates happen to be - be the one user-facing
 * speed knob (see TIMELINE_DURATIONS).
 */
export function computeTimelineSteps(ctimeByNode: Map<string, number>): number[] {
	return [...new Set(ctimeByNode.values())].sort((a, b) => a - b);
}

/** Index of the last step at or before `cursor` - `-1` if `cursor` is before every step (nothing born yet). `steps` must be ascending (computeTimelineSteps()'s own output). */
export function stepIndexAtOrBefore(steps: number[], cursor: number): number {
	let index = -1;
	for (const step of steps) {
		if (step <= cursor) index = index + 1;
		else break;
	}
	return index;
}

/** Total playback durations offered in the UI, in seconds - a fixed wall-clock length regardless of vault size/date spread (see computeTimelineSteps()'s docstring for why), so the label can just say how long the whole replay takes. */
export const TIMELINE_DURATIONS = [10, 30, 60, 180] as const;
export type TimelineDuration = (typeof TIMELINE_DURATIONS)[number];
export const DEFAULT_TIMELINE_DURATION: TimelineDuration = 30;

/**
 * The cursor value for a playback that started at `elapsedS` seconds ago
 * and is meant to finish in `totalDurationS` - one step per equal slice of
 * `totalDurationS`, not per calendar day (see computeTimelineSteps()'s
 * docstring). Pure/stateless: takes total elapsed time since playback
 * *started*, not since the last tick, so the caller never accumulates
 * drift across repeated calls.
 */
export function cursorForElapsed(steps: number[], elapsedS: number, totalDurationS: number): number {
	if (steps.length === 0) return 0;
	const fraction = totalDurationS <= 0 ? 1 : elapsedS / totalDurationS;
	const index = Math.min(steps.length - 1, Math.max(0, Math.floor(fraction * steps.length)));
	return steps[index]!;
}

/**
 * `'steps'` (the default): playback paces evenly across distinct creation
 * moments (see computeTimelineSteps()'s docstring) - always visibly
 * progressing, at the cost of the date shown sometimes jumping by a lot
 * between two ticks with nothing in between (a sparse stretch crossed in
 * one step). `'calendar'`: playback instead maps linearly onto the vault's
 * real date span, so the date always advances smoothly and proportionally
 * to real elapsed history - at the cost of nearly the whole playback
 * being spent on a sparse period if the vault has one, then revealing a
 * dense cluster in a near-instant burst (user feedback: the jump-y date
 * in 'steps' mode "kann sehr verwirrend sein" for some vaults, so this is
 * a choice the Timeline panel exposes, not a fixed tradeoff either way).
 */
export type TimelinePaceMode = 'steps' | 'calendar';
/** User feedback: real calendar time is the more intuitive default, even though it can sit still for a long stretch on a vault with a sparse period (see this type's own docstring) - 'steps' is the opt-in for someone who'd rather playback always visibly progress. */
export const DEFAULT_TIMELINE_PACE_MODE: TimelinePaceMode = 'calendar';

/** `cursorForElapsed()`'s 'calendar' counterpart - linear interpolation across `bounds` instead of stepping through `computeTimelineSteps()`'s output. */
export function cursorForElapsedByCalendar(bounds: TimelineBounds, elapsedS: number, totalDurationS: number): number {
	const fraction = totalDurationS <= 0 ? 1 : Math.min(1, elapsedS / totalDurationS);
	return bounds.start + fraction * (bounds.end - bounds.start);
}
