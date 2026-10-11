"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOwner } from "@/utils/supabase/require-owner";
import type { EvidenceSnapshot } from "@/lib/prd/evidence";

const savePrdInput = z.object({
  projectId: z.uuid(),
  /** BlockNote document (editor.document). Stored as-is in artifacts.content. */
  blocks: z.array(z.looseObject({ type: z.string() })).min(1).max(10_000),
  /** Markdown export of the same document; artifacts.content_markdown is the export cache. */
  markdown: z.string().max(1_000_000),
  /** Generation run the content came from; null when editing a previously saved version. */
  runId: z.uuid().nullable(),
  /** The saved version the editor started from; null for the first save. */
  previousArtifactId: z.uuid().nullable(),
});

const snapshotSchema = z.object({
  sources: z.record(z.uuid(), z.int()),
  gaps: z.array(z.uuid()),
  assumptions: z.array(z.uuid()),
  citation_labels: z.record(
    z.string(),
    z.object({ type: z.enum(["source", "gap", "assumption"]), id: z.uuid() }),
  ),
});

export type SavePrdInput = z.input<typeof savePrdInput>;

export type SavePrdResult =
  | {
      ok: true;
      artifactId: string;
      version: number;
      /** Citation labels in the Markdown (e.g. "[S9]") that match no evidence record. */
      unknownCitations: string[];
    }
  | {
      ok: false;
      code: "INVALID_INPUT" | "UNAUTHORIZED" | "NOT_FOUND" | "CONFLICT" | "FAILED";
      message: string;
    };

/**
 * FR-006/FR-009: saves the editor content as a new PRD artifact version.
 *
 * Every save inserts a new row in the PRD's lineage (version + 1, linked to the
 * previous version), so history is never overwritten. Evidence provenance is
 * taken from the server-side generation run, never from the client, and every
 * referenced ID is re-checked against the database before traceability links
 * are written.
 */
