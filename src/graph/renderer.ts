import Graph from 'graphology';
import Sigma from 'sigma';
import { NodeImageProgram } from '@sigma/node-image';
import { createNodeBorderProgram } from '@sigma/node-border';
import { createEdgeCurveProgram } from '@sigma/edge-curve';
import {
	drawDiscNodeLabel,
	NodeHoverDrawingFunction,
	createEdgeArrowProgram,
	createEdgeDoubleArrowProgram,
	DEFAULT_EDGE_ARROW_HEAD_PROGRAM_OPTIONS,
} from 'sigma/rendering';
import { GeneratedGraph } from './generateGraph';

const GRAPH_COLOR = '#7c3aed';
const IMAGE_NODE_COLOR = '#f59e0b';

/**
 * How much of a node's own radius the outer ring layer, and the gap layer
 * just inside it, each claim - GitHub backlog item 6 follow-up:
 * "Kennzeichnen die ausgeschlossenen Knoten. Geht ein Ring um den Kreis?",
 * then "Ist es möglich zwischen dem roten Ring und dem Knoten einen
 * Abstand zu haben?" A three-layer concentric-discs technique (see
 * createNodeBorderProgram()'s own docs), not a real CSS "border" - outer
 * ring, then a gap band, then the node's own fill, each colored by its own
 * per-node attribute (`borderColor`/`gapColor`/`color`). GraphPane sets
 * `borderColor` and `gapColor` to match the node's own fill for every
 * ordinary note - all three discs then paint the same color, no visible
 * ring *or* gap, indistinguishable from a plain circle - and to
 * theme.ts's excludedBorderColor/backgroundColor for a note excluded from
 * Find-path, making both bands visible: an accent ring with a gap of
 * canvas-background color between it and the note's own dot. Both sizes
 * stay fixed constants, not attribute-driven - only presence/color needs
 * to vary per node, not thickness.
 */
const EXCLUDED_RING_RELATIVE_SIZE = 0.14;
const EXCLUDED_RING_GAP_RELATIVE_SIZE = 0.12;

/**
 * Registered as `nodeProgramClasses.bordered` below and set as sigma's own
 * `defaultNodeType`, so every node that doesn't explicitly request the
 * `image` program (vaultGraph.ts only ever sets `type: 'image'`, never
 * `'bordered'`) renders through this one automatically - real notes and
 * ghost nodes alike, with no vaultGraph.ts change needed (see sigma's own
 * `if (!data.type) data.type = settings.defaultNodeType` fallback). Cover-
 * image notes don't get a ring this way (NodeImageProgram doesn't compose
 * with the border technique) - an accepted gap, not a goal: excluding a
 * cover-image note from Find-path still works exactly the same, it just
 * won't visibly ring on the graph.
 */
const NodeBorderProgram = createNodeBorderProgram({
	borders: [
		{ size: { value: EXCLUDED_RING_RELATIVE_SIZE }, color: { attribute: 'borderColor' } },
		{ size: { value: EXCLUDED_RING_GAP_RELATIVE_SIZE }, color: { attribute: 'gapColor' } },
		{ size: { fill: true }, color: { attribute: 'color' } },
	],
});

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

/**
 * Builds every edge program GraphPane registers - straight ('arrow'/
 * 'doubleArrow', ClewAppearanceSettings.showEdgeDirection) and curved
 * ('curved'/'curvedArrow'/'curvedDoubleArrow', ClewAppearanceSettings.
 * curvedEdges) variants alike - a single-headed arrow for a one-way link,
 * a double-headed one for a mutual link (see vaultGraph.ts's `mutual` edge
 * attribute), each available straight or curved. All five are sigma's own
 * built-ins (createEdgeArrowProgram/createEdgeDoubleArrowProgram from
 * 'sigma/rendering', createEdgeCurveProgram from the companion
 * '@sigma/edge-curve' package - same "official sigma package, not a
 * hand-rolled program" precedent as node-border/node-image), just
 * re-created with `arrowSize` scaling sigma's own default length/wideness
 * ratios together (the curved arrow variants take the exact same ratios,
 * via `@sigma/edge-curve`'s own `arrowHead` option) - a factory (not a
 * fixed constant) since arrowSize is a live-tunable Appearance-panel
 * slider: sigma's edgeProgramClasses is a normal setting
 * (handleSettingsUpdate diffs old vs. new and calls registerEdgeProgram()
 * per changed type), so GraphPane can call this again and setSetting()
 * the result whenever the slider moves, no renderer recreation needed.
 *
 * The plain 'curved' program (no arrowhead) uses `@sigma/edge-curve`'s own
 * default curvature (0.25, `DEFAULT_EDGE_CURVATURE`) - not user-tunable
 * (yet); every edge bends by the same fixed amount, since Clew's graph
 * never has true parallel/multi-edges between the same two nodes to need
 * the package's own per-edge `indexParallelEdgesIndex()` curvature
 * variation (see `hasEdge()` guards throughout vaultGraph.ts).
 */
