import Sigma from 'sigma';

/** One independently-colored density field - a highlighted Isolated cluster/Structural deviation community (one region, drawn while its Diagnostics "Show in graph" toggle is on - graphPane.ts's highlightNodeSet()), or one enabled Semantic clustering Color & size group (drawn continuously, one region per group - see graphPane.ts's semanticClusterHeatmapRegions()). Regions are independent and can overlap; HeatmapLayer draws each with its own color rather than merging them into one shared field. */
export interface HeatmapRegion {
	nodeIds: string[];
	/** [r, g, b] - a 2D canvas `rgba()` fill needs a triple, not an arbitrary CSS color string (see theme.ts's parseRgbString()). */
	color: [number, number, number];
}

/**
 * Density-field overlay, drawn behind the graph, for one or more
 * independently-colored node sets - user request: "die betroffenen Knoten
 * [sollen] mit einer Dichtekarte / Heatmap ausgestattet werden, um die
 * visuelle Zusammengehörigkeit zu zeigen", first for Diagnostics panel's
 * "Isolated clusters" section, then (same request, reworded "Mach das
 * gleiche mit") extended to Structural deviation's own "Show in graph"
 * toggle and to Semantic clustering's Color & size groups. Replaces (or, for
 * Semantic clustering, supplements) a flat "just recolor the nodes"
 * treatment with a soft glow, so a cluster reads as one visually cohesive
 * blob instead of a handful of same-colored dots the eye has to connect
 * manually.
 *
 * Ported from the ChatGPT-authored prototype at test-shadow/index.html (its
 * "heatmap" variant's `field()`/draw() pair) - same Gaussian-sum-per-pixel-
 * block approach, adapted from a throwaway `<script type="module">` page
 * wired directly to one hardcoded Graph instance into a reusable class that
 * tracks *this* plugin's live Sigma renderer (whose node set, camera, and
 * container size all change over the graph's lifetime) instead, and
 * generalized from the prototype's single node set to any number of
 * independently-colored regions (see HeatmapRegion above) - Semantic
 * clustering can have several enabled Color & size groups, each its own
 * cluster and own color, all visible at once.
 *
 * Own `<canvas>`, absolutely positioned to fill the container and inserted
 * *behind* every canvas Sigma itself manages (see the constructor below) -
 * same "separate canvas layer behind sigma, redrawn on camera/render/resize"
 * structure as the prototype's `.group-layer`, since Sigma's own node/edge
 * reducers (nodeReducer/edgeReducer, used elsewhere in graphPane.ts for
 * flat recoloring - see highlightNodeSet()) have no equivalent "paint
 * arbitrary pixels" hook of their own.
 */
export class HeatmapLayer {
	private readonly canvas: HTMLCanvasElement;
	private readonly ctx: CanvasRenderingContext2D;
	private readonly resizeObserver: ResizeObserver;
	private regions: HeatmapRegion[] = [];

	constructor(
		private readonly container: HTMLElement,
		private readonly renderer: Sigma,
	) {
		this.canvas = createEl('canvas', { cls: 'clew-heatmap-layer' });
		const ctx = this.canvas.getContext('2d');
		if (!ctx) throw new Error('clew: could not acquire a 2D canvas context for the heatmap overlay');
		this.ctx = ctx;
		// Behind every canvas Sigma manages (background/edges/nodes/labels/
		// hovers/mouse - all appended by Sigma itself, all position:
		// absolute; inset: 0, none with an explicit z-index) - inserting as
		// the container's first child puts this canvas earliest in DOM
		// order, which is what decides stacking among same-"z-index: auto"
		// siblings. Explicit `z-index: 0` in styles.css pins this
		// regardless of insertion order, but the prepend is kept too since
		// relying on a single mechanism for "stays behind the graph,
		// forever, across every future Sigma canvas" felt one CSS edit away
		// from silently breaking.
		this.container.prepend(this.canvas);

		this.renderer.getCamera().on('updated', this.redraw);
		this.renderer.on('afterRender', this.redraw);
		this.resizeObserver = new ResizeObserver(this.redraw);
		this.resizeObserver.observe(this.container);
	}

