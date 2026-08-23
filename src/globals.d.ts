/**
 * A build-time `define` substitution (see esbuild.config.mjs's own
 * comment), not a real runtime global - esbuild replaces every reference to
 * this identifier with the embedding worker's bundled source, JSON-
 * stringified into a string literal, before main.js is even written. Only
 * embeddingModel.ts's getWorker() reads it.
 */
declare const __EMBEDDING_WORKER_SOURCE__: string;
