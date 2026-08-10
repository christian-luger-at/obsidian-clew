import type { FeatureExtractionPipeline, ProgressInfo } from '@huggingface/transformers';

/**
 * User-reported, two different symptoms of the exact same root cause:
 * - `TypeError: Cannot read properties of undefined (reading 'create')`
 *   (before device was set explicitly)
 * - `Error: Unsupported device: "wasm". Should be one of: coreml, webgpu,
 *   cpu.` (after forcing `device: 'wasm'` - see git history)
 *
 * transformers.js decides whether it's "running in Node" with
 * `process?.release?.name === "node"`, computed *once*, at its own
 * module-evaluation time, and frozen into an internal `apis` object
 * (`Object.freeze(...)` - confirmed by reading the installed package's own
 * source, not assumed). Electron's renderer process - which is what
 * Obsidian's desktop app actually is - sets `process.release.name` to
 * `"node"` too (Node integration), even though the JS/WASM runtime
 * actually executing this code is Chromium's, not Node's. transformers.js
 * has no way to tell the difference, so it misidentifies Obsidian as
 * Node and switches to Node's own code path:
 * - The device *validation* whitelist becomes `["coreml", "webgpu",
 *   "cpu"]` (no `"wasm"`) - hence the second error above.
 * - Worse, the actual ONNX runtime backend it binds to
 *   (`ONNX = onnxruntime_node_exports`) is the *real* `onnxruntime-node`
 *   package's exports - except the browser build of transformers.js
 *   (`transformers.web.js`, what this bundle actually ships, given this
 *   plugin has no Node-native binaries to ship for it) has that import
 *   stubbed out to an empty module at its own build time (visible in the
 *   installed package's source as `// ignore-modules:onnxruntime-node`).
 *   So `ONNX.InferenceSession` is `undefined`, and the first call into it
 *   (`.create(...)`) throws exactly the *first* error above - regardless
 *   of which `device` string is passed, since this ONNX assignment
 *   happens unconditionally before any device-specific logic runs. No
 *   choice of `device` value alone can fix this.
 *
 * Fix: since the misdetection is baked in once, at first import, the fix
 * has to happen *before* that first import, not after - a static
 * `import ... from '@huggingface/transformers'` at the top of this file
 * (an earlier version had exactly that) is hoisted and evaluated before
 * any of this file's own code can run, so there is no way to intervene in
 * time. loadTransformers() below uses a *dynamic* `import()` instead,
 * bracketed by a temporary, narrowly-scoped shim - swapping out
 * `window.process` itself for a shallow copy with `release` overridden,
 * not (an earlier version's attempt) mutating `process.release` on the
 * *real* process object in place, which throws `TypeError: Cannot assign
 * to read only property 'release' of object '#<process>'` - Electron
 * locks that specific property down (user-reported), even though
 * `window.process` as a whole is still a plain, reassignable property.
 * Restored immediately after in a `finally`. With `IS_NODE_ENV` correctly
 * false, transformers.js binds to the real `onnxruntime-web` build
 * instead, and `"wasm"` becomes a valid device - exactly the code path
 * already confirmed working in a plain (non-Electron) browser context -
 * see DEVELOPMENT.md's own write-up for that verification.
 */
async function loadTransformers(): Promise<typeof import('@huggingface/transformers')> {
	// `window`, not `globalThis` (Obsidian plugin-review lint) - Electron
	// attaches `process` to the same global object `window` refers to, so
	// this reads the exact same value either way; `process` itself is a
	// process-wide Node/Electron global with no per-pop-out-window meaning
	// at all (unlike the DOM globals `no-global-this` actually exists for,
	// e.g. `document`/`localStorage`, which really do differ per window).
	const win = window as unknown as { process?: object };
	const originalProcess = win.process;
	try {
		// A shallow copy, not a bare `{ release: ... }` - transformers.js
		// also reads `process.platform`/`process.arch`/`process.versions`
		// elsewhere (see deviceToExecutionProviders() in this file's own
		// docstring), and nothing else in Obsidian/Electron should notice
		// `process` briefly pointing at a copy instead of the original
		// object, since every *other* property still reads identically.
		if (originalProcess) win.process = { ...originalProcess, release: { name: 'browser' } };
		return await import('@huggingface/transformers');
	} finally {
		if (originalProcess) win.process = originalProcess;
	}
}

