"use server";

import { randomUUID } from "node:crypto";
import { APICallError, generateText, NoObjectGeneratedError, Output } from "ai";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOwner } from "@/utils/supabase/require-owner";
import { ANALYSIS_MODEL_ID, getAnalysisModel, MissingApiKeyError } from "@/lib/ai/openrouter";
import { loadRequirementEvidence, type RequirementEvidence } from "@/lib/requirements/evidence";
import {
  buildRequirementsPrompt,
  REQUIREMENTS_PROMPT_VERSION,
  REQUIREMENTS_SYSTEM_PROMPT,
} from "@/lib/requirements/prompt";
import {
  PRIORITY_TO_DB,
  requirementsOutputSchema,
  type GeneratedRequirement,
} from "@/lib/requirements/schema";
import {
  validateRequirementReferences,
  type RequirementValidationResult,
  type ValidatedRequirement,
} from "@/lib/requirements/validate";

const AI_TIMEOUT_MS = 150_000;
/** A run still 'running' after this long is treated as abandoned. */
const STALE_RUN_MS = 10 * 60 * 1000;
const REF_PREFIX = "REQ";

export type GenerateRequirementsErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "PROJECT_NOT_FOUND"
  | "NOT_READY"
  | "ALREADY_RUNNING"
  | "CONFLICT"
  | "AI_FAILED"
  | "PROCESSING_FAILED";

export type GenerateRequirementsResult =
  | {
      ok: true;
      runId: string;
      insertedCount: number;
      /** Dropped because they cited a source ID that does not exist in this project. */
      rejectedCount: number;
      /** Dropped because they duplicate an existing requirement or another one in the batch. */
      duplicateCount: number;
    }
  | { ok: false; code: GenerateRequirementsErrorCode; message: string };

type Owner = NonNullable<Awaited<ReturnType<typeof getOwner>>>;
type Supabase = Owner["supabase"];

/**
 * FR-005: generate atomic requirements from the project's approved evidence.
 *
 * The model's structured output is validated with Zod, then every cited
 * `source_reference_id` is checked against rows re-queried from the database;
 * requirements citing anything else are rejected. Surviving requirements are
 * appended (never replacing existing ones) with a `derived_from` link to their
 * source. Each invocation is recorded in `runs`; a concurrent run for the same
 * project is refused, and a failure while saving links removes the
 * requirements inserted by that run.
 */
export async function generateRequirements(projectId: string): Promise<GenerateRequirementsResult> {
  const parsedId = z.uuid().safeParse(projectId);
  if (!parsedId.success) {
    return fail("INVALID_INPUT", "Invalid project ID.");
  }

  const owner = await getOwner();
  if (!owner) {
    return fail("UNAUTHORIZED", "You must be signed in as the workspace owner.");
  }
  const { supabase, user } = owner;

  const loaded = await loadRequirementEvidence(supabase, parsedId.data);
  if (!loaded.ok) {
    return fail(loaded.code === "NOT_FOUND" ? "PROJECT_NOT_FOUND" : "PROCESSING_FAILED", loaded.message);
  }
  const { evidence } = loaded;

  if (evidence.project.status === "archived") {
    return fail("NOT_READY", "Requirements cannot be generated for archived projects.");
  }
  if (evidence.sources.length === 0) {
    return fail("NOT_READY", "Add a source and wait for it to finish processing before generating requirements.");
  }

  const guard = await guardConcurrentRuns(supabase, evidence.project.id);
  if (guard) return guard;

  let runId: string | null = null;
  try {
    runId = await startRun(supabase, {
      projectId: evidence.project.id,
      ownerId: user.id,
      inputRefs: {
        prompt_version: REQUIREMENTS_PROMPT_VERSION,
        sources: Object.fromEntries(evidence.sources.map((s) => [s.id, s.version])),
        resolved_gaps: evidence.resolvedGaps.map((g) => g.id),
        existing_requirement_count: evidence.existingRequirements.length,
      },
    });

    const generated = await runModel(evidence);
    const validated = await validateReferences(supabase, evidence, generated);
    const rejectedCount = validated.rejected.filter((r) => r.reason === "unknown_source").length;
    const duplicateCount = validated.rejected.length - rejectedCount;
    if (rejectedCount > 0) {
      // IDs and reasons only; never log source content (PRD §9).
      console.warn("[generateRequirements] rejected requirements citing unknown sources", {
        projectId: evidence.project.id,
        runId,
        rejected: validated.rejected.filter((r) => r.reason === "unknown_source"),
      });
    }

    const requirementIds = await persistRequirements(supabase, {
      requirements: validated.valid,
      evidence,
      ownerId: user.id,
      runId,
    });

    const { error: runDoneError } = await supabase
      .from("runs")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        output_refs: {
          requirement_ids: requirementIds,
          generated_count: generated.length,
          rejected_count: rejectedCount,
          duplicate_count: duplicateCount,
        },
      })
      .eq("id", runId);
    if (runDoneError) {
      // The requirements are saved; only the bookkeeping failed.
      console.error("[generateRequirements] could not finalize run", { runId, code: runDoneError.code });
    }

    revalidateProject(evidence.project.id);
    return { ok: true, runId, insertedCount: requirementIds.length, rejectedCount, duplicateCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Requirement generation failed.";
    console.error("[generateRequirements] generation failed", {
      projectId: evidence.project.id,
      runId,
      name: error instanceof Error ? error.name : typeof error,
      message,
    });
    if (runId) await markRunFailed(supabase, runId, error, message);
    revalidateProject(evidence.project.id);
    if (error instanceof ConflictError) return fail("CONFLICT", message);
    return fail(error instanceof AiError ? "AI_FAILED" : "PROCESSING_FAILED", message);
  }
}

