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
 * How several *enabled filters* combine - not each filter's own criteria,
 * see above - is the user-configurable part (`FilterCombineMode`, see
 * settings.ts's ClewSettings.filterCombineMode): "any enabled filter
 * matches" (OR, the original/default behavior - several saved filters
 * behave like a small library of alternative searches) or "every enabled
 * filter matches" (AND - narrows down across them, e.g. "tagged #project"
 * AND "not edited in 30 days" as two separate, independently reusable
 * filters instead of duplicating both criteria into one). User feedback:
 * an earlier version put this AND/OR choice one level down, on each
 * filter's own criteria - "Das ist auf der falschen Ebene [...] soll für
 * die Kombination von ganzen Filtern gelten" - within one filter, criteria
 * always AND (same as a node group's own criteria, see NodeGroup's own
 * docstring for that precedent). Order has no effect on the result either
 * way (AND and OR are both commutative) - filter presets aren't
 * reorderable for match-precedence reasons (the drag-to-reorder they do
 * have is purely a user-organization convenience, see graphPane.ts's
 * draggedFilterIndex docstring).
 */

import { CriteriaOwner, matchesGroup, NodeGroupFacts } from './nodeGroups';

export const MAX_FILTER_PRESETS = 10;

/** How several enabled filters combine - see this module's docstring. */
export type FilterCombineMode = 'and' | 'or';

export interface FilterPreset extends CriteriaOwner {
	id: string;
	name: string;
}

export type NoteFilterFacts = NodeGroupFacts;

/** Whether no filter is enabled - the caller's cue to fall back to "nothing active" (show everything) instead of evaluating an empty OR/AND (which would otherwise mean "show nothing" either way, the opposite of "no filter"). */
export function isAnyFilterEnabled(presets: FilterPreset[]): boolean {
	return presets.some((p) => p.enabled);
}

/** Every node id matching the enabled filters combined per `combineMode` (see this module's docstring) - each filter's own criteria always AND together (nodeGroups.ts's matchesGroup()). Only call once isAnyFilterEnabled() is true - with none enabled this returns an empty set, which callers must NOT treat as "hide everything" (see that function's docstring). */
export function evaluateFilters(factsByNode: Map<string, NoteFilterFacts>, presets: FilterPreset[], combineMode: FilterCombineMode): Set<string> {
	const enabled = presets.filter((p) => p.enabled);
	const matches = new Set<string>();
	for (const [node, facts] of factsByNode) {
		const matchesNode =
			combineMode === 'and' ? enabled.every((preset) => matchesGroup(facts, preset)) : enabled.some((preset) => matchesGroup(facts, preset));
		if (matchesNode) matches.add(node);
	}
	return matches;
}
