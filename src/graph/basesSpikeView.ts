import { BasesView, QueryController } from 'obsidian';
import type Sigma from 'sigma';
import { createRenderer } from './renderer';
import { runLayout, LayoutRun } from './layoutRunner';
import { buildVaultGraph } from './vaultGraph';

/**
 * Spike-only Bases view (product-vision doc, section 6): validates that a
 * Bases-filtered node set + Obsidian's link graph + sigma.js/FA2 hold up at
 * vault scale. Kept as a standing dev-only perf/reference check (see
 * DEVELOPMENT.md and scripts/gen-graph-vault.mjs) - real usage happens
 * through graphView.ts's "Graph" view instead, which is where v1 features
 * like path finding live.
 */

export const CLEW_SPIKE_GRAPH_VIEW = 'clew-spike-graph';

export class SpikeGraphView extends BasesView {
	type = CLEW_SPIKE_GRAPH_VIEW;

	private containerEl: HTMLElement;
	private renderer: Sigma | null = null;
	private layout: LayoutRun | null = null;

	constructor(controller: QueryController, containerEl: HTMLElement) {
		super(controller);
		this.containerEl = containerEl;
		this.containerEl.classList.add('clew-spike-graph-view');
	}

	onDataUpdated(): void {
		this.layout?.stop();
		this.renderer?.kill();
		this.containerEl.empty();

		const graph = buildVaultGraph(
			this.app,
			this.data.data.map((entry) => entry.file),
		);
		this.renderer = createRenderer(graph, this.containerEl);
		this.layout = runLayout(graph, {
			durationMs: 6000,
			onSettled: (elapsedMs) => {
				console.debug(
					`[Clew spike] nodes=${graph.order} edges=${graph.size} settled in ${elapsedMs.toFixed(0)}ms`,
				);
			},
		});
	}

	onunload(): void {
		this.layout?.stop();
		this.renderer?.kill();
	}
}
