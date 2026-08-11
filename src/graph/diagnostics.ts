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

/**
 * A node this module's own structural checks should treat as "not a real
 * note" - vaultGraph.ts's ghost nodes (`kind: 'ghost'`), and, once backlog
 * items 11/15 ("Tags als Knoten"/"Attachments als Knoten") are turned on,
 * its tag/attachment nodes too. All three are opt-in graph decorations, not
 * notes - an orphan/isolated-cluster check counting a heavily-used tag as
 * a normal note, or treating two notes that both happen to embed the same
 * image as "connected" through it, would be exactly the same "illusory
 * bridge" problem ghost nodes were already excluded for (see
 * findConnectedComponents()'s own docstring), just via a different kind of
 * non-note node.
 */
function isNonNoteKind(kind: unknown): boolean {
	return kind === 'ghost' || kind === 'tag' || kind === 'attachment';
}

/**
 * A note with no links to (or from) another *real* note - not quite plain
 * `graph.degree(node) === 0`, since a note whose only link is to a
 * nonexistent note (vaultGraph.ts's ghost nodes, `kind: 'ghost'`) still has
 * degree 1, but has nothing real to show for it either; counting that as
 * "not an orphan" would be misleading. Ghost nodes themselves are also
 * skipped outright - they're not notes, and always have at least one edge
 * by construction (see vaultGraph.ts's addGhostNodes()) so `degree === 0`
 * could never apply to one anyway. Sorted by display name so the panel's
 * list order is stable and readable, not insertion order.
 */
export function findOrphans(graph: Graph): string[] {
	const orphans: string[] = [];
	graph.forEachNode((node, attr) => {
		if (isNonNoteKind(attr.kind)) return;
		let hasRealNeighbor = false;
		graph.forEachNeighbor(node, (_neighbor, neighborAttr) => {
			if (!isNonNoteKind(neighborAttr.kind)) hasRealNeighbor = true;
		});
		if (!hasRealNeighbor) orphans.push(node);
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
 *
 * Ghost nodes (vaultGraph.ts's `kind: 'ghost'`) are excluded from the
 * traversal entirely, not just from the result - two notes that each
 * happen to link to the same nonexistent note would otherwise read as
 * "connected" through it, an illusory bridge through a note that doesn't
 * exist rather than a real structural link between them.
 */
export function findConnectedComponents(graph: Graph): string[][] {
	const seen = new Set<string>();
	const components: string[][] = [];

	graph.forEachNode((start, startAttr) => {
		if (isNonNoteKind(startAttr.kind) || seen.has(start)) return;
		const component: string[] = [];
		const queue = [start];
		seen.add(start);
		while (queue.length > 0) {
			const node = queue.shift()!;
			component.push(node);
			graph.forEachNeighbor(node, (neighbor, neighborAttr) => {
				if (isNonNoteKind(neighborAttr.kind) || seen.has(neighbor)) return;
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
