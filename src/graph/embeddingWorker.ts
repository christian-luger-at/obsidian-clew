import type { FeatureExtractionPipeline, ProgressInfo } from '@huggingface/transformers';

/**
 * Runs entirely inside its own Worker thread - see embeddingModel.ts's own
 * docstring for the full "Obsidian hängt" user report this exists to fix.
 * The one-time ONNX-session-creation/WASM-instantiation cost (~1.5-2s, see
 * the spike write-up) used to block Obsidian's renderer main thread for the
 * whole plugin's first semanticCluster use, on top of every subsequent
 * per-note embed call also running on that same thread (see
 * SEMANTIC_EMBED_YIELD_EVERY's old history in graphPane.ts's git log for
 * that half of the fix). Neither touches the UI at all any more - all of
 * it, model load included, now happens here.
 *
 * Bundled as a fully self-contained script and embedded into main.js as a
 * string constant (see esbuild.config.mjs's own comment for exactly how),
 * rather than shipped as a second release asset - Obsidian's plugin loader
 * only ever looks at main.js/manifest.json/styles.css, and a Worker
 * constructed from a same-origin file path wouldn't survive Obsidian
 * Mobile's sandboxed filesystem access anyway (isDesktopOnly: false in
 * manifest.json) - a Blob URL (embeddingModel.ts's getWorker()) works
 * identically on both.
 *
 * This file is a classic (non-module) worker script by construction (see
 * esbuild.config.mjs's `format: 'iife'` for the worker bundle) - dynamic
 * `import()` is still valid there (it's not restricted to module scripts),
 * so the exact same lazy-load-the-real-library shape as
 * embeddingModel.ts's own loadTransformers() still applies here.
 */

/**
 * Same defensive shim as embeddingModel.ts's loadTransformers() (see that
 * function's own long docstring for the full root-cause story - not
 * repeated here). Targets `self`, not `window` - there is no `window`
 * inside a Worker. In practice a plain `new Worker(...)` (this one) gets no
 * Node integration regardless of the parent renderer's own settings
 * (Electron's `nodeIntegrationInWorker` is a separate, opt-in flag Obsidian
 * does not set), so `self.process` almost certainly doesn't exist here at
 * all and this is a no-op - kept anyway, purely defensively, so this file
 * degrades exactly like the already-proven-correct main-thread version
 * instead of relying on an assumption about a setting this plugin doesn't
 * control.
 */
async function loadTransformers(): Promise<typeof import('@huggingface/transformers')> {
	const workerSelf = self as unknown as { process?: object };
	const originalProcess = workerSelf.process;
	try {
		if (originalProcess) workerSelf.process = { ...originalProcess, release: { name: 'browser' } };
		return await import('@huggingface/transformers');
	} finally {
		if (originalProcess) workerSelf.process = originalProcess;
	}
}

/** Same model/settings as the plugin has always used - see the old embeddingModel.ts history for MODEL_ID's own reasoning (spike-measured, ~2.2s cold load, ~2.5ms/note). */
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

/** Memoized for this worker's own lifetime (matches the main-thread singleton's old reasoning: the expensive part is the one-time load, not repeat use). */
let modelPromise: Promise<FeatureExtractionPipeline> | null = null;

function loadModel(onProgress: (info: ProgressInfo) => void): Promise<FeatureExtractionPipeline> {
	modelPromise ??= (async () => {
		const { pipeline, env } = await loadTransformers();
		// Same COOP/COEP-less-origin fallback as the old main-thread version -
		// crossOriginIsolated is a property of the whole origin, not just the
		// document that spawned this worker, so the multi-threaded WASM
		// backend is unavailable here too.
		if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;
		return pipeline('feature-extraction', MODEL_ID, {
			dtype: 'q8',
			device: 'wasm',
			progress_callback: onProgress,
		});
	})();
	return modelPromise;
}

async function embedOne(extractor: FeatureExtractionPipeline, text: string): Promise<Float32Array> {
	const output = await extractor(text, { pooling: 'mean', normalize: true });
	return Float32Array.from(output.data as ArrayLike<number>);
}

interface EmbedRequest {
	type: 'embed';
	requestId: string;
	items: { key: string; text: string }[];
}

// Shadows lib.dom's ambient `self: Window & typeof globalThis` for this
// file's own references only (this is a module - it has imports/exports -
// so a top-level `declare` here is file-scoped, not a real redeclaration of
// the global) - the actual runtime object is a DedicatedWorkerGlobalScope,
// not a Window, but the two relevant members (postMessage/onmessage) have
// compatible-enough shapes that a minimal hand-written interface is simpler
// and safer than pulling in the "webworker" lib, which can't coexist with
// this project's shared tsconfig "DOM" lib (see esbuild.config.mjs's
// comment on why this file is built as its own separate program instead of
// tsc's own noEmit check, which only ever runs against the DOM-lib
// tsconfig).
declare const self: {
	postMessage(message: unknown, transfer?: Transferable[]): void;
	onmessage: ((event: MessageEvent<EmbedRequest>) => void) | null;
};

async function handleEmbedRequest(event: MessageEvent<EmbedRequest>): Promise<void> {
	const { requestId, items } = event.data;
	// requestId is read before the try block on purpose - postMessage below
	// needs it to correlate this reply on the main-thread side even if
	// something inside the try fails.
	try {
		const extractor = await loadModel((info) => {
			if (info.status !== 'progress' && info.status !== 'progress_total') return;
			self.postMessage({ type: 'download-progress', requestId, progress: Math.round(info.progress) });
		});
		const vectors: { key: string; vector: Float32Array }[] = [];
		let done = 0;
		// User-measured (not the spike's own ~2.5ms/note figure - a real
		// Obsidian/Electron WASM run of this same model instead measured
		// ~40-50ms/note, ~18x slower - see IDLE_TIMEOUT_MS's own docstring
		// in graphPane.ts): the download-progress badge above
		// reaches 100% almost immediately once the model is warm, then
		// froze there for the *entire* embedding phase - tens of seconds
		// for a few hundred notes, which read as hung even though real
		// work was happening the whole time. Reported every note (not
		// throttled) - postMessage of two small numbers is cheap enough
		// that batching it wouldn't meaningfully help, and every-note
		// keeps the count exact rather than approximated.
		for (const item of items) {
			vectors.push({ key: item.key, vector: await embedOne(extractor, item.text) });
			self.postMessage({ type: 'embed-progress', requestId, done: ++done, total: items.length });
		}
		// Transfers each vector's underlying buffer instead of structured-
		// cloning it - cheap either way at this model's 384-float dimension,
		// but free to do and the correct habit for a message that could
		// carry many vectors at once (one per note needing embedding).
		self.postMessage(
			{ type: 'result', requestId, vectors },
			vectors.map((v) => v.vector.buffer),
		);
	} catch (err) {
		self.postMessage({ type: 'error', requestId, message: err instanceof Error ? err.message : String(err) });
	}
}

// A synchronous wrapper, not `self.onmessage = handleEmbedRequest` directly -
// `onmessage`'s own type is a plain void-returning callback, and handing it
// an async function directly would leave a rejected promise (if
// handleEmbedRequest itself somehow threw before reaching its own try/catch,
// e.g. destructuring a malformed event.data) silently unhandled instead of
// visibly surfacing.
self.onmessage = (event) => {
	void handleEmbedRequest(event);
};