// -----------------------------------------------------------------------------
// Steps
// -----------------------------------------------------------------------------

/**
 * Refuses to start while another generation for the project is in flight.
 * Runs left 'running' past STALE_RUN_MS (e.g. the server was killed) are
 * marked failed so they stop blocking new runs.
 */
async function guardConcurrentRuns(
  supabase: Supabase,
  projectId: string,
): Promise<GenerateRequirementsResult | null> {
  const cutoff = new Date(Date.now() - STALE_RUN_MS).toISOString();

  const { error: staleError } = await supabase
    .from("runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error_code: "ABANDONED",
      error_message: "The run did not finish and was abandoned.",
    })
    .eq("project_id", projectId)
    .eq("workflow", "generate_requirements")
    .eq("status", "running")
    .lt("started_at", cutoff);
  if (staleError) {
    console.error("[generateRequirements] could not expire stale runs", { projectId, code: staleError.code });
  }

  const { data, error } = await supabase
    .from("runs")
    .select("id")
    .eq("project_id", projectId)
    .eq("workflow", "generate_requirements")
    .eq("status", "running")
    .gte("started_at", cutoff)
    .limit(1);
  if (error) {
    console.error("[generateRequirements] could not check active runs", { projectId, code: error.code });
    return fail("PROCESSING_FAILED", describeDbError("Could not check for running generations", error));
  }
  if (data && data.length > 0) {
    return fail("ALREADY_RUNNING", "Requirements are already being generated for this project.");
  }
  return null;
}

async function startRun(
  supabase: Supabase,
  args: { projectId: string; ownerId: string; inputRefs: Record<string, unknown> },
): Promise<string> {
  const { data, error } = await supabase
    .from("runs")
    .insert({
      project_id: args.projectId,
      owner_id: args.ownerId,
      workflow: "generate_requirements",
      step_name: "generate_requirements",
      status: "running",
      idempotency_key: `generate_requirements:${args.projectId}:${randomUUID()}`,
      model: ANALYSIS_MODEL_ID,
      started_at: new Date().toISOString(),
      input_refs: args.inputRefs,
    })
    .select("id")
    .single();
  if (error || !data) throw new DbError("Could not record the generation run", error);
  return data.id;
}

