/**
 * User-defined semantic node groups - replaces the old "pick one property
 * (or the built-in Cluster freshness gradient) to color/size by" Color &
 * size modal (see git history for colorAndSizeModal.ts/visualEncoding.ts)
 * with named, user-colored (and optionally user-sized) buckets of notes,
 * each matched by a flat list of criteria. Kept Obsidian-app-free (same
 * boundary as filter.ts/stagnation.ts) so the matching logic is
 * unit-testable without a real vault - GraphPane gathers each note's
 * NodeGroupFacts from app.metadataCache/vault/graph and applies the
 * winning group's color/size to the graph.
 *
 * `criteria` is a flat list, always AND'd (a note must match *every*
 * criterion) - an earlier version let each group choose AND or OR, and
 * another let criteria nest into "A AND (B OR C)" blocks; both were user
 * feedback'd out as too complicated for a first implementation. AND-only
 * is the simpler, more predictable default (every criterion narrows the
 * match, never broadens it) - OR-across-groups is still available for
 * free by just creating a second group with a different color.
 *
 * Precedence when multiple enabled groups match the same note: the first
 * matching group in `groups`' own array order wins - GraphPane's group list
 * UI exposes reordering (up/down), so this is a real, user-controlled
 * priority, not an arbitrary implementation detail.
 */

export const MAX_NODE_GROUPS = 10;

export type GroupCriterionType = 'clusterFreshness' | 'text' | 'folder' | 'filename' | 'tag' | 'property' | 'staleDays' | 'minLinks';

/** How a `property` criterion compares the frontmatter value to `value` - user feedback: raw substring-only matching couldn't express "status is exactly done" vs. "status is not done" vs. "has no status set at all". */
export type StringOperator = 'contains' | 'equals' | 'notEquals' | 'isEmpty' | 'isNotEmpty';

/**
 * A note's cluster is either in the stalest half of clusters present
 * ('stagnant') or the freshest half ('fresh') - a plain two-way choice
 * rather than a numeric 0-1 (or 0-100%) threshold, which user feedback
 * said was still not understandable regardless of how it was presented
 * (a raw ratio, then a labeled percentage range) - see stagnation.ts's
 * staleness() for the underlying continuous value this buckets. The values
 * themselves ('stagnant'/'fresh') are internal only - user feedback said
 * even the binary version still wasn't understandable as presented in the
 * UI, not because of the two-way choice itself but because of the words
 * "cluster" and "half" (jargon with no obvious vault-editing meaning); see
 * graphPane.ts's renderCriterionEditRow() and this module's
 * describeCriterion() for the actual user-facing wording ("an inactive/
 * active area of the vault"), which describes the same mechanism without
 * naming it.
 */
export type StalenessBucket = 'stagnant' | 'fresh';

export interface ClusterFreshnessCriterion {
	type: 'clusterFreshness';
	bucket: StalenessBucket;
}

/** Case-insensitive substring match against the note's title *and* body content. */
export interface TextCriterion {
	type: 'text';
	query: string;
}

/** The note's path must start with this folder (or be exactly this folder) - i.e. subfolders are included. */
export interface FolderCriterion {
	type: 'folder';
	folder: string;
}

/** Case-insensitive substring match against just the note's title - unlike `text`, never the body. */
export interface FilenameCriterion {
	type: 'filename';
	query: string;
}

/** Matches if the note has *any* of `tags` - a single criterion, not one row per tag (user feedback: picking several tags at once shouldn't need several separate rows). */
export interface TagCriterion {
	type: 'tag';
	tags: string[];
}

/** Compares one frontmatter property's (stringified) value using `operator` - `value` is ignored for isEmpty/isNotEmpty. */
export interface PropertyCriterion {
	type: 'property';
	key: string;
	operator: StringOperator;
	value: string;
}

/** Note not edited in at least `days` days - same mechanism as filter.ts's FilterQuery.staleDays. */
export interface StaleDaysCriterion {
	type: 'staleDays';
	days: number;
}

/** Note has at least `count` links (graph degree) - same mechanism as filter.ts's FilterQuery.minDegree. */
export interface MinLinksCriterion {
	type: 'minLinks';
	count: number;
}

export type GroupCriterion = ClusterFreshnessCriterion | TextCriterion | FolderCriterion | FilenameCriterion | TagCriterion | PropertyCriterion | StaleDaysCriterion | MinLinksCriterion;

/**
 * The common shape every enable-toggleable, criteria-matched list entry
 * needs - both NodeGroup (Color & size) and filter.ts's FilterPreset
 * satisfy this structurally, so needsContentSearch()/needsClusterFreshness()
 * below (and GraphPane's own content/cluster-staleness caching) can treat a
 * vault's node groups and filter presets as one combined list instead of
 * checking each separately.
 */
export interface CriteriaOwner {
	enabled: boolean;
	/** AND across every criterion - see this module's docstring. */
	criteria: GroupCriterion[];
}

