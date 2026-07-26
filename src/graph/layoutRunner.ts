import Graph from 'graphology';
import FA2LayoutSupervisor from 'graphology-layout-forceatlas2/worker';

/**
 * FA2LayoutSupervisor spawns and owns its own Web Worker internally (via
 * Function.prototype.toString() + a Blob URL - see its source), so there is
 * no separate worker file to build or inline here. It writes positions
 * straight onto the graphology graph's node attributes, which Sigma listens
 * to directly, so no manual render loop is needed either.
 */
export interface LayoutRunOptions {
	/** Wall-clock budget before the layout auto-stops. */
	durationMs?: number;
	barnesHutOptimize?: boolean;
	onSettled?: (elapsedMs: number) => void;
}

export interface LayoutRun {
	stop: () => void;
}

export function runLayout(graph: Graph, options: LayoutRunOptions = {}): LayoutRun {
	const { durationMs = 8000, barnesHutOptimize = true, onSettled } = options;

	const supervisor = new FA2LayoutSupervisor(graph, {
		settings: {
			barnesHutOptimize,
			strongGravityMode: true,
			gravity: 0.05,
			scalingRatio: 10,
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
