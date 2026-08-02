/**
 * Doc section 3.1/3.3 follow-up: a single filter that considers several
 * criteria at once (text, tags, frontmatter properties, staleness, link
 * count) instead of text-only matching - GitHub issue discussion "search
 * that considers different criteria". Kept Obsidian-app-free (same
 * boundary as visualEncoding.ts/stagnation.ts/pathfinding.ts) so the
 * matching logic itself is unit-testable without a real vault; GraphPane
 * is responsible for gathering each note's NoteFilterFacts from
 * app.metadataCache/graph and applying the result by hiding every
 * non-matching node and edge.
 *
 * Originally offered a Highlight mode too (dim non-matches instead of
 * hiding them) - removed on user feedback: Filter alone was simpler to
 * reason about and covered every real use case, and maintaining two
 * separate application paths for the same match set wasn't worth it.
 *
 * AND across different criterion *types* (text, tags, properties,
 * staleness, link count all have to pass), but OR *within* tags (any one
 * selected tag is enough) and, separately, AND across each individual
 * property filter (every property row has to match) - same reasoning
 * multi-select filters generally use: tags are interchangeable instances
 * of the same kind of criterion ("has #project or #urgent"), while each
 * property row targets a conceptually different field ("status=done AND
 * priority contains 5"), where OR-ing across different fields would
 * rarely be what someone actually wants.
 */

export interface NoteFilterFacts {
	label: string;
	/** From Obsidian's getAllTags() - includes the leading '#'. */
	tags: string[];
	frontmatter: Record<string, unknown>;
	mtime: number;
	/** Link count (graph.degree()) - lets a query single out hubs ("min links") without a separate visual-encoding pass. */
	degree: number;
}

/** One "property contains value" row - see FilterQuery.properties. */
export interface PropertyFilter {
	key: string;
	value: string;
}

/**
 * Every field is independently "off" when empty/null - an unset field
 * never excludes a note, so a query with everything unset is a
 * matches-everything no-op (see isEmptyQuery()), and turning on one
 * criterion doesn't require filling in the others.
 */
export interface FilterQuery {
	/** Case-insensitive substring match against the note's title. */
	text: string;
	/** Exact tags, leading '#' included (e.g. "#project") - a note matches if it has *any* of these (OR); empty = not filtering by tag. */
	tags: string[];
	/** Each row only applies once its value is non-empty (an empty-value row would otherwise match every note that merely has the property, which reads as a silent no-op filter) - a note must satisfy *every* row with a value (AND). */
	properties: PropertyFilter[];
	/** Note not edited in at least this many days - null = not filtering by staleness. */
	staleDays: number | null;
	/** Note has at least this many links (graph.degree()) - null = not filtering by degree. */
	minDegree: number | null;
}

export const EMPTY_FILTER_QUERY: FilterQuery = {
	text: '',
	tags: [],
	properties: [],
	staleDays: null,
	minDegree: null,
};

/** Whether every criterion is unset - the caller's cue to fall back to "nothing active" instead of running a no-op match-everything query. */
export function isEmptyQuery(query: FilterQuery): boolean {
	return (
		query.text.trim() === '' &&
		query.tags.length === 0 &&
		query.properties.every((p) => p.value.trim() === '') &&
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

/** See this module's docstring for the AND/OR rules across criteria. */
export function matchesQuery(facts: NoteFilterFacts, query: FilterQuery): boolean {
	const text = query.text.trim().toLowerCase();
	if (text && !facts.label.toLowerCase().includes(text)) return false;

	if (query.tags.length > 0 && !query.tags.some((tag) => facts.tags.includes(tag))) return false;

	for (const property of query.properties) {
		if (property.value.trim() === '') continue;
		const value = stringifyPropertyValue(facts.frontmatter[property.key]);
		if (!value.includes(property.value.trim().toLowerCase())) return false;
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

/** Every node id whose facts satisfy the query - the caller hides everything else (see this module's docstring). */
export function evaluateQuery(factsByNode: Map<string, NoteFilterFacts>, query: FilterQuery): Set<string> {
	const matches = new Set<string>();
	for (const [node, facts] of factsByNode) {
		if (matchesQuery(facts, query)) matches.add(node);
	}
	return matches;
}