export interface NodeGroup extends CriteriaOwner {
	id: string;
	name: string;
	color: string;
	/**
	 * null = keep the default (link-count-based) size - see vaultGraph.ts's
	 * sizeNodesByDegree(). Otherwise a multiplier applied on top of that
	 * default (1 = unchanged, 2 = double, 0.5 = half) rather than an
	 * absolute value replacing it - user feedback: an earlier version set
	 * an absolute size, which made every matching note the same size
	 * regardless of its own link count, losing the "hub notes are bigger"
	 * signal entirely for the whole group.
	 */
	sizeMultiplier: number | null;
}

export interface NodeGroupFacts {
	label: string;
	/** The note's parent folder path ('' for vault root). */
	folder: string;
	/**
	 * Lowercased "title\ncontent" - only populated when at least one enabled
	 * group has a `text` criterion (see needsContentSearch() and
	 * GraphPane's refreshNoteContentCache()), empty string otherwise. A
	 * `text` criterion always fails to match against an empty string rather
	 * than silently matching everything.
	 */
	content: string;
	/** From Obsidian's getAllTags() - includes the leading '#'. */
	tags: string[];
	frontmatter: Record<string, unknown>;
	/** 0-1, see stagnation.ts's staleness() - null if cluster stats haven't been computed (no enabled group needs them, see needsClusterFreshness()). */
	clusterStaleness: number | null;
	/** File modification time (ms since epoch) - backs the `staleDays` criterion, same source as filter.ts's NoteFilterFacts.mtime. */
	mtime: number;
	/** Link count (graph.degree()) - backs the `minLinks` criterion, same source as filter.ts's NoteFilterFacts.degree. */
	degree: number;
}

// Same 10 colors visualEncoding.ts used to auto-assign by category -
// reused here as sensible defaults GraphPane cycles through when creating a
// new group, not as an automatic per-value assignment (a group's color is
// always a single explicit user choice).
export const DEFAULT_GROUP_COLORS = [
	'#ef4444',
	'#f97316',
	'#eab308',
	'#22c55e',
	'#06b6d4',
	'#3b82f6',
	'#8b5cf6',
	'#ec4899',
	'#64748b',
	'#84cc16',
];

/**
 * Frontmatter values can be a string, number, boolean, list, or nested
 * object - `String(value)` on an object/array would silently collapse to
 * "[object Object]", so each shape gets a sensible lowercase text form to
 * compare/search against instead (arrays joined, objects JSON-stringified).
 * Same logic as filter.ts's own stringifyPropertyValue - not shared/
 * imported across the two modules since each stays a self-contained,
 * independently testable unit, and the duplication is a few lines.
 */
function stringifyPropertyValue(value: unknown): string {
	if (value === undefined || value === null) return '';
	if (typeof value === 'string') return value.toLowerCase();
	if (typeof value === 'number' || typeof value === 'boolean') return String(value).toLowerCase();
	if (Array.isArray(value)) return value.map(stringifyPropertyValue).join(', ').toLowerCase();
	return (JSON.stringify(value) ?? '').toLowerCase();
}

/** 0.5 is the boundary between the "fresh" and "stagnant" halves - see StalenessBucket's docstring. */
const STAGNANT_THRESHOLD = 0.5;

function matchesCriterion(facts: NodeGroupFacts, criterion: GroupCriterion): boolean {
	switch (criterion.type) {
		case 'clusterFreshness':
			if (facts.clusterStaleness === null) return false;
			return criterion.bucket === 'stagnant' ? facts.clusterStaleness >= STAGNANT_THRESHOLD : facts.clusterStaleness < STAGNANT_THRESHOLD;
		case 'text': {
			const query = criterion.query.trim().toLowerCase();
			return query !== '' && facts.content.includes(query);
		}
		case 'folder':
			return criterion.folder !== '' && (facts.folder === criterion.folder || facts.folder.startsWith(`${criterion.folder}/`));
		case 'filename': {
			const query = criterion.query.trim().toLowerCase();
			return query !== '' && facts.label.toLowerCase().includes(query);
		}
		case 'tag':
			return criterion.tags.length > 0 && criterion.tags.some((tag) => facts.tags.includes(tag));
		case 'property': {
			if (criterion.key === '') return false;
			const value = stringifyPropertyValue(facts.frontmatter[criterion.key]);
			if (criterion.operator === 'isEmpty') return value === '';
			if (criterion.operator === 'isNotEmpty') return value !== '';
			const target = criterion.value.trim().toLowerCase();
			if (target === '') return false;
			if (criterion.operator === 'contains') return value.includes(target);
			if (criterion.operator === 'equals') return value === target;
			return value !== target; // notEquals
		}
		case 'staleDays': {
			const cutoff = Date.now() - criterion.days * 24 * 60 * 60 * 1000;
			// mtime *after* the cutoff means it was edited more recently than
			// "days ago" - i.e. NOT stale enough, so it fails the criterion.
			return facts.mtime <= cutoff;
		}
		case 'minLinks':
			return facts.degree >= criterion.count;
	}
}

