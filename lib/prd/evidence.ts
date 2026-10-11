import "server-only";
import type { createClient } from "@/utils/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Per-source and total caps keep the prompt inside the model's context window. */
const MAX_SOURCE_CHARS = 30_000;
const MAX_TOTAL_SOURCE_CHARS = 100_000;

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export type EvidenceSource = {
  label: string;
  id: string;
  version: number;
  kind: string;
  title: string;
  content: string;
  truncated: boolean;
};

export type EvidenceGap = {
  label: string;
  id: string;
  gapType: string;
  question: string;
  description: string | null;
  severity: string;
  status: string;
  answer: { sourceId: string; version: number; content: string } | null;
};

export type EvidenceAssumption = {
  label: string;
  id: string;
  statement: string;
  category: string | null;
  severity: string;
  confidence: number | null;
  status: string;
  validationNotes: string | null;
};

export type PrdEvidence = {
  project: { id: string; name: string; description: string | null; status: string };
  sources: EvidenceSource[];
  resolvedGaps: EvidenceGap[];
  openGaps: EvidenceGap[];
  assumptions: EvidenceAssumption[];
};

/**
 * Snapshot of exactly which evidence (and which versions) a PRD was generated
 * from. Stored in runs.input_refs at generation time and copied into
 * artifacts.generated_from_version on save, so the client never supplies IDs.
 */
export type EvidenceSnapshot = {
  sources: Record<string, number>;
  gaps: string[];
  assumptions: string[];
  /** Citation label used in the Markdown (e.g. "S1") -> record it refers to. */
  citation_labels: Record<string, { type: "source" | "gap" | "assumption"; id: string }>;
};

export type LoadEvidenceResult =
  | { ok: true; evidence: PrdEvidence }
  | { ok: false; code: "NOT_FOUND" | "DB_ERROR"; message: string };

/**
 * FR-006: loads everything a PRD is generated from: the project's original
 * sources, resolved gaps with their answers, still-open gaps, and assumptions.
 * Every record gets a stable citation label (S1, G1, Q1, A1) in a deterministic
 * order. All reads go through RLS.
 */
export async function loadPrdEvidence(
  supabase: Supabase,
  projectId: string,
): Promise<LoadEvidenceResult> {
  const [projectRes, sourcesRes, gapsRes, assumptionsRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, description, status")
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("sources")
      .select("id, version, kind, title, content, created_at")
      .eq("project_id", projectId)
      .neq("kind", "clarification_answer")
      .not("content", "is", null)
      .order("created_at", { ascending: true }),
    supabase
      .from("gaps")
      .select("id, gap_type, question, description, severity, status, resolution_source_id, created_at")
      .eq("project_id", projectId)
      .neq("status", "dismissed")
      .order("created_at", { ascending: true }),
    supabase
      .from("assumptions")
      .select("id, statement, category, severity, confidence, status, validation_notes, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
  ]);

  const failed = [projectRes, sourcesRes, gapsRes, assumptionsRes].find((r) => r.error);
  if (failed?.error) {
    console.error("[loadPrdEvidence] query failed", { projectId, code: failed.error.code });
    return { ok: false, code: "DB_ERROR", message: "Could not load project evidence." };
  }
  if (!projectRes.data) {
    return { ok: false, code: "NOT_FOUND", message: "Project not found." };
  }

  const gaps = [...(gapsRes.data ?? [])].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9),
  );

  const answerIds = gaps
    .map((g) => g.resolution_source_id)
    .filter((id): id is string => typeof id === "string");
  const answers = new Map<string, { version: number; content: string }>();
  if (answerIds.length > 0) {
    const { data, error } = await supabase
      .from("sources")
      .select("id, version, content")
      .eq("project_id", projectId)
      .in("id", answerIds);
    if (error) {
      console.error("[loadPrdEvidence] answer query failed", { projectId, code: error.code });
      return { ok: false, code: "DB_ERROR", message: "Could not load clarification answers." };
    }
    for (const row of data ?? []) {
      if (row.content) answers.set(row.id, { version: row.version, content: row.content });
    }
  }

  let budget = MAX_TOTAL_SOURCE_CHARS;
  const sources: EvidenceSource[] = (sourcesRes.data ?? []).map((row, i) => {
    const full: string = row.content ?? "";
    const limit = Math.max(0, Math.min(MAX_SOURCE_CHARS, budget));
    const content = full.slice(0, limit);
    budget -= content.length;
    return {
      label: `S${i + 1}`,
      id: row.id,
      version: row.version,
      kind: row.kind,
      title: row.title,
      content,
      truncated: content.length < full.length,
    };
  });

  const toGap = (row: (typeof gaps)[number], label: string): EvidenceGap => {
    const answer = row.resolution_source_id ? answers.get(row.resolution_source_id) : undefined;
    return {
      label,
      id: row.id,
      gapType: row.gap_type,
      question: row.question,
      description: row.description,
      severity: row.severity,
      status: row.status,
      answer:
        answer && row.resolution_source_id
          ? { sourceId: row.resolution_source_id, ...answer }
          : null,
    };
  };

  const resolved = gaps.filter((g) => g.status === "resolved" || g.status === "answered");
  const open = gaps.filter((g) => g.status === "open");

  return {
    ok: true,
    evidence: {
      project: projectRes.data,
      sources,
      resolvedGaps: resolved.map((row, i) => toGap(row, `G${i + 1}`)),
      openGaps: open.map((row, i) => toGap(row, `Q${i + 1}`)),
      assumptions: (assumptionsRes.data ?? []).map((row, i) => ({
        label: `A${i + 1}`,
        id: row.id,
        statement: row.statement,
        category: row.category,
        severity: row.severity,
        confidence: row.confidence === null ? null : Number(row.confidence),
        status: row.status,
        validationNotes: row.validation_notes,
      })),
    },
  };
}

export function buildEvidenceSnapshot(evidence: PrdEvidence): EvidenceSnapshot {
  const snapshot: EvidenceSnapshot = { sources: {}, gaps: [], assumptions: [], citation_labels: {} };

  for (const s of evidence.sources) {
    snapshot.sources[s.id] = s.version;
    snapshot.citation_labels[s.label] = { type: "source", id: s.id };
  }
  for (const g of [...evidence.resolvedGaps, ...evidence.openGaps]) {
    snapshot.gaps.push(g.id);
    snapshot.citation_labels[g.label] = { type: "gap", id: g.id };
    if (g.answer) snapshot.sources[g.answer.sourceId] = g.answer.version;
  }
  for (const a of evidence.assumptions) {
    snapshot.assumptions.push(a.id);
    snapshot.citation_labels[a.label] = { type: "assumption", id: a.id };
  }
  return snapshot;
}
