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

export type GroupCriterionType =
	| 'clusterFreshness'
	| 'structuralDeviation'
	| 'betweenness'
	| 'pageRank'
	| 'isolatedComponent'
	| 'community'
	| 'semanticCluster'
	| 'text'
	| 'folder'
	| 'filename'
	| 'tag'
	| 'property'
	| 'staleDays'
	| 'minLinks'
	| 'existence';

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

/**
 * Whether the node is a real note (`true`) or a ghost node - a link to a
 * note that doesn't exist yet, vaultGraph.ts's `kind: 'ghost'`, one per
 * distinct missing target (`false`). A plain two-way choice, like
 * `clusterFreshness`'s bucket, not a boolean toggle + negate - see
 * GroupCriterion's own `negate` docstring for why `property`/
 * `clusterFreshness` (and now this) skip `negate` in favor of an explicit
 * either/or choice that already reads as a complete sentence on its own.
 * Ghost nodes are otherwise invisible to every other criterion (they carry
 * no folder/tags/frontmatter/content - see GraphPane's buildCriteriaFacts()
 * for how their facts are built) - this is the one criterion that can
 * single them out on purpose, e.g. to color/size them differently in a
 * Color & size group, or to build a filter that shows only the missing
 * notes (or hides them entirely).
 */
export interface ExistenceCriterion {
	type: 'existence';
	exists: boolean;
}

/**
 * A note's Louvain community (see stagnation.ts's detectCommunities()) is
 * either mostly spread across several different folders ('scattered') or
 * mostly consolidated into one ('cohesive') - GitHub issue #5, "these 8
 * notes belong together by link topology, but live in 5 different
 * folders". A plain two-way choice, same reasoning as `clusterFreshness`'s
 * `bucket` (see StalenessBucket's own docstring) rather than a raw 0-1
 * homogeneity value or percentage - the underlying continuous value is
 * stagnation.ts's communityHomogeneity(), 0.5 is the split point (see
 * matchesCriterionValue()'s STRUCTURAL_COHESION_THRESHOLD).
 */
export type StructuralCohesionBucket = 'scattered' | 'cohesive';

export interface StructuralDeviationCriterion {
	type: 'structuralDeviation';
	bucket: StructuralCohesionBucket;
}

/**
 * A note's betweenness/PageRank centrality is either in the top half of
 * what's present ('high') or the bottom half ('low') - GitHub backlog item
 * 5, "Graph-Analytics erweitern". Same plain two-way-relative-to-what's-
 * present shape as `StalenessBucket`/`StructuralCohesionBucket` above, not
 * a raw score - the underlying continuous values (graphAnalytics.ts's
 * computeBetweenness()/computePageRank(), normalized via
 * normalizeToUnitRange() the same way stagnation.ts's staleness()
 * normalizes mtimes) are graph-size-dependent numbers nobody could pick a
 * meaningful absolute cutoff for. Shared by both criteria below - same
 * shape, different underlying metric.
 */
export type CentralityBucket = 'high' | 'low';

/**
 * Betweenness centrality - how often a note lies on the shortest path
 * between two *other* notes, i.e. how much of a structural "bridge" it is
 * (distinct from `minLinks`: a note can have very few links and still be
 * the only connection between two otherwise-separate parts of the vault).
 */
export interface BetweennessCriterion {
	type: 'betweenness';
	bucket: CentralityBucket;
}

/**
 * PageRank - how "prominent" a note is, weighted by how prominent its own
 * linking neighbors are (distinct from `minLinks`/degree: ten links from
 * ten obscure notes count for less than one link from an already-prominent
 * hub).
 */
export interface PageRankCriterion {
	type: 'pageRank';
	bucket: CentralityBucket;
}

/**
 * Whether the note's connected component (diagnostics.ts's
 * findConnectedComponents()) is the vault's single largest one, or one of
 * the smaller ones cut off from it - the same distinction the Diagnostics
 * panel's "Isolated clusters" section already surfaces as a list, now
 * usable to color/size/filter by directly. A plain two-way choice, like
 * `existence` - a note is either in the main body or it isn't, there's no
 * partial/graded version of this the way betweenness/PageRank have one.
 */
export interface IsolatedComponentCriterion {
	type: 'isolatedComponent';
	isolated: boolean;
}

