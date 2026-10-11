import { z } from "zod";

export const REQUIREMENT_TYPES = [
  "functional",
  "non_functional",
  "business_rule",
  "data",
  "integration",
] as const;

export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

export const MAX_GENERATED_REQUIREMENTS = 40;

/**
 * One AI-generated requirement. Every field is required so the schema stays
 * valid under OpenRouter's strict JSON-schema mode.
 */
export const requirementItemSchema = z.object({
  title: z
    .string()
    .min(3)
    .max(200)
    .describe("Short imperative name of the requirement, e.g. 'Export tickets to CSV'."),
  description: z
    .string()
    .min(10)
    .max(2000)
    .describe("One atomic, testable statement of what the system must do, written as 'The system must …'."),
  type: z.enum(REQUIREMENT_TYPES),
  priority: z.enum(["high", "medium", "low"]),
  source_reference_id: z
    .string()
    .describe("The exact id attribute of the single <source> this requirement is derived from."),
});

export const requirementsOutputSchema = z.object({
  requirements: z.array(requirementItemSchema).max(MAX_GENERATED_REQUIREMENTS),
});

export type GeneratedRequirement = z.infer<typeof requirementItemSchema>;
export type RequirementsOutput = z.infer<typeof requirementsOutputSchema>;

/** Maps the model's priority vocabulary onto the `requirements.priority` check constraint. */
export const PRIORITY_TO_DB = { high: "P0", medium: "P1", low: "P2" } as const satisfies Record<
  GeneratedRequirement["priority"],
  "P0" | "P1" | "P2"
>;
