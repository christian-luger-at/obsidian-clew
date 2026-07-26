import { generateGraph } from '../src/graph/generateGraph';
import { buildGraph, createRenderer } from '../src/graph/renderer';
import { runLayout } from '../src/graph/layoutRunner';

/**
 * Standalone, Obsidian-free harness for the 10k-node spike (product-vision
 * doc, section 6). Exercises the exact same src/graph/ modules the real
 * plugin uses, so this doubles as a standing perf-regression check that
 * doesn't require opening Obsidian at all.
 *
 * All console output is prefixed with CLEW_SPIKE so it's easy to filter.
 */

const NODE_COUNT = 10_000;

function placeholderImage(seed: number): string {
	const hue = (seed * 47) % 360;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="32" fill="hsl(${hue},70%,55%)"/><text x="32" y="41" font-size="26" text-anchor="middle" fill="white" font-family="sans-serif">${seed % 100}</text></svg>`;
	return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

const container = document.getElementById('app')!;
const hud = document.getElementById('hud')!;

function log(message: string): void {
	console.log(`CLEW_SPIKE ${message}`);
	const line = document.createElement('div');
	line.textContent = message;
	hud.appendChild(line);
	while (hud.childElementCount > 12) hud.removeChild(hud.firstChild!);
}

const genStart = performance.now();
const data = generateGraph({ nodeCount: NODE_COUNT, seed: 1 });
log(`generated nodes=${data.nodes.length} edges=${data.edges.length} in ${(performance.now() - genStart).toFixed(0)}ms`);

const graph = buildGraph(data, (nodeId) => placeholderImage(Number(nodeId.split('-')[1])));
const renderer = createRenderer(graph, container);

log(`renderer created, starting layout`);

runLayout(graph, {
	durationMs: 6000,
	onSettled: (elapsedMs) => {
		log(`layout settled in ${elapsedMs.toFixed(0)}ms`);
	},
});

renderer.on('clickNode', ({ node }) => {
	log(`clickNode ${node}`);
});

// Rough frame-time sample: continuous rAF loop, averaged and logged every 2s.
let frameCount = 0;
let frameTimeSum = 0;
let lastFrame = performance.now();
let lastReport = performance.now();

function sampleFrame(now: number): void {
	frameTimeSum += now - lastFrame;
	lastFrame = now;
	frameCount++;
	if (now - lastReport >= 2000) {
		const avgMs = frameTimeSum / frameCount;
		log(`avg frame ${avgMs.toFixed(1)}ms (${(1000 / avgMs).toFixed(0)} fps)`);
		frameCount = 0;
		frameTimeSum = 0;
		lastReport = now;
	}
	requestAnimationFrame(sampleFrame);
}
requestAnimationFrame(sampleFrame);
