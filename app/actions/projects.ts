"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getOwner } from "@/utils/supabase/require-owner";
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
