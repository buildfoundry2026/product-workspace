import type {
  AnalysisAssumption,
  AnalysisContradiction,
  AnalysisGap,
  DiscoveryAnalysis,
} from "./schema";

/** A finding whose references all resolved to persisted rows. */
export type Validated<T> = T & {
  /** Confirmed to exist in `sources` within the analyzed project. */
  sourceId: string;
  /** Persisted `chunks.id` values resolved from the cited chunk indexes (deduplicated). */
  chunkIds: string[];
};

export type RejectedFinding = {
  kind: "assumption" | "gap" | "contradiction";
  index: number;
  reason: "unknown_source_id" | "unknown_chunk_index";
};

export type ValidatedAnalysis = {
  assumptions: Validated<AnalysisAssumption>[];
  gaps: Validated<AnalysisGap>[];
  contradictions: Validated<AnalysisContradiction>[];
  rejected: RejectedFinding[];
};

export type ReferenceIndex = {
  /**
   * Source IDs confirmed to exist in the database (in the analyzed project)
   * AND that were shown to the model. A real but unrelated source ID is still
   * a hallucinated citation.
   */
  existingSourceIds: ReadonlySet<string>;
  /** chunk_index -> chunks.id, keyed by source ID, loaded from the database. */
  chunkIdsBySource: ReadonlyMap<string, ReadonlyMap<number, string>>;
};

/**
 * Evidence-integrity gate (PRD FR-003, .cursorrules rule 1).
 *
 * Every finding must cite a source ID and chunk indexes that resolve to rows
 * loaded from the database. Findings with any unresolvable reference are
 * rejected outright rather than partially repaired, so nothing the model
 * invented can reach `assumptions`, `gaps`, or `links`.
 */
export function validateAnalysisReferences(
  analysis: DiscoveryAnalysis,
  refs: ReferenceIndex,
): ValidatedAnalysis {
  const rejected: RejectedFinding[] = [];

  function check<T extends { source_id: string; evidence_chunk_indexes: number[] }>(
    kind: RejectedFinding["kind"],
    findings: T[],
  ): Validated<T>[] {
    const accepted: Validated<T>[] = [];

    findings.forEach((finding, index) => {
      const sourceId = finding.source_id.trim().toLowerCase();
      if (!refs.existingSourceIds.has(sourceId)) {
        rejected.push({ kind, index, reason: "unknown_source_id" });
        return;
      }

      const chunkMap = refs.chunkIdsBySource.get(sourceId);
      const chunkIds = new Set<string>();
      for (const chunkIndex of finding.evidence_chunk_indexes) {
        const chunkId = chunkMap?.get(chunkIndex);
        if (!chunkId) {
          rejected.push({ kind, index, reason: "unknown_chunk_index" });
          return;
        }
        chunkIds.add(chunkId);
      }

      accepted.push({ ...finding, sourceId, chunkIds: [...chunkIds] });
    });

    return accepted;
  }

  return {
    assumptions: check("assumption", analysis.assumptions),
    gaps: check("gap", analysis.gaps),
    contradictions: check("contradiction", analysis.contradictions),
    rejected,
  };
}