	/** Replaces the full set of regions drawn - callers own composing whatever regions should currently be visible (graphPane.ts's updateHeatmapRegions() merges the Diagnostics toggle's own region with Semantic clustering's per-group regions before calling this). An empty array clears the canvas, so callers don't need to branch on "is anything highlighted" themselves before calling this. */
	setRegions(regions: HeatmapRegion[]): void {
		this.regions = regions;
		this.redraw();
	}

	destroy(): void {
		this.renderer.getCamera().removeListener('updated', this.redraw);
		this.renderer.removeListener('afterRender', this.redraw);
		this.resizeObserver.disconnect();
		this.canvas.remove();
	}

	/**
	 * Class-field arrow function, not a `private redraw(): void {}` method -
	 * passed by reference to `.on()`/`removeListener()`/`ResizeObserver`
	 * above, which need a stable, already-`this`-bound callback (a plain
	 * method reference loses its `this` the moment it's handed off like
	 * that).
	 */
	private redraw = (): void => {
		const box = this.container.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		const width = Math.max(1, Math.round(box.width));
		const height = Math.max(1, Math.round(box.height));
		this.canvas.width = Math.ceil(width * dpr);
		this.canvas.height = Math.ceil(height * dpr);
		this.canvas.style.width = `${width}px`;
		this.canvas.style.height = `${height}px`;
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.ctx.clearRect(0, 0, width, height);

		if (this.regions.length === 0) return;

		const graph = this.renderer.getGraph();
		for (const region of this.regions) this.drawRegion(region, graph, width, height);
	};

	/**
	 * Gaussian-sum density field for one region, sampled on a coarse grid
	 * (STEP px) and splatted as small filled squares rather than one pixel
	 * at a time - same tradeoff the prototype made (its own heatmap variant
	 * used a 4px step): a true per-pixel ImageData fill would be noticeably
	 * slower for no visible gain, since the Gaussian falloff (RADIUS below)
	 * already blurs the result far past single-pixel granularity. Each
	 * region is a fully independent pass (its own grid scan, own color) -
	 * simpler than accumulating one shared multi-color field, and cheap
	 * enough at this grid resolution even for several regions at once
	 * (Semantic clustering: typically a handful of enabled groups).
	 */
	private drawRegion(region: HeatmapRegion, graph: ReturnType<Sigma['getGraph']>, width: number, height: number): void {
		const points: { x: number; y: number }[] = [];
		for (const nodeId of region.nodeIds) {
			if (!graph.hasNode(nodeId)) continue; // filtered out / removed since the region was computed - stale membership, skip rather than crash
			const attrs = graph.getNodeAttributes(nodeId) as { x: number; y: number };
			points.push(this.renderer.graphToViewport({ x: attrs.x, y: attrs.y }));
		}
		if (points.length === 0) return;

		const [r, g, b] = region.color;
		const STEP = 4;
		const RADIUS = 74;
		const radiusSquaredDoubled = 2 * RADIUS * RADIUS;
		for (let y = 0; y < height; y += STEP) {
			for (let x = 0; x < width; x += STEP) {
				let sum = 0;
				for (const p of points) {
					const dx = x - p.x;
					const dy = y - p.y;
					sum += Math.exp(-(dx * dx + dy * dy) / radiusSquaredDoubled);
				}
				if (sum <= 0.025) continue;
				this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(0.3, sum * 0.115)})`;
				this.ctx.fillRect(x, y, STEP + 0.5, STEP + 0.5);
			}
		}
	}
}

export function createHeatmapLayer(container: HTMLElement, renderer: Sigma): HeatmapLayer {
	return new HeatmapLayer(container, renderer);
}
