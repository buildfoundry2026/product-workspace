import Link from "next/link";
import { ChevronRightIcon, CircleAlertIcon, PlusIcon } from "lucide-react";
import { requireOwner } from "@/utils/supabase/require-owner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProjectActions } from "./project-actions";

export default async function HomePage() {
  const { supabase } = await requireOwner();
  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, name, description, status, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Discovery workspaces built from your business briefs.
          </p>
        </div>
        <Button asChild>
          <Link href="/projects/new">
            <PlusIcon data-icon="inline-start" />
            New project
          </Link>
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Could not load projects</AlertTitle>
          <AlertDescription>Refresh to try again.</AlertDescription>
        </Alert>
      ) : projects.length === 0 ? (
        <Card className="items-center border border-dashed py-16 text-center ring-0">
          <CardContent className="flex flex-col items-center gap-3">
            <p className="text-sm text-muted-foreground">
              No projects yet. Create one by pasting a business brief.
            </p>
            <Button asChild variant="outline">
              <Link href="/projects/new">
                <PlusIcon data-icon="inline-start" />
                Create your first project
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          <ul className="divide-y">
            {projects.map((project) => (
              <li
                key={project.id}
                className="flex items-center gap-1 pr-2 transition-colors hover:bg-muted/60"
              >
                <Link
                  href={`/projects/${project.id}`}
                  className="group flex min-w-0 flex-1 items-center justify-between gap-4 py-3 pl-4 outline-none focus-visible:bg-muted/60"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{project.name}</span>
                      {project.status === "archived" && <Badge variant="outline">Archived</Badge>}
                    </span>
                    {project.description && (
                      <span className="truncate text-xs text-muted-foreground">
                        {project.description}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {formatDate(project.created_at)}
                    <ChevronRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
                <ProjectActions
                  project={{ id: project.id, name: project.name, description: project.description }}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
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
