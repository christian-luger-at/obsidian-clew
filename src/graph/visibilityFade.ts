/**
 * Backlog Rang 14 item 1: a shared, generic node/edge visibility fade -
 * given the *current* frame's desired-visible id set, tracks per-id
 * transition progress in both directions (appearing 0->1, disappearing
 * 1->0) instead of a reducer jumping straight to `hidden: true`/`false`.
 *
 * Shared by Filter (applyFilter()) and Focus (applyFocus()) in
 * graphPane.ts, which previously each flipped `hidden` instantly - three
 * different transition styles existed for the same kind of state change
 * (hover already fades smoothly, Timeline already grows in smoothly, only
 * these two cut hard), read as inconsistent switching between modes.
 * Timeline's own fade (timelineFadeProgress() in graphPane.ts) stays
 * separate rather than being generalized into this - it's fade-*in* only
 * by design (a scrubbed-past node vanishes instantly, matching a real
 * history event "happening"), a genuinely different shape than Filter/
 * Focus's need for a symmetric fade in *and* out.
 */

export interface FadeTracker {
	/** ms timestamp each id's visibility target last flipped, only present for ids currently or previously mid-transition. */
	changedAt: Map<string, number>;
	/** Each id's most recently seen visibility target, so update() can detect a flip without the caller tracking it separately. */
	lastVisible: Map<string, boolean>;
}

export function createFadeTracker(): FadeTracker {
	return { changedAt: new Map(), lastVisible: new Map() };
}

/**
 * Call once per genuine visibility-set change (not per reducer/render
 * frame) - records the moment any id's visibility target flips, so
 * fadeMultiplier() can compute an in-progress transition instead of
 * jumping straight to 0 or 1. `ids` should cover every id that could ever
 * be visible (typically every node/edge currently in the graph), not just
 * the ones changing this time, so an id fading out is still tracked once
 * it eventually reaches 0 and stops needing updates.
 */
export function updateFadeTracker(tracker: FadeTracker, ids: Iterable<string>, isVisible: (id: string) => boolean, now: number): void {
	for (const id of ids) {
		const visible = isVisible(id);
		if (tracker.lastVisible.get(id) !== visible) {
			tracker.changedAt.set(id, now);
			tracker.lastVisible.set(id, visible);
		}
	}
}

/**
 * 0 (fully hidden) to 1 (fully shown) - linear ease over `durationMs` from
 * whenever this id's visibility last flipped, or the resting value (0 or
 * 1) once that's finished / if it never flipped at all (present from the
 * very first frame, or has stayed hidden the whole time).
 */
export function fadeMultiplier(tracker: FadeTracker, id: string, isVisible: boolean, durationMs: number, now: number): number {
	const changedAt = tracker.changedAt.get(id);
	if (changedAt === undefined) return isVisible ? 1 : 0;
	const elapsed = now - changedAt;
	if (elapsed >= durationMs) return isVisible ? 1 : 0;
	const progress = elapsed / durationMs;
	return isVisible ? progress : 1 - progress;
}

/** Whether any tracked id is still mid-fade (elapsed < durationMs since its last flip) - drives whether a ticker needs to keep forcing refreshes, same self-stopping reasoning as graphPane.ts's own timeline fade ticker. */
export function hasPendingFades(tracker: FadeTracker, durationMs: number, now: number): boolean {
	for (const changedAt of tracker.changedAt.values()) {
		if (now - changedAt < durationMs) return true;
	}
	return false;
}
