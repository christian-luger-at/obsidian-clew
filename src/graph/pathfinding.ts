import Graph from 'graphology';
import { bidirectional } from 'graphology-shortest-path/dijkstra';

/**
 * Yen's k-shortest-paths on top of graphology-shortest-path's weighted
 * Dijkstra. Hand-written because no graphology-ecosystem package offers
 * k-shortest-paths - the one npm package that does (`k-shortest-path`)
 * depends on graphlib, a different graph library entirely.
 *
 * Each candidate spur search runs against a throwaway `graph.copy()` with
 * the relevant nodes/edges removed, rather than mutating and restoring the
 * live graph - simpler and less error-prone than manual remove/restore
 * bookkeeping, at the cost of a copy per attempt (fine at the scale a
 * Bases-filtered graph is expected to be searched at; switch to
 * remove-then-restore if this turns out to be a hot path on huge graphs).
 */

export type PathResult = { found: false } | { found: true; paths: string[][] };

interface Candidate {
	path: string[];
	cost: number;
}

function pathCost(graph: Graph, path: string[]): number {
	let total = 0;
	for (let i = 0; i < path.length - 1; i++) {
		const edge = graph.edge(path[i]!, path[i + 1]!);
		if (edge === undefined) return Infinity;
		total += graph.getEdgeAttributes(edge).pathCost as number;
	}
	return total;
}

function samePrefix(path: string[], prefix: string[]): boolean {
	if (path.length < prefix.length) return false;
	for (let i = 0; i < prefix.length; i++) {
		if (path[i] !== prefix[i]) return false;
	}
	return true;
}

export function findPaths(graph: Graph, source: string, target: string, k = 5): PathResult {
	if (!graph.hasNode(source) || !graph.hasNode(target)) return { found: false };

	// graphology-shortest-path's own types don't reflect this, but its
	// bidirectional Dijkstra returns null (not an empty array) when no path
	// exists - confirmed by reading dijkstra.js directly.
	const shortest = bidirectional(graph, source, target, 'pathCost') as string[] | null;
	if (!shortest) return { found: false };

	const A: Candidate[] = [{ path: shortest, cost: pathCost(graph, shortest) }];
	const seen = new Set<string>([shortest.join('>')]);

	for (let ki = 1; ki < k; ki++) {
		const previous = A[ki - 1]!.path;
		const B: Candidate[] = [];

		for (let i = 0; i < previous.length - 1; i++) {
			const spurNode = previous[i]!;
			const rootPath = previous.slice(0, i + 1);

			const working = graph.copy();

			// Remove the edge each previously-found path takes out of this
			// same root, so the spur search can't just retrace one of them.
			for (const candidate of A) {
				if (candidate.path.length > i + 1 && samePrefix(candidate.path, rootPath)) {
					const from = candidate.path[i]!;
					const to = candidate.path[i + 1]!;
					if (working.hasEdge(from, to)) working.dropEdge(from, to);
				}
			}
			// Remove root-path nodes (except the spur node itself) so the
			// spur search can't loop back through the root path.
			for (const node of rootPath.slice(0, -1)) {
				if (working.hasNode(node)) working.dropNode(node);
			}

			if (!working.hasNode(spurNode)) continue;

			const spurPath = bidirectional(working, spurNode, target, 'pathCost') as string[] | null;
			if (!spurPath) continue;

			const totalPath = rootPath.slice(0, -1).concat(spurPath);
			const key = totalPath.join('>');
			if (seen.has(key) || B.some((c) => c.path.join('>') === key)) continue;

			B.push({ path: totalPath, cost: pathCost(graph, totalPath) });
		}

		if (B.length === 0) break;

		B.sort((a, b) => a.cost - b.cost);
		const next = B[0]!;
		seen.add(next.path.join('>'));
		A.push(next);
	}

	return { found: true, paths: A.map((c) => c.path) };
}
