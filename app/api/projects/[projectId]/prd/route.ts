import { randomUUID } from "node:crypto";
import { streamText } from "ai";
import { z } from "zod";
import { getOwner } from "@/utils/supabase/require-owner";
import { getPrdModel, MissingApiKeyError, PRD_MODEL_ID } from "@/lib/ai/openrouter";
import { buildEvidenceSnapshot, loadPrdEvidence } from "@/lib/prd/evidence";
import { buildPrdPrompt, PRD_PROMPT_VERSION, PRD_SYSTEM_PROMPT } from "@/lib/prd/prompt";

export const maxDuration = 300;

const MAX_OUTPUT_TOKENS = 8000;

/**
 * FR-006: streams a Markdown PRD generated from the project's evidence.
 *
 * Responds with a plain-text stream of Markdown and an `X-Run-Id` header. The
 * run row stores the evidence snapshot used, which savePrd() later copies onto
 * the artifact. Provider errors and truncated output abort the stream with an
 * error instead of ending it normally, so the client never mistakes a partial
 * PRD for a complete one.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[projectId]/prd">) {
  const { projectId } = await ctx.params;
  if (!z.uuid().safeParse(projectId).success) {
    return jsonError(400, "Invalid project ID.");
  }

  const owner = await getOwner();
  if (!owner) {
    return jsonError(401, "You must be signed in as the workspace owner.");
  }
  const { supabase, user } = owner;

  const loaded = await loadPrdEvidence(supabase, projectId);
  if (!loaded.ok) {
    return jsonError(loaded.code === "NOT_FOUND" ? 404 : 500, loaded.message);
  }
  const { evidence } = loaded;
  if (evidence.project.status === "archived") {
    return jsonError(409, "PRDs cannot be generated for archived projects.");
  }
  if (evidence.sources.length === 0) {
    return jsonError(409, "Add a source to this project before generating a PRD.");
  }

  let model;
  try {
    model = getPrdModel();
  } catch (error) {
    if (error instanceof MissingApiKeyError) return jsonError(500, error.message);
    throw error;
  }

  const snapshot = buildEvidenceSnapshot(evidence);
  const { data: run, error: runError } = await supabase
    .from("runs")
    .insert({
      project_id: projectId,
      owner_id: user.id,
      workflow: "generate_prd",
      step_name: "stream_prd",
      status: "running",
      idempotency_key: `generate_prd:${projectId}:${randomUUID()}`,
      model: PRD_MODEL_ID,
      started_at: new Date().toISOString(),
      input_refs: { prompt_version: PRD_PROMPT_VERSION, evidence: snapshot },
    })
    .select("id")
    .single();
  if (runError || !run) {
    console.error("[prd/generate] could not create run", { projectId, code: runError?.code });
    return jsonError(500, "Could not start PRD generation.");
  }
  const runId: string = run.id;

  const finishRun = async (
    update: { status: "succeeded" } | { status: "failed"; message: string },
    outputRefs: Record<string, unknown> = {},
  ) => {
    const { error } = await supabase
      .from("runs")
      .update({
        status: update.status,
        finished_at: new Date().toISOString(),
        output_refs: outputRefs,
        ...(update.status === "failed"
          ? { error_code: "AI_FAILED", error_message: update.message.slice(0, 1000) }
          : {}),
      })
      .eq("id", runId);
    if (error) console.error("[prd/generate] could not finalize run", { runId, code: error.code });
  };

  const result = streamText({
    model,
    system: PRD_SYSTEM_PROMPT,
    prompt: buildPrdPrompt(evidence),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRetries: 2,
    abortSignal: request.signal,
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let chars = 0;
      try {
        for await (const part of result.stream) {
          if (part.type === "text-delta") {
            chars += part.text.length;
            controller.enqueue(encoder.encode(part.text));
          } else if (part.type === "error") {
            throw part.error;
          } else if (part.type === "abort") {
            throw new Error("Generation was cancelled.");
          } else if (part.type === "finish") {
            if (part.finishReason === "length") {
              throw new Error("The PRD hit the model's output limit and was cut off.");
            }
            await finishRun({ status: "succeeded" }, {
              chars,
              finish_reason: part.finishReason,
              output_tokens: part.totalUsage.outputTokens ?? null,
            });
          }
        }
        controller.close();
      } catch (error) {
        const message = describeStreamError(error);
        console.error("[prd/generate] stream failed", {
          runId,
          name: error instanceof Error ? error.name : typeof error,
          message,
        });
        await finishRun({ status: "failed", message }, { chars });
        controller.error(new Error(message));
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Run-Id": runId,
    },
  });
}

function describeStreamError(error: unknown): string {
  if (error && typeof error === "object" && "statusCode" in error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 401) return "OpenRouter rejected the API key (401).";
    if (status === 402) return "OpenRouter account has insufficient credits (402).";
    if (status === 429) return "OpenRouter rate limit reached (429). Try again shortly.";
    return `The AI provider request failed${status ? ` (${status})` : ""}.`;
  }
  return error instanceof Error ? error.message : "PRD generation failed.";
}

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