async function runModel(evidence: RequirementEvidence): Promise<GeneratedRequirement[]> {
  try {
    const { output } = await generateText({
      model: getAnalysisModel(),
      output: Output.object({ schema: requirementsOutputSchema }),
      system: REQUIREMENTS_SYSTEM_PROMPT,
      prompt: buildRequirementsPrompt(evidence),
      maxRetries: 2,
      abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    return output.requirements;
  } catch (error) {
    throw new AiError(error);
  }
}

/**
 * Builds the allowed-source set from database rows only. A cited ID counts
 * only if it is a completed source of this project AND was shown to the model
 * in this run, so neither invented IDs nor IDs from other projects survive.
 */
async function validateReferences(
  supabase: Supabase,
  evidence: RequirementEvidence,
  generated: GeneratedRequirement[],
): Promise<RequirementValidationResult> {
  const shown = new Set(evidence.sources.map((s) => s.id));
  const cited = [
    ...new Set(
      generated
        .map((r) => r.source_reference_id.trim().toLowerCase())
        .filter((id) => z.uuid().safeParse(id).success),
    ),
  ];

  const existingSourceIds = new Set<string>();
  if (cited.length > 0) {
    const { data, error } = await supabase
      .from("sources")
      .select("id")
      .eq("project_id", evidence.project.id)
      .eq("processing_status", "completed")
      .in("id", cited);
    if (error) throw new DbError("Could not verify cited sources", error);
    for (const row of data ?? []) {
      if (shown.has(row.id)) existingSourceIds.add(row.id);
    }
  }

  return validateRequirementReferences(generated, {
    existingSourceIds,
    existingTitles: evidence.existingRequirements.map((r) => r.title),
  });
}

async function persistRequirements(
  supabase: Supabase,
  args: {
    requirements: ValidatedRequirement[];
    evidence: RequirementEvidence;
    ownerId: string;
    runId: string;
  },
): Promise<string[]> {
  const { requirements, evidence, ownerId, runId } = args;
  if (requirements.length === 0) return [];

  const projectId = evidence.project.id;
  const common = { project_id: projectId, owner_id: ownerId, created_by: "ai", created_by_run_id: runId };
  let next = nextRefNumber(evidence.existingRequirements.map((r) => r.refCode));

  // IDs are generated here so links can reference rows without relying on RETURNING order.
  const rows = requirements.map((req) => ({
    ...common,
    id: randomUUID(),
    ref_code: `${REF_PREFIX}-${String(next++).padStart(3, "0")}`,
    title: req.title.trim(),
    description: req.description.trim(),
    requirement_type: req.type,
    priority: PRIORITY_TO_DB[req.priority],
    status: "draft",
    evidence_status: "evidence_backed",
    review_status: "pending",
    acceptance_criteria_status: "missing",
  }));

  const { error: insertError } = await supabase.from("requirements").insert(rows);
  if (insertError) {
    if (insertError.code === "23505") {
      throw new ConflictError(
        "Another change to this project's requirements happened at the same time. Try again.",
      );
    }
    throw new DbError("Could not save requirements", insertError);
  }

  const links = rows.map((row, i) => ({
    ...common,
    from_type: "requirement",
    from_id: row.id,
    to_type: "source",
    to_id: requirements[i].sourceId,
    relation: "derived_from",
    metadata: { prompt_version: REQUIREMENTS_PROMPT_VERSION, model: ANALYSIS_MODEL_ID },
  }));

  const { error: linkError } = await supabase.from("links").insert(links);
  if (linkError) {
    // Requirements without their traceability link must not survive (FR-007).
    const ids = rows.map((r) => r.id);
    const { error: cleanupError } = await supabase.from("requirements").delete().in("id", ids);
    if (cleanupError) {
      console.error("[generateRequirements] could not remove unlinked requirements", {
        runId,
        code: cleanupError.code,
      });
    }
    throw new DbError("Could not save requirement traceability links", linkError);
  }

  return rows.map((r) => r.id);
}

function nextRefNumber(refCodes: string[]): number {
  const pattern = new RegExp(`^${REF_PREFIX}-(\\d+)$`);
  let max = 0;
  for (const code of refCodes) {
    const match = pattern.exec(code);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

async function markRunFailed(supabase: Supabase, runId: string, error: unknown, message: string) {
  const { error: updateError } = await supabase
    .from("runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error_code: error instanceof AiError ? "AI_FAILED" : "PROCESSING_FAILED",
      error_message: message.slice(0, 1000),
      error_details: { name: error instanceof Error ? error.name : typeof error },
    })
    .eq("id", runId);
  if (updateError) {
    console.error("[generateRequirements] could not mark run failed", { runId, code: updateError.code });
  }
}

function revalidateProject(projectId: string) {
  revalidatePath(`/projects/${projectId}/requirements`);
  revalidatePath(`/projects/${projectId}`);
}

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

class DbError extends Error {
  constructor(context: string, cause: { message: string; code?: string } | null) {
    super(describeDbError(context, cause));
    this.name = "DbError";
  }
}

class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

class AiError extends Error {
  constructor(cause: unknown) {
    super(describeAiError(cause), { cause });
    this.name = "AiError";
  }
}

function describeDbError(context: string, cause: { message: string; code?: string } | null): string {
  return cause?.code === "42501"
    ? `${context}: the database denied access. Check that the owner account is provisioned.`
    : `${context}.`;
}

function describeAiError(error: unknown): string {
  if (error instanceof MissingApiKeyError) {
    return error.message;
  }
  if (NoObjectGeneratedError.isInstance(error)) {
    return "The model returned output that did not match the requirements schema. Try again.";
  }
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401) return "OpenRouter rejected the API key (401).";
    if (error.statusCode === 402) return "OpenRouter account has insufficient credits (402).";
    if (error.statusCode === 429) return "OpenRouter rate limit reached (429). Try again shortly.";
    return `The AI provider request failed${error.statusCode ? ` (${error.statusCode})` : ""}.`;
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "The AI provider took too long to respond. Try again.";
  }
  return "The AI provider request failed.";
}

function fail(code: GenerateRequirementsErrorCode, message: string): GenerateRequirementsResult {
  return { ok: false, code, message };
}
