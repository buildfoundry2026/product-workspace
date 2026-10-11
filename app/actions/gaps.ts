"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOwner } from "@/utils/supabase/require-owner";
import { normalizeSourceText } from "@/lib/ingestion/chunk-text";
import { processSourceText } from "@/lib/ingestion/process-source";

/** Must match the limit enforced by public.resolve_gap(). */
const MAX_ANSWER_CHARS = 20_000;

const resolveGapInput = z.object({
  gapId: z.uuid(),
  answerText: z
    .string()
    .transform(normalizeSourceText)
    .pipe(
      z
        .string()
        .min(1, "Write an answer before resolving.")
        .max(MAX_ANSWER_CHARS, `Answers must be ${MAX_ANSWER_CHARS.toLocaleString()} characters or fewer.`),
    ),
});

const rpcResult = z.object({
  gap_id: z.uuid(),
  source_id: z.uuid(),
  project_id: z.uuid(),
});

export type ResolveGapErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "GAP_NOT_FOUND"
  | "ALREADY_RESOLVED"
  | "FAILED";

export type ResolveGapResult =
  | {
      ok: true;
      gapId: string;
      sourceId: string;
      /** The answer is saved either way; 'failed' means it could not be chunked for retrieval. */
      processingStatus: "completed" | "failed";
    }
  | { ok: false; code: ResolveGapErrorCode; message: string };

/**
 * FR-004: answer and resolve a gap.
 *
 * public.resolve_gap() does the database work in one transaction: it inserts
 * the answer as a new `clarification_answer` source, marks the gap 'resolved'
 * with resolution_source_id pointing at that source, and records a
 * source --answers--> gap link. The answer is then chunked like any other
 * source so later steps can cite it as evidence.
 */
export async function resolveGap(gapId: string, answerText: string): Promise<ResolveGapResult> {
  const parsed = resolveGapInput.safeParse({ gapId, answerText });
  if (!parsed.success) {
    return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const owner = await getOwner();
  if (!owner) {
    return fail("UNAUTHORIZED", "Your session has expired. Sign in again.");
  }
  const { supabase, user } = owner;
  const answer = parsed.data.answerText;

  const { data, error } = await supabase.rpc("resolve_gap", {
    p_gap_id: parsed.data.gapId,
    p_answer: answer,
  });

  if (error) {
    console.error("[resolveGap] resolve_gap failed", { gapId, code: error.code });
    switch (error.code) {
      case "P0002":
        return fail("GAP_NOT_FOUND", "This question no longer exists.");
      case "55000":
        return fail("ALREADY_RESOLVED", error.message);
      case "22023":
        return fail("INVALID_INPUT", error.message);
      case "42501":
        return fail("UNAUTHORIZED", "The database denied access. Check that the owner account is provisioned.");
      case "PGRST202":
        return fail(
          "FAILED",
          "The database is missing resolve_gap(). Apply supabase/migrations/20261011140000_resolve_gap.sql.",
        );
      default:
        return fail("FAILED", "Could not save your answer. Please try again.");
    }
  }

  const result = rpcResult.safeParse(data);
  if (!result.success) {
    console.error("[resolveGap] unexpected resolve_gap response", { gapId });
    return fail("FAILED", "The answer was saved, but the response was unexpected. Refresh the page.");
  }
  const { source_id: sourceId, project_id: projectId } = result.data;

  const processed = await processSourceText(supabase, {
    sourceId,
    projectId,
    ownerId: user.id,
    content: answer,
    baseMetadata: { gap_id: result.data.gap_id },
  });

  revalidatePath(`/projects/${projectId}`);

  return {
    ok: true,
    gapId: result.data.gap_id,
    sourceId,
    processingStatus: processed.ok ? "completed" : "failed",
  };
}

function fail(code: ResolveGapErrorCode, message: string): ResolveGapResult {
  return { ok: false, code, message };
}
