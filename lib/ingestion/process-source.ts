import "server-only";
import { createHash } from "node:crypto";
import type { createClient } from "@/utils/supabase/server";
import { chunkText } from "./chunk-text";
import { assertValidEmbeddings, embedTexts } from "./embeddings";

const CHUNK_MAX_CHARS = 1500;
const CHUNK_INSERT_BATCH = 500;
const CHUNKER_VERSION = "paragraph-sentence-v1";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type ProcessSourceInput = {
  sourceId: string;
  projectId: string;
  ownerId: string;
  /** Normalized text exactly as stored in sources.content (chunk offsets index into it). */
  content: string;
  /** Existing source metadata to keep alongside the chunking metadata. */
  baseMetadata?: Record<string, unknown>;
};

export type ProcessSourceResult =
  | { ok: true; chunkCount: number; embeddingStatus: "completed" | "pending" }
  | { ok: false; message: string };

/**
 * FR-002 processing step shared by every text source: splits the content into
 * chunks, embeds them when a provider is configured, and persists them.
 *
 * Safe to retry: chunks are upserted on the stable (source_id, chunk_index)
 * key and leftovers from a longer prior run are removed. The source is only
 * marked 'completed' after every chunk is persisted; on any error it is marked
 * 'failed' with the reason, so failed processing never looks successful.
 */
export async function processSourceText(
  supabase: Supabase,
  input: ProcessSourceInput,
): Promise<ProcessSourceResult> {
  const { sourceId, projectId, ownerId, content } = input;

  try {
    const chunks = chunkText(content, { maxChars: CHUNK_MAX_CHARS });
    if (chunks.length === 0) {
      throw new Error("Text produced no chunks");
    }

    const embeddings = await embedTexts(chunks.map((c) => c.content));
    if (embeddings) {
      assertValidEmbeddings(embeddings, chunks.length);
    }
    const embeddedAt = embeddings ? new Date().toISOString() : null;

    const rows = chunks.map((chunk, i) => ({
      source_id: sourceId,
      project_id: projectId,
      owner_id: ownerId,
      chunk_index: chunk.chunkIndex,
      content: chunk.content,
      content_hash: sha256(chunk.content),
      char_start: chunk.charStart,
      char_end: chunk.charEnd,
      embedding: embeddings ? JSON.stringify(embeddings.vectors[i]) : null,
      embedding_model: embeddings?.model ?? null,
      embedded_at: embeddedAt,
    }));

    for (let i = 0; i < rows.length; i += CHUNK_INSERT_BATCH) {
      const { error } = await supabase
        .from("chunks")
        .upsert(rows.slice(i, i + CHUNK_INSERT_BATCH), {
          onConflict: "source_id,chunk_index",
        });
      if (error) throw new DbError("Could not save chunks", error);
    }

    const { error: cleanupError } = await supabase
      .from("chunks")
      .delete()
      .eq("source_id", sourceId)
      .gte("chunk_index", chunks.length);
    if (cleanupError) throw new DbError("Could not remove stale chunks", cleanupError);

    const embeddingStatus = embeddings ? "completed" : "pending";
    const { error: completeError } = await supabase
      .from("sources")
      .update({
        processing_status: "completed",
        processing_error: null,
        processed_at: new Date().toISOString(),
        metadata: {
          ...input.baseMetadata,
          chunk_count: chunks.length,
          chunker: { version: CHUNKER_VERSION, max_chars: CHUNK_MAX_CHARS },
          embedding_status: embeddingStatus,
          embedding_model: embeddings?.model ?? null,
        },
      })
      .eq("id", sourceId);
    if (completeError) throw new DbError("Could not finalize the source", completeError);

    return { ok: true, chunkCount: chunks.length, embeddingStatus };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown processing error";
    // Identifiers and error metadata only, never source content (PRD §9).
    console.error("[processSourceText] processing failed", {
      sourceId,
      name: error instanceof Error ? error.name : typeof error,
      message,
    });
    await markSourceFailed(supabase, sourceId, message);
    return { ok: false, message };
  }
}

/** Best effort: a failed source must never be left looking 'processing' or 'completed'. */
async function markSourceFailed(supabase: Supabase, sourceId: string, message: string) {
  const { error } = await supabase
    .from("sources")
    .update({ processing_status: "failed", processing_error: message.slice(0, 1000) })
    .eq("id", sourceId);
  if (error) {
    console.error("[processSourceText] could not mark source failed", {
      sourceId,
      code: error.code,
    });
  }
}

class DbError extends Error {
  constructor(context: string, cause: { message: string; code?: string }) {
    // 42501: RLS rejected the write, usually because app_private.authorized_owner
    // has not been provisioned with the signed-in email.
    super(
      cause.code === "42501"
        ? `${context}: the database denied access. Check that the owner account is provisioned.`
        : `${context}.`,
    );
    this.name = "DbError";
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
