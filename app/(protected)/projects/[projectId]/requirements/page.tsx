import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, CircleAlertIcon } from "lucide-react";
import { z } from "zod";
import { requireOwner } from "@/utils/supabase/require-owner";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GenerateRequirementsButton } from "./generate-requirements-button";

/** Requirement generation runs inside a Server Action invoked from this page. */
export const maxDuration = 300;

type RequirementRow = {
  id: string;
  ref_code: string;
  title: string;
  description: string;
  requirement_type: string;
  priority: "P0" | "P1" | "P2";
  status: string;
  review_status: string;
  evidence_status: string;
  created_by: string;
};

type SourceLinkRow = { from_id: string; to_id: string };
type SourceRow = { id: string; title: string; processing_status: string };

const PRIORITY_VARIANTS: Record<RequirementRow["priority"], React.ComponentProps<typeof Badge>["variant"]> = {
  P0: "default",
  P1: "secondary",
  P2: "outline",
};

const PRIORITY_LABELS: Record<RequirementRow["priority"], string> = {
  P0: "High",
  P1: "Medium",
  P2: "Low",
};

/**
 * FR-005 Requirement generation: lists the project's requirements with the
 * source each one is derived from, and generates new ones from approved
 * evidence (completed sources and resolved gaps).
 */
export default async function RequirementsPage({
  params,
}: PageProps<"/projects/[projectId]/requirements">) {
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) {
    notFound();
  }

  const { supabase } = await requireOwner();

  const [projectRes, requirementsRes, linksRes, sourcesRes, resolvedGapsRes] = await Promise.all([
    supabase.from("projects").select("id, name, status").eq("id", projectId).maybeSingle(),
    supabase
      .from("requirements")
      .select(
        "id, ref_code, title, description, requirement_type, priority, status, review_status, evidence_status, created_by",
      )
      .eq("project_id", projectId)
      .returns<RequirementRow[]>(),
    supabase
      .from("links")
      .select("from_id, to_id")
      .eq("project_id", projectId)
      .eq("from_type", "requirement")
      .eq("relation", "derived_from")
      .eq("to_type", "source")
      .returns<SourceLinkRow[]>(),
    supabase
      .from("sources")
      .select("id, title, processing_status")
      .eq("project_id", projectId)
      .returns<SourceRow[]>(),
    supabase
      .from("gaps")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "resolved"),
  ]);

  if (projectRes.error) {
    throw new Error("Could not load the project.");
  }
  if (!projectRes.data) {
    notFound();
  }
  const project = projectRes.data;
  const archived = project.status === "archived";

  const loadFailed = !!(requirementsRes.error || linksRes.error || sourcesRes.error);
  const requirements = [...(requirementsRes.data ?? [])].sort(compareRefCodes);
  const sources = sourcesRes.data ?? [];
  const sourceTitles = new Map(sources.map((s) => [s.id, s.title]));
  const sourcesByRequirement = new Map<string, string[]>();
  for (const link of linksRes.data ?? []) {
    const list = sourcesByRequirement.get(link.from_id) ?? [];
    list.push(link.to_id);
    sourcesByRequirement.set(link.from_id, list);
  }

  const completedSourceCount = sources.filter((s) => s.processing_status === "completed").length;
  const resolvedGapCount = resolvedGapsRes.count ?? 0;

  const disabledReason = archived
    ? "Archived projects cannot generate requirements."
    : loadFailed
      ? "Evidence could not be loaded. Refresh to try again."
      : completedSourceCount === 0
        ? "Add a source and wait for it to finish processing first."
        : undefined;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit text-muted-foreground">
          <Link href={`/projects/${project.id}`}>
            <ArrowLeftIcon data-icon="inline-start" />
            {project.name}
          </Link>
        </Button>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Requirements</h1>
              {archived && <Badge variant="outline">Archived</Badge>}
            </div>
            <p className="max-w-xl text-sm text-muted-foreground">
              Atomic requirements generated from {completedSourceCount} approved source
              {completedSourceCount === 1 ? "" : "s"} and {resolvedGapCount} resolved question
              {resolvedGapCount === 1 ? "" : "s"}. Every requirement links to the source it was
              derived from.
            </p>
          </div>
          <GenerateRequirementsButton projectId={project.id} disabledReason={disabledReason} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All requirements</CardTitle>
          <CardDescription>Generated requirements start as drafts pending review.</CardDescription>
          {!loadFailed && requirements.length > 0 && (
            <CardAction>
              <Badge variant="secondary" className="tabular-nums">
                {requirements.length}
              </Badge>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {loadFailed ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>Could not load requirements</AlertTitle>
              <AlertDescription>Refresh to try again.</AlertDescription>
            </Alert>
          ) : requirements.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              No requirements yet. Click Generate Requirements to draft them from your evidence.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-24 pl-4">Ref</TableHead>
                    <TableHead>Requirement</TableHead>
                    <TableHead className="w-32">Type</TableHead>
                    <TableHead className="w-24">Priority</TableHead>
                    <TableHead className="w-48">Source</TableHead>
                    <TableHead className="w-28 pr-4">Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requirements.map((req) => {
                    const linked = sourcesByRequirement.get(req.id) ?? [];
                    return (
                      <TableRow key={req.id} className="align-top">
                        <TableCell className="pl-4 align-top font-mono text-xs text-muted-foreground">
                          {req.ref_code}
                        </TableCell>
                        <TableCell className="max-w-xl align-top whitespace-normal">
                          <p className="font-medium">{req.title}</p>
                          <p className="mt-0.5 text-muted-foreground">{req.description}</p>
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge variant="outline">{formatEnum(req.requirement_type)}</Badge>
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge variant={PRIORITY_VARIANTS[req.priority]}>
                            {PRIORITY_LABELS[req.priority]}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-48 align-top whitespace-normal">
                          {linked.length === 0 ? (
                            <span className="text-xs font-medium text-destructive">No source</span>
                          ) : (
                            <ul className="flex flex-col gap-1">
                              {linked.map((sourceId) => (
                                <li key={sourceId} className="line-clamp-2 text-xs">
                                  {sourceTitles.get(sourceId) ?? (
                                    <span className="text-destructive">Missing source</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </TableCell>
                        <TableCell className="pr-4 align-top">
                          <Badge variant={req.review_status === "approved" ? "secondary" : "outline"}>
                            {formatEnum(req.review_status)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Orders REQ-2 before REQ-10 (ref codes are PREFIX-NUMBER). */
function compareRefCodes(a: RequirementRow, b: RequirementRow): number {
  const [prefixA, numA] = a.ref_code.split("-");
  const [prefixB, numB] = b.ref_code.split("-");
  return prefixA.localeCompare(prefixB) || Number(numA) - Number(numB);
}

function formatEnum(value: string): string {
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
