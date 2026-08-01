/**
 * Doc section 3.1/3.3 follow-up: a single search that considers several
 * criteria at once (text, tag, a frontmatter property, staleness, link
 * count) instead of text-only matching - GitHub issue discussion "search
 * that considers different criteria". Kept Obsidian-app-free (same
 * boundary as visualEncoding.ts/stagnation.ts/pathfinding.ts) so the
 * matching logic itself is unit-testable without a real vault; GraphPane
 * is responsible for gathering each note's NoteSearchFacts from
 * app.metadataCache/graph and applying the result as either a highlight
 * (dim everything else) or a filter (hide everything else).
 *
 * Deliberately AND-only across criteria (no per-criterion OR groups, no
 * expression language) - same "no formula support" v1-scope reasoning as
 * visualEncoding.ts: a query builder for arbitrary boolean expressions is
 * a lot more surface area (and a lot more ways to end up with a confusing
 * empty result) than "every active criterion must match", which already
 * covers the common cases (e.g. "tag=#project AND not edited in 30 days").
 */

export interface NoteSearchFacts {
	label: string;
	/** From Obsidian's getAllTags() - includes the leading '#'. */
	tags: string[];
	frontmatter: Record<string, unknown>;
	mtime: number;
	/** Link count (graph.degree()) - lets a query single out hubs ("min links") without a separate visual-encoding pass. */
	degree: number;
}

/**
 * Every field is optional/nullable and independently "off" - an unset
 * field never excludes a note, so a query with everything unset is a
 * matches-everything no-op (see isEmptyQuery()), and turning on one
 * criterion doesn't require filling in the others.
 */
export interface SearchQuery {
	/** Case-insensitive substring match against the note's title. */
	text: string;
	/** Exact tag, leading '#' included (e.g. "#project") - null = not filtering by tag. */
	tag: string | null;
	/** Only applied once both are set - a key with an empty value would otherwise match every note that merely has the property, which reads as a silent no-op filter. */
	propertyKey: string | null;
	propertyValue: string;
	/** Note not edited in at least this many days - null = not filtering by staleness. */
	staleDays: number | null;
	/** Note has at least this many links (graph.degree()) - null = not filtering by degree. */
	minDegree: number | null;
}

export const EMPTY_SEARCH_QUERY: SearchQuery = {
	text: '',
	tag: null,
	propertyKey: null,
	propertyValue: '',
	staleDays: null,
	minDegree: null,
};

/** Whether every criterion is unset - the caller's cue to fall back to "nothing active" instead of running a no-op match-everything query. */
export function isEmptyQuery(query: SearchQuery): boolean {
	return (
		query.text.trim() === '' &&
		query.tag === null &&
		!(query.propertyKey !== null && query.propertyValue.trim() !== '') &&
		query.staleDays === null &&
		query.minDegree === null
	);
}

/**
 * Frontmatter values can be a string, number, boolean, list, or nested
 * object - `String(value)` on an object/array would silently collapse to
 * "[object Object]", so each shape gets a sensible lowercase text form to
 * substring-match against instead (arrays joined, objects JSON-stringified).
 */
function stringifyPropertyValue(value: unknown): string {
	if (value === undefined || value === null) return '';
	if (typeof value === 'string') return value.toLowerCase();
	if (typeof value === 'number' || typeof value === 'boolean') return String(value).toLowerCase();
	if (Array.isArray(value)) return value.map(stringifyPropertyValue).join(', ').toLowerCase();
	// Anything else (nested object, or an edge case JSON.stringify can't
	// represent like a symbol/function) - stringify what we can rather than
	// throwing, empty string for the handful of things even JSON can't.
	return (JSON.stringify(value) ?? '').toLowerCase();
}

/** AND across every active criterion - see this module's docstring for why. */
export function matchesQuery(facts: NoteSearchFacts, query: SearchQuery): boolean {
	const text = query.text.trim().toLowerCase();
	if (text && !facts.label.toLowerCase().includes(text)) return false;

	if (query.tag !== null && !facts.tags.includes(query.tag)) return false;

	if (query.propertyKey !== null && query.propertyValue.trim() !== '') {
		const value = stringifyPropertyValue(facts.frontmatter[query.propertyKey]);
		if (!value.includes(query.propertyValue.trim().toLowerCase())) return false;
	}

	if (query.staleDays !== null) {
		const cutoff = Date.now() - query.staleDays * 24 * 60 * 60 * 1000;
		// mtime *after* the cutoff means it was edited more recently than
		// "staleDays ago" - i.e. NOT stale enough, so it fails the filter.
		if (facts.mtime > cutoff) return false;
	}

	if (query.minDegree !== null && facts.degree < query.minDegree) return false;

	return true;
}

/** Every node id whose facts satisfy the query - the caller applies this as either a highlight or a filter (see this module's docstring). */
export function evaluateQuery(factsByNode: Map<string, NoteSearchFacts>, query: SearchQuery): Set<string> {
	const matches = new Set<string>();
	for (const [node, facts] of factsByNode) {
		if (matchesQuery(facts, query)) matches.add(node);
	}
	return matches;
}
