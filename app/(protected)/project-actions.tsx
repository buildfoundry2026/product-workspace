"use client";

import { useId, useState, useTransition } from "react";
import {
  CircleAlertIcon,
  EllipsisVerticalIcon,
  LoaderCircleIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { deleteProject, updateProject } from "@/app/actions/projects";
import { MAX_PROJECT_DESCRIPTION_CHARS, MAX_PROJECT_NAME_CHARS } from "@/lib/projects/limits";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Project = { id: string; name: string; description: string | null };

/** Three-dots menu on a project row with Edit and Delete. */
export function ProjectActions({ project }: { project: Project }) {
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);

  return (
    <>
      {/* Non-modal so focus/pointer locks are released before a dialog opens from it. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Options for ${project.name}`}>
            <EllipsisVerticalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onSelect={() => setDialog("edit")}>
            <PencilIcon />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === "edit" && <EditProjectDialog project={project} onClose={() => setDialog(null)} />}
      {dialog === "delete" && (
        <DeleteProjectDialog project={project} onClose={() => setDialog(null)} />
      )}
    </>
  );
}

function EditProjectDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const nameId = useId();
  const descriptionId = useId();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string[]; description?: string[] }>({});
  const [pending, startTransition] = useTransition();

  const unchanged = name.trim() === project.name && description.trim() === (project.description ?? "");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      try {
        const result = await updateProject({ projectId: project.id, name, description });
        if (result.ok) {
          onClose();
        } else {
          setError(result.message);
          setFieldErrors(result.fieldErrors ?? {});
        }
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" aria-busy={pending}>
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
            <DialogDescription>Update the project&apos;s name and description.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_PROJECT_NAME_CHARS}
              disabled={pending}
              required
              aria-invalid={!!fieldErrors.name}
              aria-describedby={fieldErrors.name ? `${nameId}-error` : undefined}
            />
            {fieldErrors.name && (
              <p id={`${nameId}-error`} className="text-xs text-destructive">
                {fieldErrors.name[0]}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={descriptionId}>
              Description <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id={descriptionId}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={MAX_PROJECT_DESCRIPTION_CHARS}
              rows={4}
              disabled={pending}
              placeholder="What is this project about?"
              aria-invalid={!!fieldErrors.description}
              aria-describedby={fieldErrors.description ? `${descriptionId}-error` : undefined}
              className="min-h-24 resize-y"
            />
            {fieldErrors.description && (
              <p id={`${descriptionId}-error`} className="text-xs text-destructive">
                {fieldErrors.description[0]}
              </p>
            )}
          </div>

          {error && !fieldErrors.name && !fieldErrors.description && (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || unchanged || !name.trim()}>
              {pending && <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />}
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteProjectDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const confirmId = useId();
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirmed = confirmation.trim() === project.name.trim();

  function handleDelete() {
    if (!confirmed) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteProject(project.id);
        if (result.ok || result.code === "NOT_FOUND") {
          onClose();
        } else {
          setError(result.message);
        }
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
      }
    });
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{project.name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure? This will permanently delete all briefs, requirements, and PRDs
            associated with this project, along with its open questions, assumptions, and
            traceability links. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            handleDelete();
          }}
        >
          <Label htmlFor={confirmId} className="block font-normal">
            Type <span className="font-semibold">{project.name}</span> to confirm.
          </Label>
          <Input
            id={confirmId}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            disabled={pending}
            autoComplete="off"
            spellCheck={false}
          />
        </form>

        {error && (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          {/* A plain button, not AlertDialogAction, so the dialog stays open until the delete finishes. */}
          <Button
            variant="destructive"
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={handleDelete}
            disabled={!confirmed || pending}
          >
            {pending ? (
              <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
            ) : (
              <Trash2Icon data-icon="inline-start" />
            )}
            {pending ? "Deleting…" : "Delete project"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
