import "server-only";

/** Must match `vector(1024)` on public.chunks.embedding and match_chunks(). */
export const EMBEDDING_DIMENSIONS = 1024;

export type EmbeddingBatch = {
  model: string;
  vectors: number[][];
};

/**
 * Embeds chunk texts for semantic retrieval.
 *
 * The embedding model is an open decision in PRD.md, so no provider is wired
 * up yet and this returns null. Chunks are then stored with a NULL embedding
 * (allowed by the schema and skipped by match_chunks) rather than placeholder
 * vectors, which would be indistinguishable from real ones and return
 * meaningless similarity matches.
 */
export async function embedTexts(texts: string[]): Promise<EmbeddingBatch | null> {
  void texts;
  return null;
}

/** Throws unless the batch has exactly one finite, correctly sized vector per text. */
export function assertValidEmbeddings(batch: EmbeddingBatch, expectedCount: number) {
  if (batch.vectors.length !== expectedCount) {
    throw new Error(
      `Embedding count mismatch: expected ${expectedCount}, got ${batch.vectors.length}`,
    );
  }
  for (const vector of batch.vectors) {
    if (vector.length !== EMBEDDING_DIMENSIONS || !vector.every(Number.isFinite)) {
      throw new Error(`Embeddings must be finite ${EMBEDDING_DIMENSIONS}-dimensional vectors`);
    }
  }
}
