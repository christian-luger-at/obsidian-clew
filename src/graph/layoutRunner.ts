import Graph from 'graphology';
import FA2LayoutSupervisor from 'graphology-layout-forceatlas2/worker';

/**
 * FA2LayoutSupervisor spawns and owns its own Web Worker internally (via
 * Function.prototype.toString() + a Blob URL - see its source), so there is
 * no separate worker file to build or inline here. It writes positions
 * straight onto the graphology graph's node attributes, which Sigma listens
 * to directly, so no manual render loop is needed either.
 */
/**
 * Above this node count, Barnes-Hut's O(n log n) approximate repulsion is
 * used instead of exact O(n²) - below it, exact repulsion converges to an
 * actually-still layout (measured: a 300-node hub-heavy graph + 15 small
 * disconnected islands never settles under Barnes-Hut, oscillating
 * indefinitely at 250-500% of the whole layout's span moving *per 50
 * iterations* even after 2,000 iterations - visually reads as the graph
 * "wabert ewig" (wobbles forever). The same graph with exact repulsion
 * converges to <15% movement within ~1,000 iterations, well inside the
 * default settle budget). Exact repulsion isn't viable at every scale
 * though - measured directly: 50 iterations takes ~900ms at 2,000 nodes
 * (fine), ~5.8s at 5,000 (eats the whole settle budget for one block), and
 * would be completely impractical at the 10,000-node vault scale
 * (spike/DEVELOPMENT.md's stress test) - Barnes-Hut exists specifically for
 * that regime and is kept for it.
 */
const EXACT_REPULSION_NODE_LIMIT = 2000;

export interface LayoutRunOptions {
	/** Wall-clock budget before the layout auto-stops. */
	durationMs?: number;
	barnesHutOptimize?: boolean;
	/** Pull toward the center - user-tunable (Settings tab), see settings.ts's ClewAppearanceSettings.gravity. */
	gravity?: number;
	/** Overall repulsion/attraction force scale - user-tunable, see settings.ts's ClewAppearanceSettings.scalingRatio. */
	scalingRatio?: number;
	onSettled?: (elapsedMs: number) => void;
}

export interface LayoutRun {
	stop: () => void;
}

export function runLayout(graph: Graph, options: LayoutRunOptions = {}): LayoutRun {
	const {
		durationMs = 8000,
		barnesHutOptimize = graph.order > EXACT_REPULSION_NODE_LIMIT,
		gravity = 0.3,
		scalingRatio = 10,
		onSettled,
	} = options;

	const supervisor = new FA2LayoutSupervisor(graph, {
		settings: {
			barnesHutOptimize,
			// Must be true: normal (non-strong) gravity's pull weakens with
			// distance, so an isolated or weakly-connected note (a real
			// vault's disconnected/orphan notes - not something the
			// generateGraph.ts spike graph has, which is why this wasn't
			// caught the first time) can drift arbitrarily far once
			// repulsion pushes it past the point where gravity can still
			// reel it back in. Measured directly (a throwaway diagnostic
			// script, forceAtlas2.assign() against a 300-node cluster +15
			// small disconnected islands, not guessed): with this off, the
			// main cluster ended up occupying ~5% of the total layout
			// extent regardless of gravity/scalingRatio - i.e. camera
			// auto-fit had to zoom out ~20x to include the drifted islands,
			// shrinking the connected cluster into what reads as a solid
			// black blob of overlapping nodes/edges. With this on, the
			// constant (distance-independent) restoring pull keeps islands
			// near the main cluster instead.
			strongGravityMode: true,
			gravity,
			scalingRatio,
		},
	});

	const startedAt = performance.now();
	let settled = false;

	const stop = () => {
		if (settled) return;
		settled = true;
		supervisor.stop();
		supervisor.kill();
		onSettled?.(performance.now() - startedAt);
	};

	supervisor.start();
	const timer = window.setTimeout(stop, durationMs);

	return {
		stop: () => {
			window.clearTimeout(timer);
			stop();
		},
	};
}
