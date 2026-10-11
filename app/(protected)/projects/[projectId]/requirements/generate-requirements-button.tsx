"use client";

import { useState, useTransition } from "react";
import { CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon, SparklesIcon } from "lucide-react";
import {
  generateRequirements,
  type GenerateRequirementsResult,
} from "@/app/actions/requirements";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Props = {
  projectId: string;
  /** Why generation is unavailable (archived project, no evidence); hides nothing, just disables. */
  disabledReason?: string;
};

export function GenerateRequirementsButton({ projectId, disabledReason }: Props) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<GenerateRequirementsResult | null>(null);

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await generateRequirements(projectId));
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
    <div className="flex shrink-0 flex-col items-start gap-2 md:w-80 md:items-end">
      <Button
        type="button"
        onClick={handleClick}
        disabled={pending || !!disabledReason}
        aria-busy={pending}
        title={disabledReason}
      >
        {pending ? (
          <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
        ) : (
          <SparklesIcon data-icon="inline-start" />
        )}
        {pending ? "Generating…" : "Generate Requirements"}
      </Button>
      {disabledReason && !pending && (
        <p className="text-xs text-muted-foreground md:text-right">{disabledReason}</p>
      )}
      {pending && (
        <p className="text-xs text-muted-foreground md:text-right">
          This can take up to a couple of minutes.
        </p>
      )}
      <div aria-live="polite" className="w-full">
        {result && !pending && <ResultAlert result={result} />}
      </div>
    </div>
  );
}

function ResultAlert({ result }: { result: GenerateRequirementsResult }) {
  if (!result.ok) {
    return (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>Generation failed</AlertTitle>
        <AlertDescription>{result.message}</AlertDescription>
      </Alert>
    );
  }

  const notes = [
    result.rejectedCount > 0 &&
      `${result.rejectedCount} rejected for citing an unknown source`,
    result.duplicateCount > 0 && `${result.duplicateCount} skipped as duplicates`,
  ].filter(Boolean);

  return (
    <Alert role="status">
      <CircleCheckIcon />
      <AlertTitle>
        {result.insertedCount === 0
          ? "No new requirements"
          : `Added ${result.insertedCount} requirement${result.insertedCount === 1 ? "" : "s"}`}
      </AlertTitle>
      <AlertDescription>
        {result.insertedCount === 0 && notes.length === 0
          ? "The evidence does not support any requirements beyond the existing ones."
          : notes.length > 0
            ? `${notes.join("; ")}.`
            : "Each one is linked to the source it was derived from."}
      </AlertDescription>
    </Alert>
  );
}
