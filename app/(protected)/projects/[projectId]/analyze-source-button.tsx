"use client";

import { useState, useTransition } from "react";
import { LoaderCircleIcon, SparklesIcon } from "lucide-react";
import { analyzeSource, type AnalyzeSourceResult } from "@/app/actions/analysis";
import { Button } from "@/components/ui/button";

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
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleClick}
        disabled={disabled || pending}
        aria-busy={pending}
      >
        {pending ? (
          <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
        ) : (
          <SparklesIcon data-icon="inline-start" />
        )}
        {pending ? "Analyzing…" : label}
      </Button>

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
      <p role="alert" className="max-w-xs text-destructive">
        {result.message}
      </p>
    );
  }

  const summary = `${result.assumptionCount} assumptions, ${result.gapCount} gaps, ${result.contradictionCount} contradictions`;
  return (
    <p className="max-w-xs text-muted-foreground">
      {result.alreadyAnalyzed ? `Already analyzed: ${summary}.` : `Found ${summary}.`}
      {result.rejectedCount > 0 && (
        <span className="block font-medium text-foreground">
          {result.rejectedCount} finding{result.rejectedCount === 1 ? "" : "s"} rejected for invalid
          source references.
        </span>
      )}
    </p>
  );
}
