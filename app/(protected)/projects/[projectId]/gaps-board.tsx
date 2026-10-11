import { getUnresolvedGaps } from "@/lib/gaps/queries";
import { GapsList } from "./gaps-list";

/**
 * FR-004 Guided clarification: open questions for the project, most severe
 * first, each with an inline answer form.
 */
export async function GapsBoard({ projectId, archived }: { projectId: string; archived: boolean }) {
  const result = await getUnresolvedGaps(projectId);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="gaps-heading">
      <div className="flex items-baseline justify-between gap-4">
        <h2
          id="gaps-heading"
          className="text-sm font-semibold uppercase tracking-wide text-zinc-500"
        >
          Open questions
        </h2>
        {result.ok && result.gaps.length > 0 && (
          <span className="text-xs tabular-nums text-zinc-500">{result.gaps.length} unresolved</span>
        )}
      </div>

      {result.ok ? (
        <GapsList gaps={result.gaps} archived={archived} />
      ) : (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {result.message} Refresh to try again.
        </p>
      )}
    </section>
  );
}

export function GapsBoardSkeleton() {
  return (
    <section className="flex flex-col gap-3" aria-busy>
      <div className="h-4 w-36 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-40 animate-pulse rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
        />
      ))}
    </section>
  );
}
