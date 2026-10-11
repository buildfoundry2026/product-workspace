import "server-only";
import type { createClient } from "@/utils/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Per-source and total caps keep the prompt inside the model's context window. */
const MAX_SOURCE_CHARS = 30_000;
const MAX_TOTAL_SOURCE_CHARS = 100_000;

export type RequirementSource = {
  id: string;
  version: number;
  kind: string;
  title: string;
  content: string;
  truncated: boolean;
};

export type RequirementGap = {
  id: string;
  question: string;
  /** The clarification_answer source that resolved this gap. */
  answerSourceId: string;
};

export type ExistingRequirement = {
  id: string;
  refCode: string;
  title: string;
  description: string;
};

export type RequirementEvidence = {
  project: { id: string; name: string; description: string | null; status: string };
  sources: RequirementSource[];
  resolvedGaps: RequirementGap[];
  existingRequirements: ExistingRequirement[];
};

export type LoadRequirementEvidenceResult =
  | { ok: true; evidence: RequirementEvidence }
  | { ok: false; code: "NOT_FOUND" | "DB_ERROR"; message: string };

/**
 * FR-005: loads the evidence requirements are generated from.
 *
 * "Approved" evidence is every source whose ingestion completed and that has
 * text, including clarification answers written for resolved gaps. Briefs and
 * notes come first so they are never squeezed out by the size budget. All
 * reads go through RLS.
 */
export async function loadRequirementEvidence(
  supabase: Supabase,
  projectId: string,
): Promise<LoadRequirementEvidenceResult> {
  const [projectRes, sourcesRes, gapsRes, requirementsRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, description, status")
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("sources")
      .select("id, version, kind, title, content, created_at")
      .eq("project_id", projectId)
      .eq("processing_status", "completed")
      .not("content", "is", null)
      .order("created_at", { ascending: true }),
    supabase
      .from("gaps")
      .select("id, question, resolution_source_id")
      .eq("project_id", projectId)
      .eq("status", "resolved")
      .not("resolution_source_id", "is", null)
      .order("created_at", { ascending: true }),
    supabase
      .from("requirements")
      .select("id, ref_code, title, description")
      .eq("project_id", projectId)
      .order("ref_code", { ascending: true }),
  ]);

  const failed = [projectRes, sourcesRes, gapsRes, requirementsRes].find((r) => r.error);
  if (failed?.error) {
    console.error("[loadRequirementEvidence] query failed", { projectId, code: failed.error.code });
    return { ok: false, code: "DB_ERROR", message: "Could not load project evidence." };
  }
  if (!projectRes.data) {
    return { ok: false, code: "NOT_FOUND", message: "Project not found." };
  }

  const rows = [...(sourcesRes.data ?? [])].sort(
    (a, b) =>
      Number(a.kind === "clarification_answer") - Number(b.kind === "clarification_answer"),
  );

  let budget = MAX_TOTAL_SOURCE_CHARS;
  const sources: RequirementSource[] = [];
  for (const row of rows) {
    const full: string = row.content ?? "";
    const limit = Math.max(0, Math.min(MAX_SOURCE_CHARS, budget));
    if (limit === 0 || !full.trim()) continue;
    const content = full.slice(0, limit);
    budget -= content.length;
    sources.push({
      id: row.id,
      version: row.version,
      kind: row.kind,
      title: row.title,
      content,
      truncated: content.length < full.length,
    });
  }

  const shownSourceIds = new Set(sources.map((s) => s.id));
  const resolvedGaps: RequirementGap[] = (gapsRes.data ?? [])
    .filter((g) => g.resolution_source_id && shownSourceIds.has(g.resolution_source_id))
    .map((g) => ({ id: g.id, question: g.question, answerSourceId: g.resolution_source_id as string }));

  return {
    ok: true,
    evidence: {
      project: projectRes.data,
      sources,
      resolvedGaps,
      existingRequirements: (requirementsRes.data ?? []).map((r) => ({
        id: r.id,
        refCode: r.ref_code,
        title: r.title,
        description: r.description,
      })),
    },
  };
}
