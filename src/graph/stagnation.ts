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

/**
 * 0 (freshest community present) to 1 (stalest community present) - relative
 * to the current graph, not a fixed time window, since "stale" means very
 * different things in an actively maintained vault vs. an archive. Backs
 * nodeGroups.ts's `clusterFreshness` criterion (a note's group membership
 * depends on its community's staleness relative to every other community
 * present, not an absolute cutoff).
 */
export function staleness(newestMtime: number, minNewest: number, maxNewest: number): number {
	if (maxNewest === minNewest) return 0;
	return 1 - (newestMtime - minNewest) / (maxNewest - minNewest);
}

/**
 * GitHub issue #5, "Stagnation-Cluster gegen Ordner-/Tag-Struktur
 * vergleichen": how much a Louvain community (a group of notes that link to
 * each other tightly enough to read as "the same topic" - see
 * detectCommunities()) agrees with the vault's own folder structure. 1 =
 * every note in the community shares the same folder (`folderOf`) -
 * perfectly consolidated. Approaching 0 = the community's notes are spread
 * across many different folders despite linking each other heavily - "these
 * 8 notes belong together by link topology, but live in 5 different
 * folders", the exact case this backlog item exists to surface. Computed as
 * the share of the community sharing its single *most common* folder, not
 * an average pairwise-same-folder rate or a folder-count-based formula -
 * simpler to compute, and reads directly as "X out of N notes are where you'd
 * expect, given the rest of this group". An absolute 0-1 value (unlike
 * staleness() above, which is normalized relative to whichever communities
 * happen to be present) - "half its notes share a folder" means the same
 * thing regardless of what else is in the vault, so there's nothing to
 * normalize against. `folderOf` is injected (not `app.metadataCache` read
 * directly) for the same Obsidian-App-free-unit-testability reason every
 * other function in this file takes plain data in.
 *
 * A community of 0 notes (shouldn't happen in practice - detectCommunities()
 * never produces an empty group - but a caller could still pass one) returns
 * 1 (vacuously "fully consolidated": there's nothing scattered to report).
 */
export function communityHomogeneity(community: string[], folderOf: (nodeId: string) => string): number {
	if (community.length === 0) return 1;
	const countByFolder = new Map<string, number>();
	for (const nodeId of community) {
		const folder = folderOf(nodeId);
		countByFolder.set(folder, (countByFolder.get(folder) ?? 0) + 1);
	}
	const maxCount = Math.max(...countByFolder.values());
	return maxCount / community.length;
}
