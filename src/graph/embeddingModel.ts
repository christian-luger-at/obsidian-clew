import { env, pipeline, type FeatureExtractionPipeline, type ProgressInfo } from '@huggingface/transformers';

/**
 * User-reported: `TypeError: Cannot read properties of undefined (reading
 * 'create')` deep inside ONNX Runtime Web's session creation, the moment a
 * `semanticCluster` criterion first tried to load the model. transformers.js
 * defaults to ONNX Runtime Web's *multi-threaded* WASM backend, which needs
 * `SharedArrayBuffer`/cross-origin isolation (`crossOriginIsolated`) to
 * spin up its worker thread pool - real browsers serving over HTTPS with
 * the right COOP/COEP headers have that; Obsidian's Electron renderer
 * (`app://` origin) does not set those headers, so the threaded backend's
 * own init silently hands back a partially-formed object instead of a
 * clean failure, and the next call into it (`.create(...)` on something
 * that init never actually populated) throws exactly this. Forcing a
 * single worker thread sidesteps the whole SharedArrayBuffer path -
 * ONNX Runtime Web's own docs list `numThreads: 1` as exactly this
 * fallback. Set once, at module load, before anything ever calls
 * loadEmbeddingModel() - has to happen before the first pipeline() call
 * creates a session, not after.
 */
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;

/**
 * The local embedding model (GitHub backlog item 16's own spike, documented
 * in DEVELOPMENT.md - "Spike: semantic clustering") - runs entirely
 * in-browser via ONNX Runtime Web (WASM), no server, nothing sent anywhere.
 * Kept separate from semanticClustering.ts on purpose: that module is pure
 * graph/vector math with no dependency on this package at all, so it stays
 * fast and network-free to unit test; this file is the one (and only)
 * place `@huggingface/transformers` - a ~1MB dependency plus a 22MB model
 * download on first use - actually gets imported.
 *
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
	modelPromise ??= pipeline('feature-extraction', MODEL_ID, {
		dtype: 'q8',
		// Explicit, not 'auto' (transformers.js's own default) - 'auto' picks
		// WebGPU whenever the environment merely *reports* the API as present,
		// which Electron's renderer does even where the rest of the WebGPU
		// stack isn't fully usable the way a real browser's is. Plain WASM is
		// exactly what the spike measured (~2.5ms/note - see this file's own
		// MODEL_ID docstring) and is the safer, better-tested path here.
		device: 'wasm',
		progress_callback: onProgress,
	});
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
