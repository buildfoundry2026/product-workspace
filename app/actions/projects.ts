"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getOwner } from "@/utils/supabase/require-owner";
import { MAX_PROJECT_DESCRIPTION_CHARS, MAX_PROJECT_NAME_CHARS } from "@/lib/projects/limits";
import { ingestTextSource } from "./sources";

const MAX_BRIEF_CHARS = 200_000;

const createProjectInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Project name is required.")
    .max(200, "Project name must be 200 characters or fewer."),
  brief: z
    .string()
    .trim()
    .min(1, "Paste the business brief.")
    .max(MAX_BRIEF_CHARS, `The brief must be ${MAX_BRIEF_CHARS.toLocaleString()} characters or fewer.`),
});

export type CreateProjectState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: { name?: string[]; brief?: string[] };
  /** Set when the project was created but the brief could not be ingested. */
  projectId?: string;
  values?: { name: string; brief: string };
};

/**
 * Creates a project and ingests its business brief (FR-001 + FR-002), then
 * redirects to the project dashboard. Both fields are validated before any
 * write so invalid input never leaves an empty project behind.
 */
export async function createProjectWithBrief(
  _prev: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  const values = {
    name: String(formData.get("name") ?? ""),
    brief: String(formData.get("brief") ?? ""),
  };

  const parsed = createProjectInput.safeParse(values);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      values,
    };
  }

  const owner = await getOwner();
  if (!owner) {
    return { status: "error", message: "Your session has expired. Sign in again.", values };
  }
  const { supabase, user } = owner;

  const { data: project, error } = await supabase
    .from("projects")
    .insert({ name: parsed.data.name, owner_id: user.id })
    .select("id")
    .single();

  if (error || !project) {
    console.error("[createProjectWithBrief] project insert failed", { code: error?.code });
    return {
      status: "error",
      message:
        error?.code === "42501"
          ? "The database denied access. Check that the owner account is provisioned."
          : "Could not create the project. Please try again.",
      values,
    };
  }

  const result = await ingestTextSource({
    projectId: project.id,
    text: parsed.data.brief,
    title: `${parsed.data.name} brief`.slice(0, 300),
  });

  if (!result.ok) {
    return {
      status: "error",
      message: `The project was created, but the brief could not be processed. ${result.message}`,
      projectId: project.id,
      values,
    };
  }

  redirect(`/projects/${project.id}?created=1`);
}

// -----------------------------------------------------------------------------
// Edit / delete (FR-001)
// -----------------------------------------------------------------------------

const updateProjectInput = z.object({
  projectId: z.uuid("Invalid project ID."),
  name: z
    .string()
    .trim()
    .min(1, "Project name is required.")
    .max(MAX_PROJECT_NAME_CHARS, `Project name must be ${MAX_PROJECT_NAME_CHARS} characters or fewer.`),
  description: z
    .string()
    .trim()
    .max(
      MAX_PROJECT_DESCRIPTION_CHARS,
      `The description must be ${MAX_PROJECT_DESCRIPTION_CHARS.toLocaleString()} characters or fewer.`,
    )
    .transform((value) => value || null),
});

export type ProjectMutationResult =
  | { ok: true }
  | {
      ok: false;
      code: "INVALID_INPUT" | "UNAUTHORIZED" | "NOT_FOUND" | "DB_ERROR";
      message: string;
      fieldErrors?: { name?: string[]; description?: string[] };
    };

/**
 * Renames a project and updates its description. Ownership is enforced twice:
 * the caller must be the signed-in workspace owner, and RLS only matches rows
 * whose owner_id is auth.uid(), so a project that is not ours updates zero
 * rows and is reported as not found.
 */
export async function updateProject(input: {
  projectId: string;
  name: string;
  description: string;
}): Promise<ProjectMutationResult> {
  const parsed = updateProjectInput.safeParse(input);
  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: fieldErrors.projectId?.[0] ?? "Please fix the highlighted fields.",
      fieldErrors: { name: fieldErrors.name, description: fieldErrors.description },
    };
  }

  const owner = await getOwner();
  if (!owner) {
    return { ok: false, code: "UNAUTHORIZED", message: "Your session has expired. Sign in again." };
  }

  const { projectId, name, description } = parsed.data;
  const { data, error } = await owner.supabase
    .from("projects")
    .update({ name, description })
    .eq("id", projectId)
    .eq("owner_id", owner.user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[updateProject] update failed", { projectId, code: error.code });
    return { ok: false, code: "DB_ERROR", message: describeProjectDbError(error.code, "update") };
  }
  if (!data) {
    return { ok: false, code: "NOT_FOUND", message: "Project not found. It may have been deleted." };
  }

  revalidatePath("/");
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

/**
 * Permanently deletes a project. Every child table (runs, sources, chunks,
 * assumptions, gaps, requirements, artifacts, links) references projects with
 * ON DELETE CASCADE, so one delete removes all of the project's data
 * atomically; nothing is left behind if it fails.
 */
export async function deleteProject(projectId: string): Promise<ProjectMutationResult> {
  const parsedId = z.uuid().safeParse(projectId);
  if (!parsedId.success) {
    return { ok: false, code: "INVALID_INPUT", message: "Invalid project ID." };
  }

  const owner = await getOwner();
  if (!owner) {
    return { ok: false, code: "UNAUTHORIZED", message: "Your session has expired. Sign in again." };
  }

  const { data, error } = await owner.supabase
    .from("projects")
    .delete()
    .eq("id", parsedId.data)
    .eq("owner_id", owner.user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[deleteProject] delete failed", { projectId: parsedId.data, code: error.code });
    return { ok: false, code: "DB_ERROR", message: describeProjectDbError(error.code, "delete") };
  }
  if (!data) {
    return { ok: false, code: "NOT_FOUND", message: "Project not found. It may already be deleted." };
  }

  revalidatePath("/");
  revalidatePath(`/projects/${parsedId.data}`, "layout");
  return { ok: true };
}

function describeProjectDbError(code: string | undefined, action: "update" | "delete"): string {
  switch (code) {
    case "42501":
      return "The database denied access. Check that the owner account is provisioned.";
    case "23503":
    case "23514":
      return `The project could not be ${action}d because related data blocked the change. Please try again.`;
    default:
      return `Could not ${action} the project. Please try again.`;
  }
}
