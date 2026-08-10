import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';

/**
 * GitHub backlog item 16, "Semantisches Clustering": groups notes by what
 * they're actually about (cosine similarity between title+content
 * embeddings - see embeddingModel.ts for how those vectors are produced),
 * independent of whether anything links them - the whole point, per that
 * item's own "Ziel". Kept Obsidian-app-free and free of the embedding
 * model itself (see embeddingModel.ts's own docstring for why that's a
 * separate file) - GraphPane supplies pre-computed vectors, this module
 * only ever does graph/vector math, so it's unit-testable with synthetic
 * vectors and no network/WASM/model download involved at all.
 */

/** How many of a note's nearest (by cosine similarity) neighbors become candidate edges in the similarity graph - same "top-K, not a fully-connected graph" reasoning any nearest-neighbor clustering uses: a note similar to everything (a generic "Inbox" note, say) would otherwise flood every other note with a low-weight edge to it, diluting Louvain's own modularity signal. */
const SIMILARITY_KNN = 8;

/** Below this cosine similarity, even a note's single closest neighbor isn't a real semantic edge - without this floor, a small or topically scattered vault would still force every note into *some* cluster via its nearest (if barely related) neighbor, defeating the point of "unrelated notes stay ungrouped" (mirrors the spike's own "Isolated" note scoring 0.03-0.13 against everything - see DEVELOPMENT.md). 0.35 sits comfortably below the ~0.75+ range same-topic notes scored in that spike, while still ruling out near-zero/negative similarity. */
const SIMILARITY_MIN = 0.35;

/**
 * Vectors from embeddingModel.ts's embedText() are already L2-normalized
 * (`normalize: true`), so their dot product already *is* the cosine
 * similarity - no separate magnitude division needed. A caller passing
 * unnormalized vectors would get a wrong (but not crashing) result; every
 * vector this module ever receives from GraphPane goes through embedText()
 * first, so this is never a real concern in practice.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
	let dot = 0;
	for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
	return dot;
}

/**
 * A note-similarity graph: one node per path with a vector, an (undirected,
 * weighted) edge to each of its top-`knn` neighbors whose similarity clears
 * `minSimilarity`. A path with no vector (embedding still pending, or the
 * note was skipped) gets a node with no edges - Louvain still assigns it a
 * (singleton) community below, which is the correct "nothing to cluster it
 * with yet" outcome rather than an error.
 */
export function buildSimilarityGraph(
	paths: string[],
	vectors: Map<string, Float32Array>,
	knn: number = SIMILARITY_KNN,
	minSimilarity: number = SIMILARITY_MIN,
): Graph {
	const graph = new Graph({ type: 'undirected' });
	for (const path of paths) graph.addNode(path);

	for (const path of paths) {
		const vector = vectors.get(path);
		if (!vector) continue;
		const neighbors = paths
			.filter((other) => other !== path && vectors.has(other))
			.map((other) => ({ other, sim: cosineSimilarity(vector, vectors.get(other)!) }))
			.filter((entry) => entry.sim >= minSimilarity)
			.sort((a, b) => b.sim - a.sim)
			.slice(0, knn);
		for (const { other, sim } of neighbors) {
			// The reverse edge may already exist from `other`'s own top-K pass
			// (similarity is symmetric, but "is A in B's top-K" and "is B in
			// A's top-K" aren't - only one direction needs to have picked it
			// for the edge to exist at all, same as any kNN graph).
			if (!graph.hasEdge(path, other)) graph.addEdge(path, other, { weight: sim });
		}
	}
	return graph;
}

/**
 * Louvain over the similarity graph (buildSimilarityGraph() above),
 * weighted by cosine similarity (`getEdgeWeight: 'weight'` - explicit, not
 * left to the library's own default, same "don't silently pick up the
 * wrong attribute" caution as stagnation.ts's detectCommunities()), then
 * re-numbered by size the same way GraphPane's rankCommunitiesBySize()
 * re-numbers Louvain's own link-graph communities: 0 = the largest semantic
 * cluster present, so `semanticCluster` criterion ids stay meaningful
 * across re-runs instead of depending on Louvain's arbitrary internal
 * numbering.
 */
export function detectSemanticClusters(paths: string[], vectors: Map<string, Float32Array>): Map<string, number> {
	const graph = buildSimilarityGraph(paths, vectors);
	const mapping = louvain(graph, { getEdgeWeight: 'weight' });

	const sizeByRawId = new Map<number, number>();
	for (const rawId of Object.values(mapping)) sizeByRawId.set(rawId, (sizeByRawId.get(rawId) ?? 0) + 1);
	const rankedRawIds = [...sizeByRawId.keys()].sort((a, b) => sizeByRawId.get(b)! - sizeByRawId.get(a)!);
	const rankByRawId = new Map(rankedRawIds.map((id, rank) => [id, rank]));

	const result = new Map<string, number>();
	for (const [path, rawId] of Object.entries(mapping)) result.set(path, rankByRawId.get(rawId)!);
	return result;
}
