import Graph from 'graphology';
import { basename } from './pathfinding';

/**
 * Pure, Obsidian-App-free structural checks over the vault graph, backing
 * the Diagnostics panel in graphPane.ts (feature-list item "Strukturelle
 * Diagnose-Panels"): orphaned notes, unresolved (broken) links, and
 * clusters of notes disconnected from the vault's main body of notes.
 * Same boundary as filter.ts/nodeGroups.ts/stagnation.ts/pathfinding.ts -
 * takes plain graph/data structures in, so this is unit-testable without a
 * real vault.
 */

/** A note with no links in or out - `graph.degree(node) === 0`. Sorted by display name so the panel's list order is stable and readable, not insertion order. */
export function findOrphans(graph: Graph): string[] {
	const orphans: string[] = [];
	graph.forEachNode((node) => {
		if (graph.degree(node) === 0) orphans.push(node);
	});
	return orphans.sort((a, b) => basename(a).localeCompare(basename(b)));
}

export interface BrokenLink {
	/** The note containing the link. */
	source: string;
	/** The unresolved link text/target that doesn't match any file. */
	target: string;
}

/**
 * Flattens Obsidian's `app.metadataCache.unresolvedLinks` (a source path ->
 * unresolved-target-text -> mention-count map) into one row per broken
 * link, restricted to `sourcePaths` (the graph's own file set - vaults
 * commonly have unresolved links from notes outside whatever subset is
 * currently loaded, e.g. under an active filter's *previous* file set,
 * which shouldn't surface here). Takes the raw map rather than the App
 * itself, same reasoning as the rest of this module - callers pass
 * `app.metadataCache.unresolvedLinks` in.
 */
export function findBrokenLinks(unresolvedLinks: Record<string, Record<string, number>>, sourcePaths: Set<string>): BrokenLink[] {
	const links: BrokenLink[] = [];
	for (const [source, targets] of Object.entries(unresolvedLinks)) {
		if (!sourcePaths.has(source)) continue;
		for (const target of Object.keys(targets)) {
			links.push({ source, target });
		}
	}
	return links.sort((a, b) => basename(a.source).localeCompare(basename(b.source)) || a.target.localeCompare(b.target));
}

/**
 * Every connected component of the graph (undirected reachability, ignoring
 * edge direction even on a directed graph - "can you get from A to B at
 * all, in either direction" is the structural question here, not
 * pathfinding.ts's directed-aware routing), largest first. A component of
 * size 1 is just an orphan (see findOrphans()) and is included here too -
 * callers that want *only* the disconnected-but-internally-linked clusters
 * (the Diagnostics panel's use case) should drop the first (largest, i.e.
 * "the vault's main body of notes") entry and any remaining size-1 ones.
 */
export function findConnectedComponents(graph: Graph): string[][] {
	const seen = new Set<string>();
	const components: string[][] = [];

	graph.forEachNode((start) => {
		if (seen.has(start)) return;
		const component: string[] = [];
		const queue = [start];
		seen.add(start);
		while (queue.length > 0) {
			const node = queue.shift()!;
			component.push(node);
			graph.forEachNeighbor(node, (neighbor) => {
				if (seen.has(neighbor)) return;
				seen.add(neighbor);
				queue.push(neighbor);
			});
		}
		components.push(component);
	});

	return components.sort((a, b) => b.length - a.length);
}

/**
 * findConnectedComponents(), narrowed to the Diagnostics panel's actual
 * question: "which small pockets of notes are cut off from the rest of the
 * vault?" - drops the single largest component (the vault's main body -
 * not "disconnected" from anything, it *is* the graph everyone else is
 * disconnected from) and every remaining size-1 component (already
 * surfaced, with more relevant framing, by findOrphans()). An empty graph
 * or one that's already a single connected whole both correctly yield [].
 */
export function findIsolatedClusters(graph: Graph): string[][] {
	const components = findConnectedComponents(graph);
	return components.slice(1).filter((component) => component.length > 1);
}