/**
 * Matches notes in one specific Louvain community (stagnation.ts's
 * detectCommunities()), numbered by size - 0 is the largest community
 * present, 1 the next largest, and so on (raw Louvain community ids are
 * arbitrary and mean nothing on their own; ranking by size is what makes
 * "Community 1" a stable, meaningful label across re-runs of the same
 * graph). `communityColor()` below gives each community id a color from a
 * fixed palette - GraphPane syncs a Color & size group's own `color` to it
 * automatically whenever this criterion's `communityId` is picked/changed
 * (see graphPane.ts's CriteriaEditorContext.onCommunityColorSync), so
 * "color by community" needs no separate coloring mechanism of its own -
 * it's just this criterion plus that one sync hook, still entirely inside
 * the existing group/criteria system (no new UI metaphor).
 */
export interface CommunityCriterion {
	type: 'community';
	communityId: number;
}

/**
 * Matches notes in one specific *semantic* cluster - same "ranked by size,
 * 0 is the largest" numbering as CommunityCriterion above, but grouped by
 * meaning (cosine similarity between each note's title+content embedding -
 * see embeddings.ts) instead of by link structure. GitHub backlog item 16,
 * "Semantisches Clustering": the whole point is surfacing notes that read
 * as related even though nothing links them, so this deliberately doesn't
 * reuse `community` itself (which is inherently a *link*-graph concept -
 * two notes with identical content but zero shared links, direct or
 * indirect, can never land in the same Louvain community, no matter how
 * this criterion is defined). `clusterId` is a rank into
 * embeddings.ts's detectSemanticClusters() output, computed once per
 * repaint and shared across every enabled `semanticCluster` criterion the
 * same way Louvain communities already are - see needsSemanticClustering()
 * and GraphPane's buildCriteriaFacts().
 */
export interface SemanticClusterCriterion {
	type: 'semanticCluster';
	clusterId: number;
}

/**
 * `& { negate?: boolean }` rather than adding the field to each of the 13
 * interfaces above - an intersection with a union still distributes over
 * it (so `criterion.type` narrowing in the switches below is unaffected),
 * and every criterion type shares the same underlying include/exclude flag
 * from one place - user feedback: "Bedingungen sollen einen Ausschluss
 * oder Einschluss ermöglichen z.B. alle Knoten die NICHT im Ordner XY
 * sind". A first UI pass exposed this as a standalone "Exclude" toggle
 * next to each criterion's type heading - user feedback rejected several
 * variations of that as a control ("die Vorschläge sind alle noch nicht
 * optimal [...] Ganz anderer Ansatz gewünscht"), so graphPane.ts's
 * renderCriterionEditRow() instead makes the negated/non-negated *wording
 * itself* (see describeCriterion()) the clickable control - no separate
 * toggle/checkbox/dropdown element at all for most types. `property`,
 * `clusterFreshness`, `structuralDeviation`, `betweenness`, `pageRank`, and
 * `isolatedComponent` don't use `negate` (no UI ever sets it for them) -
 * each already offers an equivalent choice via its own operator/bucket
 * (`isolatedComponent`'s `isolated` boolean is exactly that kind of
 * choice, same as `existence`'s `exists`). `community` *does* use it
 * ("Community 2 is/is not") - unlike the bucket types, there's no
 * opposite-community dropdown option that would say the same thing.
 * Optional (not required on every literal) so criteria saved before this
 * feature existed still type-check and behave as included (not negated) -
 * see matchesCriterion()'s own handling.
 */
