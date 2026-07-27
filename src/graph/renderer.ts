import Graph from 'graphology';
import Sigma from 'sigma';
import { NodeImageProgram } from '@sigma/node-image';
import { GeneratedGraph } from './generateGraph';

const GRAPH_COLOR = '#7c3aed';
const IMAGE_NODE_COLOR = '#f59e0b';

/** Builds a graphology graph from generated data, with random initial positions (required before running FA2) and node styling. */
export function buildGraph(data: GeneratedGraph, imageUrlForNode: (nodeId: string) => string | undefined): Graph {
	const graph = new Graph();

	for (const node of data.nodes) {
		const image = node.hasImage ? imageUrlForNode(node.id) : undefined;
		graph.addNode(node.id, {
			label: node.label,
			x: Math.random(),
			y: Math.random(),
			size: image ? 6 : 3,
			color: image ? IMAGE_NODE_COLOR : GRAPH_COLOR,
			type: image ? 'image' : undefined,
			image,
		});
	}
	for (const edge of data.edges) {
		if (!graph.hasEdge(edge.source, edge.target)) {
			graph.addEdge(edge.source, edge.target);
		}
	}

	return graph;
}

export function createRenderer(graph: Graph, container: HTMLElement, defaultEdgeColor = '#888888', labelColor = '#dcddde'): Sigma {
	return new Sigma(graph, container, {
		nodeProgramClasses: { image: NodeImageProgram },
		renderEdgeLabels: false,
		// At vault scale (tens of thousands of edges) even a fairly
		// transparent edge color saturates into a solid mass once enough
		// lines overlap - low alpha here matters more than it looks like it
		// should in isolation. Caller (GraphPane) passes a theme-derived
		// color (see theme.ts); the default here only matters for the spike
		// harness, which has no Obsidian theme to read.
		defaultEdgeColor,
		// sigma's own default is a hardcoded black ('#000') - unreadable
		// against a dark theme's canvas. Caller passes a theme-derived color
		// (see theme.ts's labelColor); the default here only matters for the
		// spike harness.
		labelColor: { color: labelColor },
		hideEdgesOnMove: true,
		// Level-of-detail: without this, sigma renders a label for nearly
		// every node regardless of zoom, which is unreadable at vault scale
		// (thousands of overlapping labels). Raising the threshold means a
		// node's on-screen size has to cross it before its label shows, so
		// only hub nodes (sized bigger via sizeNodesByDegree in
		// vaultGraph.ts) label at low zoom - zooming in grows every node's
		// screen size and progressively reveals the rest.
		labelRenderedSizeThreshold: 9,
		labelDensity: 0.5,
		hideLabelsOnMove: true,
	});
}
