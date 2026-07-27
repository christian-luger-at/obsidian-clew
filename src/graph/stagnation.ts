import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';

/**
 * Doc section 3.3: Louvain community detection, then per-community mtime
 * distribution (newest/median/count) to surface stale clusters - ~90% of a
 * time-slider's value at ~10% of the complexity, computable today with no
 * history reconstruction.
 */

export interface CommunityStats {
	communityId: number;
	nodeIds: string[];
	noteCount: number;
	/** Most recent edit in the community - the actual "is this stagnant" signal. */
	newestMtime: number;
	medianMtime: number;
}

/**
 * Maps each node to a community id. Explicitly unweighted (`getEdgeWeight:
 * null`): community detection should follow link topology only. The
 * graph's `pathCost` edge attribute (see vaultGraph.ts) encodes hub-avoidance
 * for pathfinding.ts, a different concept entirely, and must not leak in
 * here - graphology-communities-louvain defaults to reading an edge
 * attribute literally named `weight` otherwise, same pitfall already hit
 * with graphology-layout-forceatlas2.
 */
export function detectCommunities(graph: Graph): Map<string, number> {
	const mapping = louvain(graph, { getEdgeWeight: null });
	return new Map(Object.entries(mapping));
}

export function computeCommunityStats(
	communities: Map<string, number>,
	mtimeOf: (nodeId: string) => number,
): CommunityStats[] {
	const byCommunity = new Map<number, string[]>();
	for (const [nodeId, communityId] of communities) {
		if (!byCommunity.has(communityId)) byCommunity.set(communityId, []);
		byCommunity.get(communityId)!.push(nodeId);
	}

	const stats: CommunityStats[] = [];
	for (const [communityId, nodeIds] of byCommunity) {
		const mtimes = nodeIds.map(mtimeOf).sort((a, b) => a - b);
		stats.push({
			communityId,
			nodeIds,
			noteCount: nodeIds.length,
			newestMtime: mtimes[mtimes.length - 1]!,
			medianMtime: mtimes[Math.floor(mtimes.length / 2)]!,
		});
	}
	return stats;
}

// Defaults only - GraphPane passes theme-derived colors (see theme.ts) so
// the heatmap's gradient endpoints stay theme-aware; these keep this module
// usable (and its existing tests valid) without any Obsidian/DOM context.
const DEFAULT_FRESH_COLOR: [number, number, number] = [59, 130, 246]; // blue-500
const DEFAULT_STALE_COLOR: [number, number, number] = [239, 68, 68]; // red-500

/**
 * 0 (freshest community present) to 1 (stalest community present) - relative
 * to the current graph, not a fixed time window, since "stale" means very
 * different things in an actively maintained vault vs. an archive.
 */
export function staleness(newestMtime: number, minNewest: number, maxNewest: number): number {
	if (maxNewest === minNewest) return 0;
	return 1 - (newestMtime - minNewest) / (maxNewest - minNewest);
}

export function stalenessColor(
	t: number,
	freshRgb: [number, number, number] = DEFAULT_FRESH_COLOR,
	staleRgb: [number, number, number] = DEFAULT_STALE_COLOR,
): string {
	const clamped = Math.max(0, Math.min(1, t));
	const [r, g, b] = freshRgb.map((from, i) => Math.round(from + (staleRgb[i]! - from) * clamped));
	return `rgb(${r}, ${g}, ${b})`;
}

export function formatRelativeTime(mtime: number): string {
	const diffMs = Date.now() - mtime;
	const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
	if (days < 1) return 'today';
	if (days === 1) return '1 day ago';
	if (days < 30) return `${days} days ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`;
	const years = Math.floor(months / 12);
	return years === 1 ? '1 year ago' : `${years} years ago`;
}