export type GroupCriterion = (
	| ClusterFreshnessCriterion
	| StructuralDeviationCriterion
	| BetweennessCriterion
	| PageRankCriterion
	| IsolatedComponentCriterion
	| CommunityCriterion
	| SemanticClusterCriterion
	| TextCriterion
	| FolderCriterion
	| FilenameCriterion
	| TagCriterion
	| PropertyCriterion
	| StaleDaysCriterion
	| MinLinksCriterion
	| ExistenceCriterion
) & { negate?: boolean };

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
	/** 0 (community fully consolidated in one folder) to 1 (fully scattered) - `1 - communityHomogeneity()` (stagnation.ts), null if community/folder stats haven't been computed (no enabled group needs them, see needsStructuralDeviation()). Backs the `structuralDeviation` criterion. */
	structuralDeviation: number | null;
	/** 0-1, relative to every other note present (graphAnalytics.ts's computeBetweenness() + normalizeToUnitRange()) - null if not computed (no enabled group needs it, see needsBetweenness()). Backs the `betweenness` criterion. */
	betweenness: number | null;
	/** 0-1, relative to every other note present (graphAnalytics.ts's computePageRank() + normalizeToUnitRange()) - null if not computed (no enabled group needs it, see needsPageRank()). Backs the `pageRank` criterion. */
	pageRank: number | null;
	/** Whether the note's connected component is *not* the vault's largest one (diagnostics.ts's findConnectedComponents()) - null if not computed (no enabled group needs it, see needsIsolatedComponent()). Backs the `isolatedComponent` criterion. */
	isolatedComponent: boolean | null;
	/** The note's Louvain community, ranked by size (0 = largest present) - null if not computed (no enabled group needs it, see needsCommunity()). Backs the `community` criterion. */
	communityId: number | null;
	/** The note's semantic cluster (embeddings.ts's detectSemanticClusters()), ranked by size (0 = largest present) - null if not computed (no enabled group needs it, see needsSemanticClustering()), or if embedding hasn't finished yet. Backs the `semanticCluster` criterion. */
	semanticClusterId: number | null;
	/** File modification time (ms since epoch) - backs the `staleDays` criterion, same source as filter.ts's NoteFilterFacts.mtime. */
	mtime: number;
	/** Link count (graph.degree()) - backs the `minLinks` criterion, same source as filter.ts's NoteFilterFacts.degree. */
	degree: number;
	/** `false` for a ghost node (vaultGraph.ts's `kind: 'ghost'`), `true` for a real note - backs the `existence` criterion. */
	exists: boolean;
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
 * "Community-Färbung mit fester Palette" (GitHub backlog item 5) - every
 * community id maps to the same color every time (cycling through
 * DEFAULT_GROUP_COLORS once there are more communities than colors, same
 * as any other 10+ category value would), so "Community 1 is red" stays
 * true across sessions instead of depending on creation order the way a
 * manually-picked group color would. See CommunityCriterion's own
 * docstring for where this gets applied (GraphPane's
 * onCommunityColorSync).
 */
export function communityColor(communityId: number): string {
	return DEFAULT_GROUP_COLORS[communityId % DEFAULT_GROUP_COLORS.length]!;
}

/**
 * One ready-made group, orange, built on the `existence` criterion - user
 * feedback: ship the obvious "make missing notes visually pop" combination
 * out of the box rather than expecting everyone to build it themselves via
 * "+ Add" → "Existence". Fixed `id` (not user-editable) so settings.ts's
 * `showDefaultColorGroups` toggle (main.ts's syncDefaultPresets()) can
 * reliably find and add/remove exactly this one. `enabled: false` - same
 * reasoning as filter.ts's DEFAULT_FILTER_PRESETS: the toggle makes it
 * *available* in the Color & size panel, it doesn't silently recolor
 * anyone's graph the moment they update the plugin. `#f97316` is this
 * file's own DEFAULT_GROUP_COLORS[1] (orange) above, not a new one-off hex.
 */
