import "server-only";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const DEFAULT_MODEL = "deepseek/deepseek-chat";

/** OpenRouter model id used for discovery analysis; override with OPENROUTER_ANALYSIS_MODEL. */
export const ANALYSIS_MODEL_ID = process.env.OPENROUTER_ANALYSIS_MODEL || DEFAULT_MODEL;

/** OpenRouter model id used for PRD generation; override with OPENROUTER_PRD_MODEL. */
export const PRD_MODEL_ID = process.env.OPENROUTER_PRD_MODEL || DEFAULT_MODEL;

export class MissingApiKeyError extends Error {
  constructor() {
    super("OPENROUTER_API_KEY is not configured on the server.");
    this.name = "MissingApiKeyError";
  }
}

function getProvider() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new MissingApiKeyError();
  }
  return createOpenRouter({
    apiKey,
    compatibility: "strict",
    appName: "Product Discovery Workspace",
  });
}

/**
 * Returns the language model for structured discovery analysis.
 *
 * `require_parameters` makes OpenRouter route only to upstream providers that
 * honour `response_format` (JSON schema), so the model cannot silently fall
 * back to free text on a provider that ignores the schema.
 */
export function getAnalysisModel() {
  return getProvider()(ANALYSIS_MODEL_ID, {
    temperature: 0.2,
    provider: { require_parameters: true },
  });
}

/** Returns the language model for long-form PRD drafting (plain Markdown, streamed). */
export function getPrdModel() {
  return getProvider()(PRD_MODEL_ID, { temperature: 0.3 });
}
