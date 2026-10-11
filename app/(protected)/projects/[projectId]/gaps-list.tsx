"use client";

import { useId, useState, useTransition } from "react";
import { CheckIcon, CircleCheckIcon, LoaderCircleIcon } from "lucide-react";
import { resolveGap } from "@/app/actions/gaps";
import type { GapSeverity, UnresolvedGap } from "@/lib/gaps/queries";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const MAX_ANSWER_CHARS = 20_000;

/** Monochrome severity scale; only critical uses the destructive accent. */
const SEVERITY_VARIANTS: Record<GapSeverity, React.ComponentProps<typeof Badge>["variant"]> = {
  critical: "destructive",
  high: "default",
  medium: "secondary",
  low: "outline",
};

const GAP_TYPE_LABELS: Record<UnresolvedGap["gap_type"], string> = {
  information_gap: "Information gap",
  contradiction: "Contradiction",
  clarification_question: "Clarification",
};

export function GapsList({ gaps, archived }: { gaps: UnresolvedGap[]; archived: boolean }) {
  // Hides a gap as soon as it resolves, before the server refresh arrives.
  const [resolvedIds, setResolvedIds] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const visible = gaps.filter((gap) => !resolvedIds.has(gap.id));

  function handleResolved(gapId: string, processingFailed: boolean) {
    setResolvedIds((prev) => new Set(prev).add(gapId));
    setNotice(
      processingFailed
        ? "Question resolved. Your answer was saved, but it could not be processed for search; see Sources."
        : "Question resolved. Your answer was saved as a new source.",
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div aria-live="polite">
        {notice && (
          <Alert role="status">
            <CircleCheckIcon />
            <AlertDescription className="text-foreground">{notice}</AlertDescription>
          </Alert>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No open questions. Run analysis on a source to surface gaps.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((gap) => (
            <li key={gap.id}>
              <GapCard gap={gap} archived={archived} onResolved={handleResolved} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GapCard({
  gap,
  archived,
  onResolved,
}: {
  gap: UnresolvedGap;
  archived: boolean;
  onResolved: (gapId: string, processingFailed: boolean) => void;
}) {
  const fieldId = useId();
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canSubmit = !archived && !pending && answer.trim().length > 0;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);

    startTransition(async () => {
      try {
        const result = await resolveGap(gap.id, answer);
        if (result.ok) {
          onResolved(gap.id, result.processingStatus === "failed");
        } else if (result.code === "ALREADY_RESOLVED" || result.code === "GAP_NOT_FOUND") {
          onResolved(gap.id, false);
        } else {
          setError(result.message);
        }
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={SEVERITY_VARIANTS[gap.severity]} className="capitalize">
            {gap.severity}
          </Badge>
          <span>{GAP_TYPE_LABELS[gap.gap_type]}</span>
          {gap.category && <span className="capitalize">· {gap.category}</span>}
        </div>
        <CardTitle className="mt-1">
          <h3>{gap.question}</h3>
        </CardTitle>
        {gap.description && <CardDescription>{gap.description}</CardDescription>}
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2" aria-busy={pending}>
          <Label htmlFor={fieldId} className="sr-only">
            Answer to: {gap.question}
          </Label>
          <Textarea
            id={fieldId}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            disabled={archived || pending}
            rows={3}
            maxLength={MAX_ANSWER_CHARS}
            placeholder={archived ? "This project is archived." : "Write your answer…"}
            aria-invalid={!!error}
            aria-describedby={error ? `${fieldId}-error` : undefined}
            className="min-h-20 resize-y"
          />
          <div className="flex items-center justify-between gap-3">
            <p
              id={`${fieldId}-error`}
              role={error ? "alert" : undefined}
              className="text-xs text-destructive"
            >
              {error}
            </p>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {pending ? (
                <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
              ) : (
                <CheckIcon data-icon="inline-start" />
              )}
              {pending ? "Resolving…" : "Resolve"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
