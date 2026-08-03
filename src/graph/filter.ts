/**
 * Doc section 3.1/3.3 follow-up: several independently named, enabled/
 * disabled, creatable/editable/deletable filters - user feedback: "es
 * fehlt die gesamte Logik für erstellen/editieren/löschen von Filtern (wie
 * in Color & Size)" - Filter should manage a list of saved filters the
 * same way Color & size manages a list of node groups, not just one flat
 * unnamed criteria list.
 *
 * Reuses nodeGroups.ts's GroupCriterion/NodeGroupFacts/matchesGroup/
 * needsContentSearch/needsClusterFreshness wholesale rather than a
 * parallel criterion system - each FilterPreset's own criteria list works
 * exactly like a NodeGroup's (same criterion types, same AND-across-
 * criteria rule, same chip/edit-row UI in graphPane.ts), just hiding
 * non-matches instead of coloring matches, and with no color/size of its
 * own.
 *
 * Unlike node groups (first enabled match wins, since a note can only be
 * one color), several enabled filters combine with OR: a note is shown if
 * it matches *any* enabled filter (each filter's own criteria still AND
 * together) - user feedback, choosing OR over "only one filter active at a
 * time" or "AND across filters" so several saved filters behave like a
 * small library of alternative searches rather than a mutually-exclusive
 * picker or an ever-narrowing combination. Order therefore has no effect
 * on the result (unlike node groups' precedence-by-order) - filter presets
 * aren't reorderable.
 */

import { CriteriaOwner, matchesGroup, NodeGroupFacts } from './nodeGroups';

export const MAX_FILTER_PRESETS = 10;

export interface FilterPreset extends CriteriaOwner {
	id: string;
	name: string;
}

export type NoteFilterFacts = NodeGroupFacts;

/** Whether no filter is enabled - the caller's cue to fall back to "nothing active" (show everything) instead of evaluating an empty OR (which would otherwise mean "show nothing", the opposite of "no filter"). */
export function isAnyFilterEnabled(presets: FilterPreset[]): boolean {
	return presets.some((p) => p.enabled);
}

/** Every node id matching at least one enabled filter (OR - see this module's docstring). Only call once isAnyFilterEnabled() is true - with none enabled this returns an empty set, which callers must NOT treat as "hide everything" (see that function's docstring). */
export function evaluateFilters(factsByNode: Map<string, NoteFilterFacts>, presets: FilterPreset[]): Set<string> {
	const enabled = presets.filter((p) => p.enabled);
	const matches = new Set<string>();
	for (const [node, facts] of factsByNode) {
		if (enabled.some((preset) => matchesGroup(facts, preset))) matches.add(node);
	}
	return matches;
}