export const DEFAULT_NODE_GROUPS: NodeGroup[] = [
	{
		id: 'default-group-show-nonexisting',
		name: 'Non-existing notes',
		color: '#f97316',
		sizeMultiplier: null,
		enabled: false,
		criteria: [{ type: 'existence', exists: false }],
	},
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

/** 0.5 is the boundary between "cohesive" and "scattered" - a community whose most common folder holds under half its notes reads as scattered, one where it holds at least half reads as cohesive. See StructuralCohesionBucket's own docstring. */
const STRUCTURAL_COHESION_THRESHOLD = 0.5;

/** 0.5 is the boundary between the "high" and "low" halves - shared by `betweenness` and `pageRank`, both already normalized relative to what's present (graphAnalytics.ts's normalizeToUnitRange()) the same way clusterStaleness/structuralDeviation are. See CentralityBucket's own docstring. */
const CENTRALITY_THRESHOLD = 0.5;

/** The raw (pre-negation) match for one criterion - see matchesCriterion() below for the negate wrapper. */
function matchesCriterionValue(facts: NodeGroupFacts, criterion: GroupCriterion): boolean {
	// A ghost node's facts are mostly empty/default (mtime: 0, folder: '',
	// its real graph degree, ...) - without this guard, that would let it
	// accidentally satisfy criteria never meant to consider it at all (a
	// `staleDays` criterion reading mtime: 0 as "extremely old", a
	// `minLinks` criterion matching its real edge count, ...). Only
	// `existence` is allowed to see a non-existent node for what it is -
	// every other criterion type treats one as a hard non-match, full stop.
	if (criterion.type !== 'existence' && !facts.exists) return false;
	switch (criterion.type) {
		case 'clusterFreshness':
			if (facts.clusterStaleness === null) return false;
			return criterion.bucket === 'stagnant' ? facts.clusterStaleness >= STAGNANT_THRESHOLD : facts.clusterStaleness < STAGNANT_THRESHOLD;
		case 'structuralDeviation':
			if (facts.structuralDeviation === null) return false;
			return criterion.bucket === 'scattered'
				? facts.structuralDeviation >= STRUCTURAL_COHESION_THRESHOLD
				: facts.structuralDeviation < STRUCTURAL_COHESION_THRESHOLD;
		case 'betweenness':
			if (facts.betweenness === null) return false;
			return criterion.bucket === 'high' ? facts.betweenness >= CENTRALITY_THRESHOLD : facts.betweenness < CENTRALITY_THRESHOLD;
		case 'pageRank':
			if (facts.pageRank === null) return false;
			return criterion.bucket === 'high' ? facts.pageRank >= CENTRALITY_THRESHOLD : facts.pageRank < CENTRALITY_THRESHOLD;
		case 'isolatedComponent':
			if (facts.isolatedComponent === null) return false;
			return facts.isolatedComponent === criterion.isolated;
		case 'community':
			return facts.communityId !== null && facts.communityId === criterion.communityId;
		case 'semanticCluster':
			return facts.semanticClusterId !== null && facts.semanticClusterId === criterion.clusterId;
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
		case 'existence':
			return facts.exists === criterion.exists;
	}
}

/**
 * Whether `criterion` still has nothing meaningful to match against (e.g.
 * an empty folder path, no tags picked) - matchesCriterionValue() already
 * treats this as "doesn't match" on its own, but negate's `!value` flip
 * below would otherwise turn that into "matches everything" for a
 * half-built criterion the user hasn't finished typing into yet. staleDays/
 * minLinks/clusterFreshness/structuralDeviation/betweenness/pageRank/
 * isolatedComponent/community are never "unconfigured" (blankCriterion()
 * always gives them a real default), so they're excluded here.
 */
function isCriterionUnconfigured(criterion: GroupCriterion): boolean {
	switch (criterion.type) {
		case 'folder':
			return criterion.folder === '';
		case 'filename':
		case 'text':
			return criterion.query.trim() === '';
		case 'tag':
			return criterion.tags.length === 0;
		case 'property':
			if (criterion.key === '') return true;
			if (criterion.operator === 'isEmpty' || criterion.operator === 'isNotEmpty') return false;
			return criterion.value.trim() === '';
		case 'clusterFreshness':
		case 'structuralDeviation':
		case 'betweenness':
		case 'pageRank':
		case 'isolatedComponent':
		case 'community':
		case 'semanticCluster':
		case 'staleDays':
		case 'minLinks':
		case 'existence':
			return false;
	}
}

/** Include (default) or exclude - see GroupCriterion's own docstring for why `negate` lives here instead of on each of the 8 criterion types individually. Unconfigured criteria always fail (see isCriterionUnconfigured()) regardless of `negate` - a half-built criterion shouldn't silently flip into "matches everything". */
function matchesCriterion(facts: NodeGroupFacts, criterion: GroupCriterion): boolean {
	if (isCriterionUnconfigured(criterion)) return false;
	const value = matchesCriterionValue(facts, criterion);
	return criterion.negate ? !value : value;
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

/** Whether any enabled group/preset has at least one `structuralDeviation` criterion - GraphPane only pays for Louvain community detection + per-note folder lookups when this is true. Same "own gate, not folded into needsClusterFreshness()" reasoning as needsContentSearch() being separate from this - clusterFreshness and structuralDeviation both need Louvain communities, but a vault using only one of the two shouldn't also pay for the other's folder-homogeneity pass. */
export function needsStructuralDeviation(owners: CriteriaOwner[]): boolean {
	return owners.some((o) => o.enabled && o.criteria.some((c) => c.type === 'structuralDeviation'));
}

/** Whether any enabled group/preset has at least one `betweenness` criterion - GraphPane only pays for betweenness centrality (graphAnalytics.ts, the most expensive of the four backlog-item-5 metrics) when this is true. */
export function needsBetweenness(owners: CriteriaOwner[]): boolean {
	return owners.some((o) => o.enabled && o.criteria.some((c) => c.type === 'betweenness'));
}

/** Whether any enabled group/preset has at least one `pageRank` criterion - GraphPane only pays for PageRank (graphAnalytics.ts) when this is true. */
export function needsPageRank(owners: CriteriaOwner[]): boolean {
	return owners.some((o) => o.enabled && o.criteria.some((c) => c.type === 'pageRank'));
}

/** Whether any enabled group/preset has at least one `isolatedComponent` criterion - GraphPane only pays for the connected-components pass (diagnostics.ts's findConnectedComponents()) when this is true. */
export function needsIsolatedComponent(owners: CriteriaOwner[]): boolean {
	return owners.some((o) => o.enabled && o.criteria.some((c) => c.type === 'isolatedComponent'));
}

/** Whether any enabled group/preset has at least one `community` criterion - GraphPane only pays for Louvain community detection when this is true (same "own gate" reasoning as needsStructuralDeviation() - a vault using only `community`, not `clusterFreshness`/`structuralDeviation`, shouldn't also pay for either of those). Communities are still detected once and shared across all three when more than one is active - see GraphPane's buildCriteriaFacts(). */
export function needsCommunity(owners: CriteriaOwner[]): boolean {
	return owners.some((o) => o.enabled && o.criteria.some((c) => c.type === 'community'));
}

/** Whether any enabled group/preset has at least one `semanticCluster` criterion - GraphPane only pays for embedding every note's content + clustering it (real I/O + CPU cost, and a one-time model download the first time) when this is true. Own gate, not folded into needsCommunity() - see SemanticClusterCriterion's own docstring for why the two are unrelated computations. */
export function needsSemanticClustering(owners: CriteriaOwner[]): boolean {
	return owners.some((o) => o.enabled && o.criteria.some((c) => c.type === 'semanticCluster'));
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
 * equals "done"`, `Folder is Archive`, `Folder is not Archive`) - GraphPane
 * shows this as a compact chip's label instead of always-visible
 * type-specific controls, so a group with several criteria reads as a
 * short list of chips rather than a wall of dropdowns/text fields (user
 * feedback: the criteria list was "unübersichtlich" - unclear/cluttered).
 * Every type except `property`/`clusterFreshness`/`structuralDeviation`
 * (which already offer an equivalent choice via their own operator/bucket)
 * reads `criterion.negate`
 * and flips its own wording accordingly ("is"/"is not", "contains"/"does
 * not contain", "any of"/"none of", "at least"/"less than" or "fewer
 * than") - graphPane.ts's renderCriterionEditRow() renders that same word
 * as the actual clickable include/exclude control (see GroupCriterion's
 * own `negate` docstring for why a plain include/exclude toggle read
 * poorly - "die Vorschläge sind alle noch nicht optimal" - and this
 * "the word IS the control" phrasing was chosen instead).
 */
export function describeCriterion(criterion: GroupCriterion): string {
	const negate = criterion.negate ?? false;
	switch (criterion.type) {
		case 'tag':
			return criterion.tags.length > 0 ? `Has ${negate ? 'none of' : 'any of'} ${criterion.tags.join(', ')}` : 'Tag: (none picked)';
		case 'property': {
			if (!criterion.key) return 'Property: (none picked)';
			if (criterion.operator === 'isEmpty' || criterion.operator === 'isNotEmpty') {
				return `${criterion.key} ${STRING_OPERATOR_LABELS[criterion.operator]}`;
			}
			return `${criterion.key} ${STRING_OPERATOR_LABELS[criterion.operator]} "${criterion.value || '…'}"`;
		}
		case 'folder':
			return `Folder ${negate ? 'is not' : 'is'} ${criterion.folder || '(none)'}`;
		case 'filename':
			return `Filename ${negate ? 'does not contain' : 'contains'} ${criterion.query ? `"${criterion.query}"` : '(none)'}`;
		case 'text':
			return `Text ${negate ? 'does not contain' : 'contains'} ${criterion.query ? `"${criterion.query}"` : '(none)'}`;
		case 'clusterFreshness':
			return criterion.bucket === 'stagnant' ? 'Activity: inactive area of the vault' : 'Activity: active area of the vault';
		case 'structuralDeviation':
			return criterion.bucket === 'scattered'
				? 'Structure: linked notes scattered across folders'
				: 'Structure: linked notes gathered in one folder';
		case 'betweenness':
			return criterion.bucket === 'high' ? 'Bridging: connects otherwise-separate notes' : 'Bridging: not a bridge note';
		case 'pageRank':
			return criterion.bucket === 'high' ? 'Prominence: a prominent note' : 'Prominence: not a prominent note';
		case 'isolatedComponent':
			return criterion.isolated ? "Connectivity: cut off from the vault's main body" : "Connectivity: in the vault's main body";
		case 'community':
			return `Community ${negate ? 'is not' : 'is'} ${criterion.communityId + 1}`;
		case 'semanticCluster':
			return `Semantic cluster ${negate ? 'is not' : 'is'} ${criterion.clusterId + 1}`;
		case 'staleDays':
			return `${negate ? 'Less than' : 'At least'} ${criterion.days} days ago`;
		case 'minLinks':
			return `${negate ? 'Fewer than' : 'At least'} ${criterion.count} links`;
		case 'existence':
			return criterion.exists ? 'Existing notes' : 'Nonexistent notes';
	}
}
