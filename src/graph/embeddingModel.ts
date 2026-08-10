import { pipeline, type FeatureExtractionPipeline, type ProgressInfo } from '@huggingface/transformers';

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