export async function savePrd(input: SavePrdInput): Promise<SavePrdResult> {
  const parsed = savePrdInput.safeParse(input);
  if (!parsed.success) {
    return fail("INVALID_INPUT", "The editor content could not be saved. It may be empty or too large.");
  }
  const { projectId, blocks, markdown, runId, previousArtifactId } = parsed.data;

  const owner = await getOwner();
  if (!owner) {
    return fail("UNAUTHORIZED", "Your session has expired. Sign in again.");
  }
  const { supabase, user } = owner;

  const [projectRes, latestRes] = await Promise.all([
    supabase.from("projects").select("name, status").eq("id", projectId).maybeSingle(),
    supabase
      .from("artifacts")
      .select("id, lineage_id, version, generated_from_version")
      .eq("project_id", projectId)
      .eq("artifact_type", "prd")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (projectRes.error || latestRes.error) {
    return dbFailure("Could not load the project", projectRes.error ?? latestRes.error);
  }
  if (!projectRes.data) {
    return fail("NOT_FOUND", "Project not found.");
  }
  if (projectRes.data.status === "archived") {
    return fail("CONFLICT", "PRDs in archived projects cannot be changed.");
  }

  const latest = latestRes.data;
  if ((latest?.id ?? null) !== previousArtifactId) {
    return fail(
      "CONFLICT",
      "A newer version of this PRD was saved elsewhere. Reload the page before saving.",
    );
  }

  // Provenance: from the generation run when there is one, else inherited.
  let snapshot: EvidenceSnapshot = { sources: {}, gaps: [], assumptions: [], citation_labels: {} };
  let promptVersion: string | null = null;
  if (runId) {
    const { data: run, error } = await supabase
      .from("runs")
      .select("input_refs")
      .eq("id", runId)
      .eq("project_id", projectId)
      .eq("workflow", "generate_prd")
      .maybeSingle();
    if (error) return dbFailure("Could not load the generation run", error);
    const refs = run?.input_refs as { evidence?: unknown; prompt_version?: string } | undefined;
    const parsedSnapshot = snapshotSchema.safeParse(refs?.evidence);
    if (!parsedSnapshot.success) {
      return fail("INVALID_INPUT", "The generation run for this PRD could not be found.");
    }
    snapshot = parsedSnapshot.data;
    promptVersion = refs?.prompt_version ?? null;
  } else if (latest) {
    const inherited = snapshotSchema.safeParse(latest.generated_from_version);
    if (inherited.success) snapshot = inherited.data;
  }

  let verified: EvidenceSnapshot;
  try {
    verified = await verifySnapshot(supabase, projectId, snapshot);
  } catch (error) {
    return dbFailure("Could not verify PRD evidence", error as { message: string; code?: string });
  }

  const artifactId = randomUUID();
  const version = latest ? latest.version + 1 : 1;
  const { error: insertError } = await supabase.from("artifacts").insert({
    id: artifactId,
    project_id: projectId,
    owner_id: user.id,
    artifact_type: "prd",
    title: `${projectRes.data.name} — PRD`.slice(0, 300),
    content: blocks,
    content_markdown: markdown,
    lineage_id: latest?.lineage_id ?? randomUUID(),
    version,
    previous_version_id: latest?.id ?? null,
    status: "draft",
    generated_from_version: {
      ...verified,
      run_id: runId ?? (latest?.generated_from_version as { run_id?: string } | null)?.run_id ?? null,
      prompt_version: promptVersion,
    },
    created_by: "user",
    created_by_run_id: runId,
  });
  if (insertError) {
    if (insertError.code === "23505") {
      return fail("CONFLICT", "A newer version of this PRD was saved elsewhere. Reload the page before saving.");
    }
    return dbFailure("Could not save the PRD", insertError);
  }

  const links = buildLinks(verified, { projectId, ownerId: user.id, artifactId, runId });
  if (links.length > 0) {
    const { error: linkError } = await supabase.from("links").insert(links);
    if (linkError) {
      // Compensate so a PRD is never stored without its traceability records.
      await supabase.from("artifacts").delete().eq("id", artifactId);
      return dbFailure("Could not save PRD traceability links", linkError);
    }
  }

  revalidatePath(`/projects/${projectId}`);

  return {
    ok: true,
    artifactId,
    version,
    unknownCitations: findUnknownCitations(markdown, verified),
  };
}

type Supabase = NonNullable<Awaited<ReturnType<typeof getOwner>>>["supabase"];

/** Keeps only IDs that still exist in this project (deleted or foreign IDs are dropped). */
async function verifySnapshot(
  supabase: Supabase,
  projectId: string,
  snapshot: EvidenceSnapshot,
): Promise<EvidenceSnapshot> {
  const existing = async (table: "sources" | "gaps" | "assumptions", ids: string[]) => {
    if (ids.length === 0) return new Set<string>();
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .eq("project_id", projectId)
      .in("id", ids);
    if (error) throw error;
    return new Set((data ?? []).map((row) => row.id as string));
  };

  const [sources, gaps, assumptions] = await Promise.all([
    existing("sources", Object.keys(snapshot.sources)),
    existing("gaps", snapshot.gaps),
    existing("assumptions", snapshot.assumptions),
  ]);
  const byType = { source: sources, gap: gaps, assumption: assumptions };

  return {
    sources: Object.fromEntries(Object.entries(snapshot.sources).filter(([id]) => sources.has(id))),
    gaps: snapshot.gaps.filter((id) => gaps.has(id)),
    assumptions: snapshot.assumptions.filter((id) => assumptions.has(id)),
    citation_labels: Object.fromEntries(
      Object.entries(snapshot.citation_labels).filter(([, ref]) => byType[ref.type].has(ref.id)),
    ),
  };
}

function buildLinks(
  snapshot: EvidenceSnapshot,
  ctx: { projectId: string; ownerId: string; artifactId: string; runId: string | null },
) {
  const base = {
    project_id: ctx.projectId,
    owner_id: ctx.ownerId,
    from_type: "artifact",
    from_id: ctx.artifactId,
    created_by: "system",
    created_by_run_id: ctx.runId,
  };
  return [
    ...Object.keys(snapshot.sources).map((id) => ({
      ...base,
      to_type: "source",
      to_id: id,
      relation: "derived_from",
    })),
    ...snapshot.gaps.map((id) => ({ ...base, to_type: "gap", to_id: id, relation: "references" })),
    ...snapshot.assumptions.map((id) => ({
      ...base,
      to_type: "assumption",
      to_id: id,
      relation: "references",
    })),
  ];
}

function findUnknownCitations(markdown: string, snapshot: EvidenceSnapshot): string[] {
  const unknown = new Set<string>();
  for (const match of markdown.matchAll(/\[([SGQA]\d{1,4})\]/g)) {
    if (!snapshot.citation_labels[match[1]]) unknown.add(match[1]);
  }
  return [...unknown].sort();
}

function dbFailure(context: string, error: { message: string; code?: string } | null): SavePrdResult {
  console.error(`[savePrd] ${context}`, { code: error?.code });
  return fail(
    "FAILED",
    error?.code === "42501"
      ? `${context}: the database denied access. Check that the owner account is provisioned.`
      : `${context}. Please try again.`,
  );
}

function fail(code: Extract<SavePrdResult, { ok: false }>["code"], message: string): SavePrdResult {
  return { ok: false, code, message };
}
