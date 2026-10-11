"use server";

import { z } from "zod";
import { getOwner } from "@/utils/supabase/require-owner";
import { normalizeSourceText } from "@/lib/ingestion/chunk-text";
import { processSourceText, sha256 } from "@/lib/ingestion/process-source";

const MAX_TEXT_CHARS = 200_000;

const ingestTextSourceInput = z.object({
  projectId: z.uuid(),
  text: z.string().trim().min(1, "Text is required").max(MAX_TEXT_CHARS),
  title: z.string().trim().min(1).max(300).optional(),
});

export type IngestTextSourceInput = z.input<typeof ingestTextSourceInput>;

export type IngestErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_ARCHIVED"
  | "PROCESSING_FAILED";

export type IngestTextSourceResult =
  | {
      ok: true;
      sourceId: string;
      chunkCount: number;
      embeddingStatus: "completed" | "pending";
      /** True when identical text was already ingested into this project. */
      deduplicated: boolean;
    }
  | { ok: false; code: IngestErrorCode; message: string };

/**
 * FR-002: ingest a pasted brief into a project.
 *
 * Stores the original text in `sources`, splits it into chunks, and stores the
 * chunks (with embeddings when a provider is configured). Safe to retry:
 * identical text in the same project is deduplicated by content hash, and a
 * previously failed attempt is reprocessed in place instead of duplicated.
 * The source is only marked `completed` after every chunk is persisted.
 */
export async function ingestTextSource(
  input: IngestTextSourceInput,
): Promise<IngestTextSourceResult> {
  const parsed = ingestTextSourceInput.safeParse(input);
  if (!parsed.success) {
    return fail("INVALID_INPUT", z.prettifyError(parsed.error));
  }

  const owner = await getOwner();
  if (!owner) {
    return fail("UNAUTHORIZED", "You must be signed in as the workspace owner.");
  }
  const { supabase, user } = owner;
  const { projectId } = parsed.data;

  const content = normalizeSourceText(parsed.data.text);
  const contentHash = sha256(content);
  const title = parsed.data.title ?? deriveTitle(content);

  // RLS hides other owners' projects, so "not found" covers both cases.
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, status")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    return dbFailure("Could not load the project", projectError);
  }
  if (!project) {
    return fail("PROJECT_NOT_FOUND", "Project not found.");
  }
  if (project.status === "archived") {
    return fail("PROJECT_ARCHIVED", "Cannot add sources to an archived project.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("sources")
    .select("id, processing_status, metadata")
    .eq("project_id", projectId)
    .eq("kind", "brief")
    .eq("content_hash", contentHash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    return dbFailure("Could not check for duplicate sources", existingError);
  }

  if (existing?.processing_status === "completed") {
    const metadata = (existing.metadata ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      sourceId: existing.id,
      chunkCount: typeof metadata.chunk_count === "number" ? metadata.chunk_count : 0,
      embeddingStatus: metadata.embedding_status === "completed" ? "completed" : "pending",
      deduplicated: true,
    };
  }

  // Claim the source row in 'processing' state before writing chunks.
  const sourceResult = existing
    ? await supabase
        .from("sources")
        .update({ processing_status: "processing", processing_error: null, title })
        .eq("id", existing.id)
        .select("id")
        .single()
    : await supabase
        .from("sources")
        .insert({
          project_id: projectId,
          owner_id: user.id,
          kind: "brief",
          title,
          content,
          content_hash: contentHash,
          mime_type: "text/plain",
          processing_status: "processing",
        })
        .select("id")
        .single();

  if (sourceResult.error || !sourceResult.data) {
    return dbFailure("Could not save the source", sourceResult.error);
  }
  const sourceId: string = sourceResult.data.id;

  const processed = await processSourceText(supabase, {
    sourceId,
    projectId,
    ownerId: user.id,
    content,
  });
  if (!processed.ok) {
    return fail("PROCESSING_FAILED", `Source processing failed: ${processed.message}`);
  }

  return {
    ok: true,
    sourceId,
    chunkCount: processed.chunkCount,
    embeddingStatus: processed.embeddingStatus,
    deduplicated: false,
  };
}

function dbFailure(
  context: string,
  error: { message: string; code?: string } | null,
): IngestTextSourceResult {
  console.error(`[ingestTextSource] ${context}`, { code: error?.code, message: error?.message });
  return fail("PROCESSING_FAILED", `${context}${error ? describeDbError(error) : "."}`);
}

function describeDbError(error: { message: string; code?: string }): string {
  // 42501: RLS rejected the write, usually because app_private.authorized_owner
  // has not been provisioned with the signed-in email.
  if (error.code === "42501") {
    return ": the database denied access. Check that the owner account is provisioned.";
  }
  return ".";
}

function fail(code: IngestErrorCode, message: string): IngestTextSourceResult {
  return { ok: false, code, message };
}

function deriveTitle(content: string): string {
  const firstLine = content.split("\n", 1)[0].trim();
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine || "Untitled brief";
}
