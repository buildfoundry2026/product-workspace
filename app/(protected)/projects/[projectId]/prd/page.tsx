import Link from "next/link";
import { notFound } from "next/navigation";
import type { Block } from "@blocknote/core";
import { z } from "zod";
import { requireOwner } from "@/utils/supabase/require-owner";
import { loadPrdEvidence, type PrdEvidence } from "@/lib/prd/evidence";
import { PrdWorkspace } from "./prd-workspace";

export default async function PrdPage({ params }: PageProps<"/projects/[projectId]/prd">) {
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) {
    notFound();
  }

  const { supabase } = await requireOwner();

  const [loaded, latestRes] = await Promise.all([
    loadPrdEvidence(supabase, projectId),
    supabase
      .from("artifacts")
      .select("id, version, content")
      .eq("project_id", projectId)
      .eq("artifact_type", "prd")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!loaded.ok) {
    if (loaded.code === "NOT_FOUND") notFound();
    throw new Error(loaded.message);
  }
  if (latestRes.error) {
    throw new Error("Could not load the saved PRD.");
  }

  const { evidence } = loaded;
  const archived = evidence.project.status === "archived";
  const latest = latestRes.data;
  const initialArtifact =
    latest && Array.isArray(latest.content)
      ? { id: latest.id as string, version: latest.version as number, blocks: latest.content as Block[] }
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href={`/projects/${projectId}`}
          className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← {evidence.project.name}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Product Requirements Document
        </h1>
        <p className="text-sm text-zinc-500">
          Generated from this project&apos;s sources, answered questions, and assumptions. Edit freely;
          each save creates a new version.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <PrdWorkspace
          projectId={projectId}
          initialArtifact={initialArtifact}
          readOnly={archived}
          generateBlockedReason={
            evidence.sources.length === 0 ? "Add a source to this project before generating a PRD." : null
          }
        />
        <EvidencePanel evidence={evidence} />
      </div>
    </div>
  );
}

function EvidencePanel({ evidence }: { evidence: PrdEvidence }) {
  return (
    <aside className="flex flex-col gap-3 self-start lg:sticky lg:top-6" aria-label="Evidence used">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Evidence</h2>

      <EvidenceGroup title="Sources" count={evidence.sources.length} empty="No sources.">
        {evidence.sources.map((s) => (
          <li key={s.id}>
            <Label>{s.label}</Label> {s.title}
            {s.truncated && <span className="text-amber-700 dark:text-amber-400"> (truncated)</span>}
          </li>
        ))}
      </EvidenceGroup>

      <EvidenceGroup
        title="Answered questions"
        count={evidence.resolvedGaps.length}
        empty="No answered questions yet."
      >
        {evidence.resolvedGaps.map((g) => (
          <li key={g.id} className="flex flex-col gap-0.5">
            <span>
              <Label>{g.label}</Label> {g.question}
            </span>
            <span className="line-clamp-3 text-zinc-500">
              {g.answer?.content ?? "Answer unavailable."}
            </span>
          </li>
        ))}
      </EvidenceGroup>

      <EvidenceGroup title="Assumptions" count={evidence.assumptions.length} empty="No assumptions.">
        {evidence.assumptions.map((a) => (
          <li key={a.id}>
            <Label>{a.label}</Label> {a.statement}{" "}
            <span className="text-zinc-500">({a.status.replace("_", " ")})</span>
          </li>
        ))}
      </EvidenceGroup>

      <EvidenceGroup title="Open questions" count={evidence.openGaps.length} empty="None open.">
        {evidence.openGaps.map((g) => (
          <li key={g.id}>
            <Label>{g.label}</Label> {g.question}
          </li>
        ))}
      </EvidenceGroup>
    </aside>
  );
}

function EvidenceGroup({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {title}
        <span className="text-xs tabular-nums text-zinc-500">{count}</span>
      </summary>
      {count === 0 ? (
        <p className="px-4 pb-3 text-xs text-zinc-500">{empty}</p>
      ) : (
        <ul className="flex max-h-80 flex-col gap-2 overflow-auto px-4 pb-3 text-xs text-zinc-700 dark:text-zinc-300">
          {children}
        </ul>
      )}
    </details>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-zinc-100 px-1 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      {children}
    </span>
  );
}
