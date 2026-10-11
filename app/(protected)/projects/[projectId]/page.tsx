import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
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

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link
          href="/"
          className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← All projects
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {project.name}
          </h1>
          {project.status === "archived" && (
            <span className="rounded-full bg-zinc-200 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              Archived
            </span>
          )}
          <Link
            href={`/projects/${project.id}/prd`}
            className="ml-auto inline-flex h-9 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Product requirements (PRD) →
          </Link>
        </div>
        <p className="text-sm text-zinc-500">Created {formatDate(project.created_at)}</p>
      </div>

      {justCreated && (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          Project created and brief ingested successfully.
        </div>
      )}

      <Suspense fallback={<GapsBoardSkeleton />}>
        <GapsBoard projectId={project.id} archived={project.status === "archived"} />
      </Suspense>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Sources</h2>

        {sourcesResult.error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            Could not load sources. Refresh to try again.
          </p>
        ) : sourcesResult.data.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No sources yet.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
            {sourcesResult.data.map((source) => (
              <li key={source.id} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {source.title}
                  </span>
                  <StatusBadge status={source.processing_status} />
                </div>
                <div className="flex flex-wrap gap-x-3 text-xs text-zinc-500">
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
                  <p className="text-xs text-red-600 dark:text-red-400">{source.processing_error}</p>
                )}
                <SourceAnalysisRow source={source} archived={project.status === "archived"} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const STATUS_STYLES: Record<SourceRow["processing_status"], string> = {
  pending: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  processing: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
};

function StatusBadge({ status }: { status: SourceRow["processing_status"] }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

function SourceAnalysisRow({ source, archived }: { source: SourceRow; archived: boolean }) {
  const analysis = source.metadata?.analysis;
  const running = analysis?.status === "running" && !isAnalysisClaimStale(analysis.started_at);
  const abandoned = analysis?.status === "running" && !running;

  if (analysis?.status === "completed") {
    return (
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Analyzed: {analysis.assumption_count ?? 0} assumptions, {analysis.gap_count ?? 0} gaps,{" "}
        {analysis.contradiction_count ?? 0} contradictions
        {!!analysis.rejected_count && (
          <span className="text-amber-700 dark:text-amber-400">
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
      <p className="text-xs text-zinc-500">
        {running ? (
          "Analysis in progress…"
        ) : abandoned ? (
          <span className="text-red-600 dark:text-red-400">
            The previous analysis did not finish.
          </span>
        ) : analysis?.status === "failed" ? (
          <span className="text-red-600 dark:text-red-400">
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
