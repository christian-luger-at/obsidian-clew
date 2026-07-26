/**
 * Deterministic synthetic graph generator, shared by the browser harness
 * (spike/) and the test-vault generator (scripts/gen-graph-vault.mjs), so
 * both exercise the same structure.
 *
 * Uses Barabási–Albert preferential attachment: new nodes preferentially
 * connect to already well-connected ones. This produces the hub-heavy,
 * small-world shape real vaults have (a handful of MOC/index-like notes
 * with high degree), which is what later motivates hub-pollution
 * mitigation in path finding - see the product-vision doc, section 3.2.
 */

export interface GeneratedNode {
	id: string;
	label: string;
	/** Marks the ~1% of nodes used to exercise custom (image) node rendering. */
	hasImage: boolean;
}

export interface GeneratedEdge {
	source: string;
	target: string;
}

export interface GeneratedGraph {
	nodes: GeneratedNode[];
	edges: GeneratedEdge[];
}

export interface GenerateGraphOptions {
	nodeCount: number;
	/** Edges attached per new node (Barabási–Albert "m" parameter). */
	edgesPerNode?: number;
	seed?: number;
}

/** mulberry32 - small, fast, deterministic PRNG. */
function mulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function generateGraph(options: GenerateGraphOptions): GeneratedGraph {
	const { nodeCount, edgesPerNode = 3, seed = 1 } = options;
	const rng = mulberry32(seed);

	const nodes: GeneratedNode[] = [];
	const edges: GeneratedEdge[] = [];
	// Repeated target list weighted by degree: each edge endpoint appears
	// once per edge it's part of, so sampling uniformly from this array is
	// equivalent to sampling proportional to degree (standard BA trick).
	const degreeSamples: string[] = [];

	const seedSize = Math.min(edgesPerNode + 1, nodeCount);
	for (let i = 0; i < seedSize; i++) {
		const id = `note-${i}`;
		nodes.push({ id, label: `Note ${i}`, hasImage: false });
	}
	// Seed clique so early preferential attachment has something to sample from.
	for (let i = 0; i < seedSize; i++) {
		for (let j = i + 1; j < seedSize; j++) {
			edges.push({ source: nodes[i]!.id, target: nodes[j]!.id });
			degreeSamples.push(nodes[i]!.id, nodes[j]!.id);
		}
	}

	for (let i = seedSize; i < nodeCount; i++) {
		const id = `note-${i}`;
		nodes.push({ id, label: `Note ${i}`, hasImage: false });

		const targets = new Set<string>();
		const attempts = edgesPerNode * 4;
		for (let a = 0; a < attempts && targets.size < edgesPerNode; a++) {
			const candidate = degreeSamples[Math.floor(rng() * degreeSamples.length)];
			if (candidate && candidate !== id) targets.add(candidate);
		}
		// Fallback for the rare case degree-sampling didn't find enough distinct targets.
		while (targets.size < Math.min(edgesPerNode, i)) {
			const candidate = nodes[Math.floor(rng() * i)]!.id;
			if (candidate !== id) targets.add(candidate);
		}

		for (const target of targets) {
			edges.push({ source: id, target });
			degreeSamples.push(id, target);
		}
	}

	const imageEvery = Math.max(1, Math.floor(nodeCount / 100));
	for (let i = 0; i < nodes.length; i += imageEvery) {
		nodes[i]!.hasImage = true;
	}

	return { nodes, edges };
}
