import Graph from 'graphology';
import Sigma from 'sigma';
import { NodeImageProgram } from '@sigma/node-image';
import { drawDiscNodeLabel, NodeHoverDrawingFunction } from 'sigma/rendering';
import { GeneratedGraph } from './generateGraph';

const GRAPH_COLOR = '#7c3aed';
const IMAGE_NODE_COLOR = '#f59e0b';

/**
 * sigma's own default hover renderer (drawDiscNodeHover, from sigma's
 * rendering source - not exposed as an easily-wrappable standalone piece,
 * so replicated here) hardcodes a white ("#FFF") fill for the label's
 * background box, entirely independent of the theme-aware `labelColor`
 * setting used everywhere else - fine against sigma's assumed light
 * background, but user-reported unreadable in a dark Obsidian theme (light
 * label text on a hardcoded-white box). Confirmed by reading sigma's own
 * source (node_modules/sigma), not assumed.
 *
 * Replicates that box-shape logic exactly (same rounded "pill" hugging the
 * node, same drop shadow) with only the hardcoded fill swapped for a
 * caller-provided color - drawDiscNodeLabel (sigma's own, unchanged) then
 * draws the label text on top, already theme-correct since createRenderer
 * already sets a theme-aware `labelColor`.
 */
export function createNodeHoverDrawer(backgroundColor: string): NodeHoverDrawingFunction {
	return (context, data, settings) => {
		const size = settings.labelSize;
		const font = settings.labelFont;
		const weight = settings.labelWeight;
		context.font = `${weight} ${size}px ${font}`;

		context.fillStyle = backgroundColor;
		context.shadowOffsetX = 0;
		context.shadowOffsetY = 0;
		context.shadowBlur = 8;
		context.shadowColor = '#000';
		const PADDING = 2;
		if (typeof data.label === 'string') {
			const textWidth = context.measureText(data.label).width;
			const boxWidth = Math.round(textWidth + 5);
			const boxHeight = Math.round(size + 2 * PADDING);
			const radius = Math.max(data.size, size / 2) + PADDING;
			const angleRadian = Math.asin(boxHeight / 2 / radius);
			const xDeltaCoord = Math.sqrt(Math.abs(Math.pow(radius, 2) - Math.pow(boxHeight / 2, 2)));
			context.beginPath();
			context.moveTo(data.x + xDeltaCoord, data.y + boxHeight / 2);
			context.lineTo(data.x + radius + boxWidth, data.y + boxHeight / 2);
			context.lineTo(data.x + radius + boxWidth, data.y - boxHeight / 2);
			context.lineTo(data.x + xDeltaCoord, data.y - boxHeight / 2);
			context.arc(data.x, data.y, radius, angleRadian, -angleRadian);
			context.closePath();
			context.fill();
		} else {
			context.beginPath();
			context.arc(data.x, data.y, data.size + PADDING, 0, Math.PI * 2);
			context.closePath();
			context.fill();
		}
		context.shadowOffsetX = 0;
		context.shadowOffsetY = 0;
		context.shadowBlur = 0;

		drawDiscNodeLabel(context, data, settings);
	};
}

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

export interface CreateRendererOptions {
	defaultEdgeColor?: string;
	labelColor?: string;
	/** Background fill for a hovered node's label box - see createNodeHoverDrawer()'s docstring for why sigma's own hardcoded white needs replacing. */
	hoverBackgroundColor?: string;
	/** on-screen node size a label must cross before it renders - user-tunable (Appearance panel), see settings.ts's ClewAppearanceSettings.labelSizeThreshold. */
	labelRenderedSizeThreshold?: number;
	/** how many labels are allowed to render per area at a given zoom - user-tunable, see settings.ts's ClewAppearanceSettings.labelDensity. */
	labelDensity?: number;
}

export function createRenderer(graph: Graph, container: HTMLElement, options: CreateRendererOptions = {}): Sigma {
	const {
		defaultEdgeColor = '#888888',
		labelColor = '#dcddde',
		hoverBackgroundColor = '#ffffff',
		labelRenderedSizeThreshold = 9,
		labelDensity = 0.5,
	} = options;

	return new Sigma(graph, container, {
		nodeProgramClasses: { image: NodeImageProgram },
		renderEdgeLabels: false,
		// A vault-change refresh (StandaloneGraphView's create/changed/resolved
		// listeners -> GraphPane.setFiles()) tears down and recreates the
		// Sigma instance on the graph's *current* container element, whatever
		// its size happens to be right now - and Obsidian gives a background
		// (not currently active) tab's view a 0x0 container, since it's
		// display:none. Without this, Sigma throws synchronously the moment
		// that happens ("Container has no width"), and since nothing in
		// setFiles() catches it, the rebuild aborts right there: no renderer
		// ever gets assigned, so the view is just left empty - reported as
		// "the graph is empty after a new node/edge is added" (only visible
		// once you switch back to the tab, at which point nothing triggered a
		// refresh to fix it). GraphPane.handleResize() (wired to Obsidian's
		// onResize() lifecycle hook) is the other half of this fix - it makes
		// the renderer catch up once the container's real size comes back.
		allowInvalidContainer: true,
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
		defaultDrawNodeHover: createNodeHoverDrawer(hoverBackgroundColor),
		hideEdgesOnMove: true,
		// Level-of-detail: without this, sigma renders a label for nearly
		// every node regardless of zoom, which is unreadable at vault scale
		// (thousands of overlapping labels). Raising the threshold means a
		// node's on-screen size has to cross it before its label shows, so
		// only hub nodes (sized bigger via sizeNodesByDegree in
		// vaultGraph.ts) label at low zoom - zooming in grows every node's
		// screen size and progressively reveals the rest. A user-requested
		// attempt to remove this passive reveal entirely (Infinity
		// threshold, forceLabel-only labels) instead broke rendering
		// altogether when a node was hovered - very likely Infinity feeding
		// into some internal sigma calculation and producing NaN, which
		// WebGL treats as "draw nothing" - reverted back to this tunable,
		// finite threshold.
		labelRenderedSizeThreshold,
		labelDensity,
		hideLabelsOnMove: true,
	});
}
