import type { GeneratedRequirement } from "./schema";

export type ValidatedRequirement = GeneratedRequirement & {
  /** Canonical (lower-case) source UUID confirmed to exist in the database. */
  sourceId: string;
};

export type RejectedRequirement = {
  title: string;
  reason: "unknown_source" | "duplicate";
  sourceReferenceId?: string;
};

export type RequirementValidationResult = {
  valid: ValidatedRequirement[];
  rejected: RejectedRequirement[];
};

/**
 * Evidence-integrity gate for AI-generated requirements.
 *
 * `existingSourceIds` must come from a database query, never from model
 * output. Any requirement citing an ID outside that set is rejected, as is
 * any requirement whose title duplicates an existing requirement or an
 * earlier one in the same batch.
 */
export function validateRequirementReferences(
  items: readonly GeneratedRequirement[],
  context: { existingSourceIds: ReadonlySet<string>; existingTitles: Iterable<string> },
): RequirementValidationResult {
  const seenTitles = new Set<string>();
  for (const title of context.existingTitles) seenTitles.add(normalizeTitle(title));

  const valid: ValidatedRequirement[] = [];
  const rejected: RejectedRequirement[] = [];

  for (const item of items) {
    const sourceId = item.source_reference_id.trim().toLowerCase();
    if (!context.existingSourceIds.has(sourceId)) {
      rejected.push({
        title: item.title,
        reason: "unknown_source",
        sourceReferenceId: item.source_reference_id.slice(0, 64),
      });
      continue;
    }

    const key = normalizeTitle(item.title);
    if (!key || seenTitles.has(key)) {
      rejected.push({ title: item.title, reason: "duplicate" });
      continue;
    }
    seenTitles.add(key);
    valid.push({ ...item, sourceId });
  }

  return { valid, rejected };
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