type EdgeProgramType = ReturnType<typeof createEdgeArrowProgram>;

export interface EdgePrograms {
	arrow: EdgeProgramType;
	doubleArrow: EdgeProgramType;
	curved: EdgeProgramType;
	curvedArrow: EdgeProgramType;
	curvedDoubleArrow: EdgeProgramType;
	// Structural index signature - the named properties above are for this
	// module's own construction/documentation; every call site only ever
	// spreads the whole return value into sigma's own `edgeProgramClasses`
	// setting, which is itself just `{ [type: string]: EdgeProgramType }`.
	[type: string]: EdgeProgramType;
}

export function createEdgePrograms(arrowSize: number): EdgePrograms {
	const ratios = {
		lengthToThicknessRatio: DEFAULT_EDGE_ARROW_HEAD_PROGRAM_OPTIONS.lengthToThicknessRatio * arrowSize,
		widenessToThicknessRatio: DEFAULT_EDGE_ARROW_HEAD_PROGRAM_OPTIONS.widenessToThicknessRatio * arrowSize,
	};
	return {
		arrow: createEdgeArrowProgram(ratios),
		doubleArrow: createEdgeDoubleArrowProgram(ratios),
		curved: createEdgeCurveProgram(),
		curvedArrow: createEdgeCurveProgram({ arrowHead: { extremity: 'target', ...ratios } }),
		curvedDoubleArrow: createEdgeCurveProgram({ arrowHead: { extremity: 'both', ...ratios } }),
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
	/** Scales the arrowhead sigma draws when ClewAppearanceSettings.showEdgeDirection is on - see createEdgePrograms(). 1 = sigma's own default size. */
	edgeArrowSize?: number;
}

/**
 * sigma's own default `labelSize` (settings/dist's DEFAULT_SETTINGS) - the
 * font size used at the camera's resting ratio (1), and the ceiling
 * updateLabelSizeForZoom() below clamps to, so zooming in never grows
 * labels past how they already look today.
 */
const LABEL_SIZE_BASE = 14;
/** Floor updateLabelSizeForZoom() clamps to while zoomed out - small enough to noticeably reduce overlap, still legible (not far off labelRenderedSizeThreshold's own default floor). */
const LABEL_SIZE_MIN = 6;

/**
 * GitHub backlog item 13, "Dynamische Schriftgröße bei Zoom": sigma's
 * `labelSize` is a single fixed number (not, as it turns out, a
 * per-camera-ratio function - checked sigma's own settings types), drawn at
 * that constant CSS pixel size regardless of zoom. At vault scale, zooming
 * out to see the whole graph packs many more node labels into the same
 * screen area while each stays full-size, so they overlap into unreadable
 * mush - user-reported. Re-deriving `labelSize` from the camera's own
 * `ratio` (sigma's zoom-out measure - 1 at rest, growing as you zoom out,
 * shrinking below 1 as you zoom in) on every camera change and pushing it
 * back in via `renderer.setSetting()` makes labels shrink as you zoom out,
 * without touching labelDensity (which still separately governs *how many*
 * labels are allowed to render at all at a given zoom - a deliberately
 * untouched, separate lever, see this backlog item's own "Abgrenzung").
 * Scoped to this renderer's own camera instance - no explicit teardown
 * needed, since GraphPane always creates a fresh Sigma (and so a fresh
 * camera) per createRenderer() call and never keeps the old one around
 * after renderer.kill() (see GraphPane's setFiles()/onClose()).
 *
 * The `renderer.getSetting('labelSize') === next` guard below is load-
 * bearing, not a micro-optimization - without it this recurses infinitely
 * and crashes with "Maximum call stack size exceeded" (user-reported,
 * "Wechsel von Radial auf Force => Fehler in der Console. Graph
 * funktioniert dann nicht mehr", confirmed via a non-minified debug build
 * to trace the actual call chain rather than guessing from a minified
 * one). Root cause: sigma's own `setSetting()` unconditionally calls
 * `handleSettingsUpdate()`, which re-derives the camera's state via
 * `camera.setState(camera.validateState(camera.getState()))` regardless of
 * which setting actually changed (sigma's own source, not something this
 * plugin controls) - and `Camera.setState()` emits its own `updated` event
 * whenever the result isn't exactly `===` the previous state. During
 * setForceLayout()'s repeating 150ms `resetCameraAndRefresh()` interval
 * (which keeps the camera tracking ForceAtlas2 live while it settles - see
 * that function's own docstring), the ratio genuinely keeps changing
 * frame to frame, so this `update()` calling `setSetting('labelSize', …)`
 * on every single `updated` event kept re-triggering sigma's own re-derive
 * -> re-emit cycle for as long as the ratio kept moving, deep enough to
 * overflow the stack. Skipping the `setSetting()` call whenever the
 * computed value hasn't actually changed breaks that specific ping-pong at
 * its source, without changing the feature's own behavior at all (label
 * size still recomputes every real zoom change, exactly as before) -
 * `renderer.setSetting()`'s job was always "write `next`", and if `next`
 * already *is* the stored value there is nothing left for it to do.
 */
function watchZoomForLabelSize(renderer: Sigma): void {
	const camera = renderer.getCamera();
	const update = (): void => {
		// A non-finite ratio (NaN/Infinity) means something upstream already
		// broke - a corrupt pinned node position poisoning ForceAtlas2 and,
		// through it, the camera's own fit (see
		// resetToDeterministicPositions()'s docstring in vaultGraph.ts for
		// the real story) is the one confirmed cause, fixed at its source
		// there and in GraphPane's fittedBBox()/finishDrag(). This check
		// stays anyway, as the actual guard against *this* crash
		// specifically: without it, a non-finite `next` never equals
		// `renderer.getSetting('labelSize')` (`NaN !== NaN` is always true,
		// same for the setting's own stored NaN once one gets written), so
		// the "did this actually change" guard below never fires and this
		// recurses through sigma's own setSetting -> handleSettingsUpdate ->
		// camera.setState -> 'updated' cycle until the call stack overflows
		// - "Uncaught RangeError: Maximum call stack size exceeded",
		// user-reported switching Radial -> Force, root-caused via a non-
		// minified debug build with temporary console logging (since
		// removed) that confirmed `camera.ratio` was genuinely `NaN` at the
		// point of the loop.
		if (!Number.isFinite(camera.ratio)) return;
		const scaled = LABEL_SIZE_BASE / camera.ratio;
		const next = Math.min(LABEL_SIZE_BASE, Math.max(LABEL_SIZE_MIN, scaled));
		if (renderer.getSetting('labelSize') === next) return;
		renderer.setSetting('labelSize', next);
	};
	camera.on('updated', update);
	update();
}

/** How long the mouse captor must stay quiet before watchMoveForEdgeVisibility() treats the interaction as settled - see that function's own docstring. Comfortably longer than sigma's own drag-release refresh delay (0ms), its default drag-inertia coast (200ms), and its default wheel-zoom tween (250ms), so it always fires strictly after whichever one is actually running finishes, not mid-tween. */
const MOVE_SETTLE_MS = 400;

/**
 * Backstops sigma's own `hideEdgesOnMove` cleanup for the cases it doesn't
 * cover - user report: "Nach dem Verschieben des Graphen werden oft nur die
 * Punkte ohne Kanten dargestellt." (edges stay hidden after panning). Sigma
 * hides edges while `camera.isAnimated() || mouseCaptor.isMoving ||
 * mouseCaptor.draggedEvents || mouseCaptor.currentWheelDirection` is true,
 * and only patches one specific path back to visible: MouseCaptor's own
 * `mouseup` handler schedules exactly one `renderer.refresh()` a single
 * `setTimeout(…, 0)` tick after release (sigma's own source comment cites
 * https://github.com/jacomyal/sigma.js/issues/1290). That one refresh fires
 * too early to help here: releasing the mouse while still moving kicks off
 * a drag-inertia `camera.animate()` coast (200ms by default), so
 * `camera.isAnimated()` is still true at that 0ms mark - the "fix" refresh
 * just repaints one more still-hidden-edges frame, and nothing schedules
 * another once the coast actually stops. Wheel-zoom (including a trackpad's
 * two-finger pan/pinch, which the browser also reports as `wheel` events)
 * has no equivalent post-move refresh at all.
 *
 * Deliberately keyed off the mouse captor's own gesture events (`mouseup`/
 * `mouseleave`/`wheel`), not the camera's `updated` event - an earlier
 * version listened to `updated` instead, on the reasoning that every camera
 * state change (drag, inertia, wheel tween, *and* a programmatic
 * `animatedReset()`) fires it regardless of cause. That reasoning was
 * correct but too broad in practice: `updated` also fires for every
 * *programmatic* camera change, including GraphPane's own
 * `resetCameraAndRefresh()` - which setForceLayout() already calls on a
 * repeating 150ms interval for several seconds while ForceAtlas2 settles,
 * specifically to keep the camera tracking the growing layout live (see
 * its own docstring). Debouncing a `refresh()` off the same `updated`
 * stream that mechanism was busy driving at high frequency caused a real
 * crash switching Radial → Force ("Uncaught RangeError: Maximum call stack
 * size exceeded") - user-reported. Scoped to the mouse captor's own
 * gesture events instead: these only fire for genuine user interaction
 * (an actual mouse drag/release or wheel tick), never for a layout switch's
 * own camera resets, so this can no longer interact with
 * `resetCameraAndRefresh()`'s already-established refresh cadence at all.
 */
function watchMoveForEdgeVisibility(renderer: Sigma): void {
	const mouseCaptor = renderer.getMouseCaptor();
	let timeout: number | null = null;
	const scheduleRefresh = (): void => {
		if (timeout !== null) window.clearTimeout(timeout);
		timeout = window.setTimeout(() => {
			timeout = null;
			renderer.refresh();
		}, MOVE_SETTLE_MS);
	};
	mouseCaptor.on('mouseup', scheduleRefresh);
	mouseCaptor.on('mouseleave', scheduleRefresh);
	mouseCaptor.on('wheel', scheduleRefresh);
}

export function createRenderer(graph: Graph, container: HTMLElement, options: CreateRendererOptions = {}): Sigma {
	const {
		defaultEdgeColor = '#888888',
		labelColor = '#dcddde',
		hoverBackgroundColor = '#ffffff',
		labelRenderedSizeThreshold = 9,
		labelDensity = 0.5,
		edgeArrowSize = 1,
	} = options;

	const renderer = new Sigma(graph, container, {
		// sigma ignores every node/edge `zIndex` attribute by default (drawn
		// in graph/insertion order instead) unless this is explicitly
		// turned on - GraphPane's highlight reducers (hover, search,
		// path-find, stagnation cluster focus) all set `zIndex: 1`/`2` on
		// the emphasized nodes/edges, expecting them to draw on top of the
		// dimmed rest, but without this setting those values were silently
		// no-ops: a dimmed edge could still paint over a highlighted one
		// depending on which happened to come later in the graph - user
		// report ("hervorgehobene Kanten werden von gedimmten Kanten
		// überdeckt").
		zIndex: true,
		nodeProgramClasses: { image: NodeImageProgram, bordered: NodeBorderProgram },
		// Every node without an explicit `type` (i.e. everything except
		// vaultGraph.ts's cover-image notes) renders through the border
		// program above instead of sigma's own built-in default - see that
		// program's own docstring for why.
		defaultNodeType: 'bordered',
		// The straight 'arrow'/'doubleArrow' and curved 'curved'/
		// 'curvedArrow'/'curvedDoubleArrow' types are only actually used once
		// GraphPane sets an edge's `type` attribute to one of them
		// (showEdgeDirection/curvedEdges) - registered unconditionally here
		// regardless, since sigma's own edgeProgramClasses diffing (see
		// createEdgePrograms()'s docstring) is how the arrow *size* slider
		// updates live, and that needs the types already registered to have
		// something to diff against.
		edgeProgramClasses: createEdgePrograms(edgeArrowSize),
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
		// spike harness. `attribute: 'labelColor'` (not just `color`) lets a
		// node's own `labelColor` attribute override this default per-node -
		// GraphPane's dim reducers (hover, search, path-find) set it
		// alongside a dimmed node `color` so the label fades in step with
		// the dot instead of staying full-brightness while everything
		// around it dims. Falls back to this theme color for any node that
		// doesn't set one (sigma's own drawDiscNodeLabel: `data[attribute]
		// || settings.labelColor.color`).
		labelColor: { attribute: 'labelColor', color: labelColor },
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

	watchZoomForLabelSize(renderer);
	watchMoveForEdgeVisibility(renderer);
	return renderer;
}
