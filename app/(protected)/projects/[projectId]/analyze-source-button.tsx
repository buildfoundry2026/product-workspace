"use client";

import { useState, useTransition } from "react";
import { analyzeSource, type AnalyzeSourceResult } from "@/app/actions/analysis";

type Props = {
  sourceId: string;
  /** False while the source is pending, ingesting, or already being analyzed. */
  disabled?: boolean;
  label?: string;
  /** Failure already shown by the page from source metadata; not repeated here. */
  persistedError?: string;
};

export function AnalyzeSourceButton({
  sourceId,
  disabled = false,
  label = "Analyze",
  persistedError,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AnalyzeSourceResult | null>(null);

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await analyzeSource(sourceId));
      } catch {
        setResult({
          ok: false,
          code: "PROCESSING_FAILED",
          message: "Could not reach the server. Check your connection and try again.",
        });
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || pending}
        aria-busy={pending}
        className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-900 transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        {pending && (
          <span
            aria-hidden
            className="size-3.5 animate-spin rounded-full border-2 border-zinc-900/20 border-t-zinc-900 dark:border-zinc-100/20 dark:border-t-zinc-100"
          />
        )}
        {pending ? "Analyzing…" : label}
      </button>

      <div aria-live="polite" className="text-right text-xs">
        {result && !pending && !(!result.ok && result.message === persistedError) && (
          <ResultMessage result={result} />
        )}
      </div>
    </div>
  );
}

function ResultMessage({ result }: { result: AnalyzeSourceResult }) {
  if (!result.ok) {
    return (
      <p role="alert" className="max-w-xs text-red-600 dark:text-red-400">
        {result.message}
      </p>
    );
  }

  const summary = `${result.assumptionCount} assumptions, ${result.gapCount} gaps, ${result.contradictionCount} contradictions`;
  return (
    <p className="max-w-xs text-emerald-700 dark:text-emerald-400">
      {result.alreadyAnalyzed ? `Already analyzed: ${summary}.` : `Found ${summary}.`}
      {result.rejectedCount > 0 && (
        <span className="block text-amber-700 dark:text-amber-400">
          {result.rejectedCount} finding{result.rejectedCount === 1 ? "" : "s"} rejected for invalid
          source references.
        </span>
      )}
    </p>
  );
}
