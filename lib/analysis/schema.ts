import { z } from "zod";

/**
 * Zod schema for the structured output of discovery analysis (FR-003).
 *
 * The model is shown the source ID and numbered chunks, and must cite them on
 * every finding. `source_id` is deliberately a plain string here rather than
 * `z.uuid()`: a hallucinated ID should reject that one finding during
 * reference validation, not fail the whole response at parse time.
 *
 * Every field is required (no `.optional()`) because strict JSON-schema mode
 * on OpenRouter rejects optional properties; "no evidence" is an empty array.
 */

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export const severitySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof severitySchema>;

const MAX_FINDINGS_PER_TYPE = 25;

const evidenceFields = {
  source_id: z
    .string()
    .describe("The exact source ID given in the prompt. Never invent or modify an ID."),
  evidence_chunk_indexes: z
    .array(z.int().min(0))
    .max(10)
    .describe(
      "Indexes of the <chunk> elements this finding is based on. Use only indexes shown in the prompt.",
    ),
  category: z
    .string()
    .max(80)
    .describe("Short topic label, e.g. 'users', 'pricing', 'scope', 'technical', 'compliance'."),
  severity: severitySchema.describe("Impact on the product if this is wrong or left unresolved."),
};

export const analysisAssumptionSchema = z.object({
  statement: z
    .string()
    .min(1)
    .max(1000)
    .describe("An unstated or unvalidated belief the source relies on, phrased as a claim."),
  rationale: z.string().max(1000).describe("Why this is an assumption rather than established fact."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("How confident you are that the source actually relies on this assumption (0-1)."),
  ...evidenceFields,
});

export const analysisGapSchema = z.object({
  question: z
    .string()
    .min(1)
    .max(1000)
    .describe("The clarification question that would close this information gap."),
  description: z.string().max(1000).describe("What information is missing and why it matters."),
  ...evidenceFields,
});

export const analysisContradictionSchema = z.object({
  description: z
    .string()
    .min(1)
    .max(1000)
    .describe("The two (or more) statements that conflict, and how they conflict."),
  question: z
    .string()
    .min(1)
    .max(1000)
    .describe("The clarification question that would resolve the contradiction."),
  ...evidenceFields,
});

export const discoveryAnalysisSchema = z.object({
  assumptions: z.array(analysisAssumptionSchema).max(MAX_FINDINGS_PER_TYPE),
  gaps: z.array(analysisGapSchema).max(MAX_FINDINGS_PER_TYPE),
  contradictions: z.array(analysisContradictionSchema).max(MAX_FINDINGS_PER_TYPE),
});

export type DiscoveryAnalysis = z.infer<typeof discoveryAnalysisSchema>;
export type AnalysisAssumption = z.infer<typeof analysisAssumptionSchema>;
export type AnalysisGap = z.infer<typeof analysisGapSchema>;
export type AnalysisContradiction = z.infer<typeof analysisContradictionSchema>;
