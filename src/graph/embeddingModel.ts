/**
 * User-reported: enabling a `semanticCluster` criterion left the Color &
 * size/Filter panel stuck on "Computing embeddings…" AND froze Obsidian
 * itself, not just that one panel. This file used to run the whole
 * embedding pipeline (model load + every note's inference) directly on
 * Obsidian's renderer main thread - single-threaded WASM (see
 * embeddingWorker.ts's own numThreads=1 comment), with each `await`
 * resolving via a microtask rather than ever handing control back to the
 * browser's paint/input loop. A first pass at this (yielding via
 * `setTimeout` every N notes inside the per-note loop) fixed the part that
 * scaled with vault size, but left the one-time ~1.5-2s ONNX-session-
 * creation/model-load step itself still blocking, since that's a single
 * `await` this file has no way to chunk from the outside.
 *
 * This file is now a thin RPC client instead - the actual model load and
 * every note's inference happens in embeddingWorker.ts, running on its own
 * Worker thread (see that file's own docstring for the full story,
 * including why it's embedded as a string rather than shipped as a second
 * file - esbuild.config.mjs's own comment covers the build-time mechanics).
 * Nothing in here touches the main thread for longer than a message-passing
 * round trip, so there is no vault size or model-load-time past which this
 * can freeze Obsidian any more.
 */

/**
 * Memoized across the whole plugin session, same reasoning the old
 * module-level `modelPromise` singleton here used to have: spinning up a
 * Worker (and, inside it, the model) is the expensive, one-time part;
 * reusing an already-running worker for every subsequent embedBatch() call
 * is cheap. A module-level singleton, not a GraphPane field, so switching
 * between multiple open graph views (or closing/reopening one) never
 * respawns the worker or re-initializes the model needlessly.
 */
let worker: Worker | null = null;
let workerBlobUrl: string | null = null;

function getWorker(): Worker {
	if (!worker) {
		// A Blob URL, not a path to a second shipped file - see
		// embeddingWorker.ts's own docstring for why (Obsidian Mobile's
		// sandboxed filesystem access, and the plugin loader only ever
		// reading main.js/manifest.json/styles.css).
		const blob = new Blob([__EMBEDDING_WORKER_SOURCE__], { type: 'text/javascript' });
		workerBlobUrl = URL.createObjectURL(blob);
		worker = new Worker(workerBlobUrl);
	}
	return worker;
}

/**
 * Called from main.ts's onunload() - a plugin disable/reload should not
 * leave a background Worker (and the model it's holding in memory) running
 * forever. Safe to call even if no worker was ever created (e.g. the
 * `semanticCluster` criterion was never used this session).
 */
export function terminateEmbeddingWorker(): void {
	worker?.terminate();
	worker = null;
	if (workerBlobUrl) {
		URL.revokeObjectURL(workerBlobUrl);
		workerBlobUrl = null;
	}
}

let nextRequestId = 0;

interface EmbedResultMessage {
	type: 'result';
	requestId: string;
	vectors: { key: string; vector: Float32Array }[];
}
interface DownloadProgressMessage {
	type: 'download-progress';
	requestId: string;
	progress: number;
}
interface EmbedProgressMessage {
	type: 'embed-progress';
	requestId: string;
	done: number;
	total: number;
}
interface EmbedErrorMessage {
	type: 'error';
	requestId: string;
	message: string;
}
type EmbedResponseMessage = EmbedResultMessage | DownloadProgressMessage | EmbedProgressMessage | EmbedErrorMessage;

/**
 * Surfaced to embedBatch()'s own caller as one of two distinct phases (not
 * a single percentage) - see graphPane.ts's semanticClusteringBadgeText()
 * for why: measured live in a real Obsidian vault (not the spike's own
 * ~2.5ms/note figure, see MODEL_LOAD_TIMEOUT_MS's own docstring), embedding
 * itself runs ~40-50ms/note, ~18x slower than that figure - the
 * download-progress badge used to reach 100% almost immediately (a cached
 * or fast-downloading model), then sit frozen there for the entire
 * embedding phase after, tens of seconds even for a few hundred notes, with
 * no visible feedback that anything was still happening at all.
 */
export type EmbedProgress = { phase: 'downloading'; percent: number } | { phase: 'embedding'; done: number; total: number };

/**
 * Embeds every `{key, text}` pair in one round trip to the worker (not one
 * message per note) - a single request/response pair per refreshSemanticClusters()
 * call is simpler than a correlation scheme for many in-flight per-note
 * requests, and there's nothing here worth parallelizing further once it's
 * off the main thread regardless.
 */
export function embedBatch(items: { key: string; text: string }[], onProgress?: (progress: EmbedProgress) => void): Promise<Map<string, Float32Array>> {
	return new Promise((resolve, reject) => {
		const w = getWorker();
		const requestId = String(nextRequestId++);

		const handleMessage = (event: MessageEvent<EmbedResponseMessage>): void => {
			const data = event.data;
			if (data.requestId !== requestId) return; // some other in-flight embedBatch() call's response
			if (data.type === 'download-progress') {
				onProgress?.({ phase: 'downloading', percent: data.progress });
				return;
			}
			if (data.type === 'embed-progress') {
				onProgress?.({ phase: 'embedding', done: data.done, total: data.total });
				return;
			}
			w.removeEventListener('message', handleMessage);
			w.removeEventListener('error', handleError);
			if (data.type === 'result') {
				resolve(new Map(data.vectors.map((v) => [v.key, v.vector])));
			} else {
				reject(new Error(data.message));
			}
		};
		const handleError = (event: ErrorEvent): void => {
			w.removeEventListener('message', handleMessage);
			w.removeEventListener('error', handleError);
			reject(new Error(event.message || 'Clew: embedding worker crashed'));
		};

		w.addEventListener('message', handleMessage);
		w.addEventListener('error', handleError);
		w.postMessage({ type: 'embed', requestId, items });
	});
}
