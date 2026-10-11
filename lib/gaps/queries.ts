import "server-only";
import { getOwner } from "@/utils/supabase/require-owner";

export type GapSeverity = "critical" | "high" | "medium" | "low";

export type UnresolvedGap = {
  id: string;
  gap_type: "information_gap" | "contradiction" | "clarification_question";
  question: string;
  description: string | null;
  category: string | null;
  severity: GapSeverity;
  priority: number;
  status: "open" | "answered";
  created_at: string;
};

export type UnresolvedGapsResult =
  | { ok: true; gaps: UnresolvedGap[] }
  | { ok: false; message: string };

const SEVERITY_RANK: Record<GapSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * FR-004: unresolved gaps for a project ('open' or 'answered' but not yet
 * resolved), most severe first, then by priority, then oldest first.
 *
 * Severity is sorted here rather than in SQL because the column is text and
 * alphabetical order would not match severity order.
 */
export async function getUnresolvedGaps(projectId: string): Promise<UnresolvedGapsResult> {
  const owner = await getOwner();
  if (!owner) {
    return { ok: false, message: "You must be signed in as the workspace owner." };
  }

  const { data, error } = await owner.supabase
    .from("gaps")
    .select("id, gap_type, question, description, category, severity, priority, status, created_at")
    .eq("project_id", projectId)
    .in("status", ["open", "answered"])
    .returns<UnresolvedGap[]>();

  if (error) {
    console.error("[getUnresolvedGaps] query failed", { projectId, code: error.code });
    return { ok: false, message: "Could not load open questions." };
  }

  const gaps = [...data].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.priority - a.priority ||
      a.created_at.localeCompare(b.created_at),
  );
  return { ok: true, gaps };
}
