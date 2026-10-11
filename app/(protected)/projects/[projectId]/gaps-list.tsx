"use client";

import { useId, useState, useTransition } from "react";
import { resolveGap } from "@/app/actions/gaps";
import type { GapSeverity, UnresolvedGap } from "@/lib/gaps/queries";

const MAX_ANSWER_CHARS = 20_000;

const SEVERITY_STYLES: Record<GapSeverity, string> = {
  critical: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  low: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
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
      <p aria-live="polite" className="text-sm text-emerald-700 empty:hidden dark:text-emerald-400">
        {notice}
      </p>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
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
    <article className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${SEVERITY_STYLES[gap.severity]}`}
        >
          {gap.severity}
        </span>
        <span className="text-xs text-zinc-500">{GAP_TYPE_LABELS[gap.gap_type]}</span>
        {gap.category && (
          <span className="text-xs capitalize text-zinc-500">· {gap.category}</span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{gap.question}</h3>
        {gap.description && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{gap.description}</p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2" aria-busy={pending}>
        <label htmlFor={fieldId} className="sr-only">
          Answer to: {gap.question}
        </label>
        <textarea
          id={fieldId}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          disabled={archived || pending}
          rows={3}
          maxLength={MAX_ANSWER_CHARS}
          placeholder={archived ? "This project is archived." : "Write your answer…"}
          aria-invalid={!!error}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:ring-zinc-100/10"
        />
        <div className="flex items-center justify-between gap-3">
          <p
            id={`${fieldId}-error`}
            role={error ? "alert" : undefined}
            className="text-xs text-red-600 dark:text-red-400"
          >
            {error}
          </p>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {pending && (
              <span
                aria-hidden
                className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white dark:border-zinc-900/30 dark:border-t-zinc-900"
              />
            )}
            {pending ? "Resolving…" : "Resolve"}
          </button>
        </div>
      </form>
    </article>
  );
}