/**
 * Every criterion must match (AND) - see this module's docstring. Shared
 * by matchesGroup() below and filter.ts's own matching (which reuses the
 * exact same GroupCriterion/NodeGroupFacts types) - "filter" and "color &
 * size group" are the same matching mechanism applied two different ways
 * (hide vs. color), not two separate implementations to keep in sync.
 */
export function matchesAllCriteria(facts: NodeGroupFacts, criteria: GroupCriterion[]): boolean {
	return criteria.every((criterion) => matchesCriterion(facts, criterion));
}

/** A group/preset with no criteria yet matches nothing - a half-built one shouldn't silently paint the whole graph one color or match every note. Takes any CriteriaOwner (NodeGroup or filter.ts's FilterPreset), not just NodeGroup - see that interface's docstring. */
export function matchesGroup(facts: NodeGroupFacts, group: Pick<CriteriaOwner, 'criteria'>): boolean {
	if (group.criteria.length === 0) return false;
	return matchesAllCriteria(facts, group.criteria);
}

/**
 * Every node mapped to the first *enabled* group (in array order) whose
 * criteria it matches - see this module's docstring for why order is the
 * precedence rule. Nodes matching no enabled group are absent from the
 * result, so the caller's fallback (the default color/size) applies.
 */
export function evaluateGroups(factsByNode: Map<string, NodeGroupFacts>, groups: NodeGroup[]): Map<string, NodeGroup> {
	const enabledGroups = groups.filter((g) => g.enabled);
	const result = new Map<string, NodeGroup>();
	for (const [node, facts] of factsByNode) {
		for (const group of enabledGroups) {
			if (matchesGroup(facts, group)) {
				result.set(node, group);
				break;
			}
		}
	}
	return result;
}

/** Whether any enabled group/preset (node groups and filter presets combined - see CriteriaOwner) has at least one `text` criterion - GraphPane only pays for reading every note's body content (a real I/O cost) when this is true. */
export function needsContentSearch(owners: CriteriaOwner[]): boolean {
	return owners.some((o) => o.enabled && o.criteria.some((c) => c.type === 'text'));
}

/** Whether any enabled group/preset has at least one `clusterFreshness` criterion - GraphPane only pays for Louvain community detection (a real computational cost) when this is true. */
export function needsClusterFreshness(owners: CriteriaOwner[]): boolean {
	return owners.some((o) => o.enabled && o.criteria.some((c) => c.type === 'clusterFreshness'));
}

const STRING_OPERATOR_LABELS: Record<StringOperator, string> = {
	contains: 'contains',
	equals: 'equals',
	notEquals: 'does not equal',
	isEmpty: 'is empty',
	isNotEmpty: 'is not empty',
};

/**
 * A short, plain-language one-liner for a single criterion (e.g. `status
 * equals "done"`, `#project, #urgent`, `Folder: Archive`) - GraphPane
 * shows this as a compact chip's label instead of always-visible
 * type-specific controls, so a group with several criteria reads as a
 * short list of chips rather than a wall of dropdowns/text fields (user
 * feedback: the criteria list was "unübersichtlich" - unclear/cluttered).
 * `tag`/`property` read as natural mini-sentences on their own (a tag
 * already starts with '#', a property reads as "key operator value") and
 * so skip the type-name prefix the free-text types (`folder`/`filename`/
 * `text`) need to stay distinguishable from one another once filled in -
 * same reasoning as CRITERION_TYPE_LABELS in graphPane.ts.
 */
export function describeCriterion(criterion: GroupCriterion): string {
	switch (criterion.type) {
		case 'tag':
			return criterion.tags.length > 0 ? criterion.tags.join(', ') : 'Tag: (none picked)';
		case 'property': {
			if (!criterion.key) return 'Property: (none picked)';
			if (criterion.operator === 'isEmpty' || criterion.operator === 'isNotEmpty') {
				return `${criterion.key} ${STRING_OPERATOR_LABELS[criterion.operator]}`;
			}
			return `${criterion.key} ${STRING_OPERATOR_LABELS[criterion.operator]} "${criterion.value || '…'}"`;
		}
		case 'folder':
			return `Folder: ${criterion.folder || '(none)'}`;
		case 'filename':
			return `Filename: ${criterion.query || '(none)'}`;
		case 'text':
			return `Text: ${criterion.query || '(none)'}`;
		case 'clusterFreshness':
			return criterion.bucket === 'stagnant' ? 'Activity: inactive area of the vault' : 'Activity: active area of the vault';
		case 'staleDays':
			return `Not edited in ${criterion.days}+ days`;
		case 'minLinks':
			return `${criterion.count}+ links`;
	}
}
