import { CircleAlertIcon } from "lucide-react";
import { getUnresolvedGaps } from "@/lib/gaps/queries";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GapsList } from "./gaps-list";

/**
 * FR-004 Guided clarification: open questions for the project, most severe
 * first, each with an inline answer form.
 */
export async function GapsBoard({ projectId, archived }: { projectId: string; archived: boolean }) {
  const result = await getUnresolvedGaps(projectId);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="gaps-heading">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="gaps-heading" className="text-lg font-semibold tracking-tight">
            Open questions
          </h2>
          <p className="text-sm text-muted-foreground">
            Answer these to close gaps in the evidence. Each answer becomes a new source.
          </p>
        </div>
        {result.ok && result.gaps.length > 0 && (
          <Badge variant="secondary" className="tabular-nums">
            {result.gaps.length} unresolved
          </Badge>
        )}
      </div>

      {result.ok ? (
        <GapsList gaps={result.gaps} archived={archived} />
      ) : (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Could not load open questions</AlertTitle>
          <AlertDescription>{result.message} Refresh to try again.</AlertDescription>
        </Alert>
      )}
    </section>
  );
}

export function GapsBoardSkeleton() {
  return (
    <section className="flex flex-col gap-4" aria-busy>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-44 rounded-xl" />
      ))}
    </section>
  );
}
