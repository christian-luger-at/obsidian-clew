import { BasesView, QueryController, TFile } from 'obsidian';
import Graph from 'graphology';
import type Sigma from 'sigma';
import { createRenderer } from './renderer';
import { runLayout, LayoutRun } from './layoutRunner';

/**
 * Spike-only Bases view (product-vision doc, section 6): validates that a
 * Bases-filtered node set + Obsidian's link graph + sigma.js/FA2 hold up at
 * vault scale. This is provisional - it gets replaced, not extended, once
 * real v1 view design starts.
 *
 * Bases gives the node set only (this.data.data). Edges aren't part of
 * Bases at all - they come from app.metadataCache.resolvedLinks, filtered
 * down to pairs where both endpoints are in the current Bases result. That
 * filtering is also a free preview of the "Ausschluss per Bases-Filter"
 * idea from the path-finding feature (doc section 3.2).
 */

export const CLEW_SPIKE_GRAPH_VIEW = 'clew-spike-graph';

const GRAPH_COLOR = '#7c3aed';
const IMAGE_NODE_COLOR = '#f59e0b';

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

		const graph = this.buildGraph();
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

	private buildGraph(): Graph {
		const graph = new Graph();
		const nodePaths = new Set(this.data.data.map((entry) => entry.file.path));

		for (const entry of this.data.data) {
			const cover = entry.getValue('note.cover');
			const image = cover?.isTruthy() ? this.resolveImage(cover.toString()) : undefined;
			graph.addNode(entry.file.path, {
				label: entry.file.basename,
				x: Math.random(),
				y: Math.random(),
				size: image ? 6 : 3,
				color: image ? IMAGE_NODE_COLOR : GRAPH_COLOR,
				type: image ? 'image' : undefined,
				image,
			});
		}

		const resolvedLinks = this.app.metadataCache.resolvedLinks;
		for (const sourcePath of nodePaths) {
			const targets = resolvedLinks[sourcePath];
			if (!targets) continue;
			for (const targetPath of Object.keys(targets)) {
				if (targetPath === sourcePath) continue;
				if (!nodePaths.has(targetPath)) continue; // Bases-filtered subgraph
				if (graph.hasEdge(sourcePath, targetPath) || graph.hasEdge(targetPath, sourcePath)) continue;
				graph.addEdge(sourcePath, targetPath);
			}
		}

		return graph;
	}

	/** The real risk being tested: loading a vault image into a WebGL texture via getResourcePath(). */
	private resolveImage(vaultRelativePath: string): string | undefined {
		const file = this.app.vault.getAbstractFileByPath(vaultRelativePath);
		if (!(file instanceof TFile)) return undefined;
		return this.app.vault.getResourcePath(file);
	}
}
