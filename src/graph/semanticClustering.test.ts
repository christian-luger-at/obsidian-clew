import { describe, it, expect } from 'vitest';
import { buildSimilarityGraph, cosineSimilarity, detectSemanticClusters } from './semanticClustering';

/** A unit vector in a `dims`-dimensional space, nudged slightly off-axis by `noise` (deterministic, not random - a real embedding model never gives two different notes the exact same vector even on the same topic, and these tests want to prove clustering survives that, not just the noiseless ideal case). */
function vector(dims: number, axis: number, noise = 0): Float32Array {
	const v = new Float32Array(dims);
	v[axis] = 1;
	if (noise !== 0) v[(axis + 1) % dims] = noise;
	// Re-normalize to unit length, same as embeddingModel.ts's embedText() (`normalize: true`) - cosineSimilarity() assumes this.
	let mag = 0;
	for (const x of v) mag += x * x;
	mag = Math.sqrt(mag);
	for (let i = 0; i < v.length; i++) v[i] = v[i]! / mag;
	return v;
}

describe('semanticClustering', () => {
	describe('cosineSimilarity', () => {
		it('is 1 for identical unit vectors', () => {
			const a = vector(4, 0);
			expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
		});

		it('is 0 for orthogonal unit vectors', () => {
			const a = vector(4, 0);
			const b = vector(4, 1);
			expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
		});

		it('is close to but not exactly 1 for slightly nudged vectors', () => {
			const a = vector(4, 0);
			const b = vector(4, 0, 0.1);
			const sim = cosineSimilarity(a, b);
			expect(sim).toBeLessThan(1);
			expect(sim).toBeGreaterThan(0.9);
		});
	});

	describe('buildSimilarityGraph', () => {
		it('adds a node for every path, even ones with no vector yet', () => {
			const vectors = new Map([['a', vector(4, 0)]]);
			const graph = buildSimilarityGraph(['a', 'b'], vectors);
			expect(graph.order).toBe(2);
			expect(graph.hasNode('b')).toBe(true);
			expect(graph.degree('b')).toBe(0);
		});

		it('connects notes above the similarity floor, not ones below it', () => {
			const vectors = new Map([
				['near-1', vector(4, 0)],
				['near-2', vector(4, 0, 0.05)],
				['far', vector(4, 2)],
			]);
			const graph = buildSimilarityGraph(['near-1', 'near-2', 'far'], vectors);
			expect(graph.hasEdge('near-1', 'near-2')).toBe(true);
			expect(graph.hasEdge('near-1', 'far')).toBe(false);
			expect(graph.hasEdge('near-2', 'far')).toBe(false);
		});

		it('stays below a fully-connected graph when capped to a small top-K', () => {
			// 5 near-identical vectors (all similar enough to cluster with
			// each other) - a fully-connected graph would have 10 edges
			// (5 choose 2). Each node only ever contributes edges to its own
			// top-K=2 nearest neighbors (a node's *total* degree can still
			// exceed K if other nodes independently pick it back - kNN graphs
			// aren't symmetric per-node caps - but the graph as a whole should
			// stay well short of fully connected).
			const paths = ['a', 'b', 'c', 'd', 'e'];
			const vectors = new Map(paths.map((p, i) => [p, vector(8, 0, i * 0.01)]));
			const graph = buildSimilarityGraph(paths, vectors, 2, 0.5);
			expect(graph.size).toBeLessThan(10);
		});
	});

	describe('detectSemanticClusters', () => {
		it('groups two tight vector clusters separately, ranked by size', () => {
			// 3 near-identical vectors on axis 0 (bigger cluster), 2 on axis 1
			// (smaller cluster) - completely unrelated to any *link* structure,
			// which is the whole point (GitHub backlog item 16's "Ziel").
			const vectors = new Map<string, Float32Array>([
				['topic-a-1', vector(6, 0)],
				['topic-a-2', vector(6, 0, 0.02)],
				['topic-a-3', vector(6, 0, -0.02)],
				['topic-b-1', vector(6, 1)],
				['topic-b-2', vector(6, 1, 0.02)],
			]);
			const paths = [...vectors.keys()];
			const clusters = detectSemanticClusters(paths, vectors);

			expect(clusters.get('topic-a-1')).toBe(clusters.get('topic-a-2'));
			expect(clusters.get('topic-a-2')).toBe(clusters.get('topic-a-3'));
			expect(clusters.get('topic-b-1')).toBe(clusters.get('topic-b-2'));
			expect(clusters.get('topic-a-1')).not.toBe(clusters.get('topic-b-1'));

			// Ranked by size: the 3-note cluster is rank 0, the 2-note one rank 1.
			expect(clusters.get('topic-a-1')).toBe(0);
			expect(clusters.get('topic-b-1')).toBe(1);
		});

		it('gives an unrelated note its own cluster rather than forcing it into the nearest one', () => {
			const vectors = new Map<string, Float32Array>([
				['a1', vector(6, 0)],
				['a2', vector(6, 0, 0.02)],
				['a3', vector(6, 0, -0.02)],
				['unrelated', vector(6, 3)],
			]);
			const paths = [...vectors.keys()];
			const clusters = detectSemanticClusters(paths, vectors);
			expect(clusters.get('unrelated')).not.toBe(clusters.get('a1'));
		});

		it('every path gets a cluster id, including ones with no vector at all', () => {
			const vectors = new Map<string, Float32Array>([['a', vector(4, 0)]]);
			const clusters = detectSemanticClusters(['a', 'no-vector'], vectors);
			expect(clusters.get('a')).toBeDefined();
			expect(clusters.get('no-vector')).toBeDefined();
		});
	});
});