/**
 * `Xenova/all-MiniLM-L6-v2`, 8-bit quantized (`dtype: 'q8'`): the exact
 * model/setting the spike measured (~2.2s cold load, ~2.5ms/note embed
 * throughput, 22MB one-time download). Fetched from the Hugging Face Hub's
 * own CDN by default (transformers.js's usual behavior) rather than bundled
 * into the plugin's own release asset - see the spike write-up's "Not done
 * in this spike" list for why fully-offline (self-hosted .wasm/model
 * files) was deliberately deferred, not silently dropped.
 */
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

/**
 * Memoized across the whole plugin session (not per-GraphPane-instance) -
 * loading the model is the expensive, one-time part (network fetch +
 * WASM/ONNX session setup); re-running embedText() against an
 * already-loaded pipeline is cheap (see the spike's own per-note timing).
 * A module-level singleton, not a GraphPane field, so switching between
 * multiple open graph views (or closing/reopening one) never re-downloads
 * or re-initializes the model needlessly.
 */
let modelPromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Starts (or returns the in-flight/already-resolved) model load.
 * `onProgress` surfaces transformers.js's own download/init progress events
 * - GraphPane uses this to show "Downloading model… N%" in the Color & size
 * panel the first time a `semanticCluster` criterion is enabled, rather
 * than leaving the panel looking frozen during what can be a
 * multi-second-to-tens-of-seconds first load on a slow connection.
 */
export function loadEmbeddingModel(onProgress?: (info: ProgressInfo) => void): Promise<FeatureExtractionPipeline> {
	modelPromise ??= (async () => {
		const { pipeline, env } = await loadTransformers();
		// ONNX Runtime Web's own documented fallback for another,
		// independent Electron-specific problem: its default *multi-
		// threaded* WASM backend needs `SharedArrayBuffer`/
		// `crossOriginIsolated`, which Obsidian's `app://` origin doesn't
		// grant (no COOP/COEP headers) - forcing a single worker thread
		// sidesteps that path entirely. Set here (after loadTransformers()
		// resolves), not at this module's own top level - there's no
		// `env` to configure before that dynamic import has resolved.
		if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;
		return pipeline('feature-extraction', MODEL_ID, {
			dtype: 'q8',
			// Explicit, not 'auto' (transformers.js's own default) - 'auto'
			// picks WebGPU whenever the environment merely *reports* the API
			// as present. Plain WASM is exactly what the spike measured and
			// verified working (see DEVELOPMENT.md) - the safer, better-
			// tested path here, and now a valid one now that loadTransformers()
			// stops transformers.js from misclassifying Obsidian as Node.
			device: 'wasm',
			progress_callback: onProgress,
		});
	})();
	return modelPromise;
}

/**
 * One note's embedding vector - mean-pooled, L2-normalized (`normalize:
 * true`) token embeddings, so semanticClustering.ts's cosineSimilarity()
 * can just take the dot product without a separate magnitude step. `text`
 * should be "title\ncontent" (same shape GraphPane's noteContentCache
 * already uses for the `text` criterion) - the model has no special
 * handling for a title, it's just more text for it to embed, but leading
 * with the title still measurably helps (the spike's own results were
 * title-only for most notes, and still surfaced the right families).
 */
export async function embedText(extractor: FeatureExtractionPipeline, text: string): Promise<Float32Array> {
	const output = await extractor(text, { pooling: 'mean', normalize: true });
	return Float32Array.from(output.data as ArrayLike<number>);
}
