/** An analysis claim ('running') older than this is treated as abandoned, e.g. after a server crash. */
export const STALE_ANALYSIS_CLAIM_MS = 10 * 60_000;

export function staleClaimCutoff(): string {
  return new Date(Date.now() - STALE_ANALYSIS_CLAIM_MS).toISOString();
}

export function isAnalysisClaimStale(startedAt: unknown): boolean {
  const started = Date.parse(String(startedAt ?? ""));
  return !Number.isFinite(started) || started < Date.now() - STALE_ANALYSIS_CLAIM_MS;
}
