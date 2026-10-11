import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  FileTextIcon,
  ListChecksIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireOwner } from "@/utils/supabase/require-owner";
import { isAnalysisClaimStale } from "@/lib/analysis/claims";
import { AnalyzeSourceButton } from "./analyze-source-button";
import { GapsBoard, GapsBoardSkeleton } from "./gaps-board";

/** Discovery analysis runs inside a Server Action invoked from this page. */
export const maxDuration = 300;

type SourceAnalysis = {
  status?: "running" | "completed" | "failed";
  started_at?: string;
  error?: string;
  assumption_count?: number;
  gap_count?: number;
  contradiction_count?: number;
  rejected_count?: number;
};

type SourceRow = {
  id: string;
  kind: string;
  title: string;
  processing_status: "pending" | "processing" | "completed" | "failed";
  processing_error: string | null;
  metadata: { chunk_count?: number; embedding_status?: string; analysis?: SourceAnalysis } | null;
  created_at: string;
};

export default async function ProjectPage({
  params,
  searchParams,
}: PageProps<"/projects/[projectId]">) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(projectId).success) {
    notFound();
  }

  const { supabase } = await requireOwner();

  const [projectResult, sourcesResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, status, created_at")
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("sources")
      .select("id, kind, title, processing_status, processing_error, metadata, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .returns<SourceRow[]>(),
  ]);

  if (projectResult.error) {
    throw new Error("Could not load the project.");
  }
  if (!projectResult.data) {
    notFound();
  }

  const project = projectResult.data;
  const justCreated = query.created === "1";

  const archived = project.status === "archived";
  const sources = sourcesResult.data ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit text-muted-foreground">
          <Link href="/">
            <ArrowLeftIcon data-icon="inline-start" />
            All projects
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
              {archived && <Badge variant="outline">Archived</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              Created {formatDate(project.created_at)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/projects/${project.id}/requirements`}>
                <ListChecksIcon data-icon="inline-start" />
                Requirements
              </Link>
            </Button>
            <Button asChild>
              <Link href={`/projects/${project.id}/prd`}>
                <FileTextIcon data-icon="inline-start" />
                Product requirements (PRD)
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {justCreated && (
        <Alert role="status">
          <CircleCheckIcon />
          <AlertTitle>Project created</AlertTitle>
          <AlertDescription>Your brief was ingested successfully.</AlertDescription>
        </Alert>
      )}

      <Suspense fallback={<GapsBoardSkeleton />}>
        <GapsBoard projectId={project.id} archived={archived} />
      </Suspense>

      <Card>
        <CardHeader>
          <CardTitle>Sources</CardTitle>
          <CardDescription>
            Evidence for this project. Analyze a source to surface assumptions and open questions.
          </CardDescription>
          {!sourcesResult.error && sources.length > 0 && (
            <CardAction>
              <Badge variant="secondary" className="tabular-nums">
                {sources.length}
              </Badge>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {sourcesResult.error ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>Could not load sources</AlertTitle>
              <AlertDescription>Refresh to try again.</AlertDescription>
            </Alert>
          ) : sources.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              No sources yet.
            </p>
          ) : (
            <ul className="divide-y overflow-hidden rounded-lg border">
              {sources.map((source) => (
                <li key={source.id} className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="truncate font-medium">{source.title}</span>
                    <StatusBadge status={source.processing_status} />
                  </div>
                  <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    <span className="capitalize">{source.kind.replace("_", " ")}</span>
                    <span>{formatDate(source.created_at)}</span>
                    {typeof source.metadata?.chunk_count === "number" && (
                      <span>{source.metadata.chunk_count} chunks</span>
                    )}
                    {source.metadata?.embedding_status === "pending" && (
                      <span>Embeddings pending</span>
                    )}
                  </div>
                  {source.processing_status === "failed" && source.processing_error && (
                    <p className="text-xs text-destructive">{source.processing_error}</p>
                  )}
                  <SourceAnalysisRow source={source} archived={archived} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const STATUS_VARIANTS: Record<
  SourceRow["processing_status"],
  React.ComponentProps<typeof Badge>["variant"]
> = {
  pending: "outline",
  processing: "outline",
  completed: "secondary",
  failed: "destructive",
};

function StatusBadge({ status }: { status: SourceRow["processing_status"] }) {
  return (
    <Badge variant={STATUS_VARIANTS[status]} className="capitalize">
      {status === "processing" && <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />}
      {status}
    </Badge>
  );
}

function SourceAnalysisRow({ source, archived }: { source: SourceRow; archived: boolean }) {
  const analysis = source.metadata?.analysis;
  const running = analysis?.status === "running" && !isAnalysisClaimStale(analysis.started_at);
  const abandoned = analysis?.status === "running" && !running;

  if (analysis?.status === "completed") {
    return (
      <p className="text-xs text-muted-foreground">
        Analyzed: {analysis.assumption_count ?? 0} assumptions, {analysis.gap_count ?? 0} gaps,{" "}
        {analysis.contradiction_count ?? 0} contradictions
        {!!analysis.rejected_count && (
          <span className="font-medium text-foreground">
            {" "}
            ({analysis.rejected_count} rejected for invalid source references)
          </span>
        )}
      </p>
    );
  }

  const canAnalyze = (source.processing_status === "completed" || abandoned) && !archived;
  if (!canAnalyze && !running) {
    return null;
  }

  return (
    <div className="mt-1 flex items-start justify-between gap-4">
      <p className="text-xs text-muted-foreground">
        {running ? (
          "Analysis in progress…"
        ) : abandoned ? (
          <span className="text-destructive">The previous analysis did not finish.</span>
        ) : analysis?.status === "failed" ? (
          <span className="text-destructive">
            Last analysis failed{analysis.error ? `: ${analysis.error}` : "."}
          </span>
        ) : (
          "Not analyzed yet."
        )}
      </p>
      <AnalyzeSourceButton
        sourceId={source.id}
        disabled={running}
        label={analysis?.status === "failed" || abandoned ? "Retry analysis" : "Analyze"}
        persistedError={analysis?.status === "failed" ? analysis.error : undefined}
      />
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
