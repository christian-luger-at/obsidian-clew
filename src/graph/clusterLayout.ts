import Graph from 'graphology';
import { detectCommunities } from './stagnation';

/**
 * A sixth layout (research: Rang 13, "welche Layouts gibt es noch, die
 * sinnvoll wären" -> cluster layout, third recommendation): pulls each
 * detected community into its own visually separate region, instead of
 * only telling communities apart by color the way a Color & size
 * "Community" group does. At a large, densely-linked vault, Force's own
 * organic clustering can leave communities visually blended into one
 * blob even when they're colored differently - this answers "where does
 * one community end and another begin?" directly, spatially.
 *
 * Reuses stagnation.ts's detectCommunities() (the same Louvain run backing
 * Color & size's Community criterion and the Diagnostics panel) rather
 * than a second detection pass - one canonical community assignment, not
 * two that could disagree.
 *
 * No physics simulation - each community's members are packed into a
 * circular "blob" with a sunflower/phyllotaxis spiral (the standard
 * evenly-distributed circular point packing: golden-angle rotation per
 * point, radius growing with sqrt(index)), and blob centers are placed
 * evenly around one coarse outer circle, ordered by community id for
 * determinism. Simpler and synchronous, unlike Force's Worker-based
 * ForceAtlas2 - matches every other non-Force layout module's "pure
 * function, no async settle" shape (radialLayout.ts, circularLayout.ts,
 * timelineLayout.ts).
 */

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Default spacing between successive points in a community's own spiral - user-tunable (ClewAppearanceSettings.clusterPointSpacing). */
const DEFAULT_POINT_SPACING = 12;

/** Default spacing between community centers around the outer circle - user-tunable (ClewAppearanceSettings.clusterSpacing). */
const DEFAULT_CLUSTER_SPACING = 300;

export function computeClusterLayout(
	graph: Graph,
	pointSpacing: number = DEFAULT_POINT_SPACING,
	clusterSpacing: number = DEFAULT_CLUSTER_SPACING,
): void {
	if (graph.order === 0) return;

	const communities = detectCommunities(graph);
	const nodesByCommunity = new Map<number, string[]>();
	for (const [node, communityId] of communities) {
		const bucket = nodesByCommunity.get(communityId);
		if (bucket) bucket.push(node);
		else nodesByCommunity.set(communityId, [node]);
	}

	// Sorted by id, not Map iteration order - same determinism guarantee as
	// every other layout module (e.g. radialLayout.ts's per-ring sort): the
	// same graph should always produce the same arrangement.
	const communityIds = [...nodesByCommunity.keys()].sort((a, b) => a - b);

	const centerRadius = communityIds.length <= 1 ? 0 : (communityIds.length * clusterSpacing) / (2 * Math.PI);

	communityIds.forEach((communityId, i) => {
		const angle = (i / communityIds.length) * 2 * Math.PI;
		const center = { x: centerRadius * Math.cos(angle), y: centerRadius * Math.sin(angle) };
		const members = [...nodesByCommunity.get(communityId)!].sort();
		placeSpiral(graph, members, center, pointSpacing);
	});
}

/** Packs `nodes` into a sunflower-seed spiral centered on `center` - a well-distributed circular "blob" with no crossing-minimization or physics needed. */
function placeSpiral(graph: Graph, nodes: string[], center: { x: number; y: number }, pointSpacing: number): void {
	nodes.forEach((node, i) => {
		const radius = pointSpacing * Math.sqrt(i + 0.5);
		const angle = i * GOLDEN_ANGLE;
		graph.setNodeAttribute(node, 'x', center.x + radius * Math.cos(angle));
		graph.setNodeAttribute(node, 'y', center.y + radius * Math.sin(angle));
	});
}
