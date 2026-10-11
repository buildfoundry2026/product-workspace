"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createProjectWithBrief, type CreateProjectState } from "@/app/actions/projects";

const MAX_BRIEF_CHARS = 200_000;
const initialState: CreateProjectState = { status: "idle" };

export function NewProjectForm() {
  const [state, formAction, pending] = useActionState(createProjectWithBrief, initialState);
  const [briefLength, setBriefLength] = useState(state.values?.brief.length ?? 0);

  const nameError = state.fieldErrors?.name?.[0];
  const briefError = state.fieldErrors?.brief?.[0];

  return (
    <form action={formAction} className="flex flex-col gap-6" aria-busy={pending}>
      {state.status === "error" && state.message && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        >
          <p>{state.message}</p>
          {state.projectId && (
            <Link
              href={`/projects/${state.projectId}`}
              className="mt-2 inline-block font-medium underline underline-offset-2"
            >
              Open the project
            </Link>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="name" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Project name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={200}
          autoComplete="off"
          defaultValue={state.values?.name}
          disabled={pending}
          aria-invalid={!!nameError}
          aria-describedby={nameError ? "name-error" : undefined}
          placeholder="e.g. Invoice automation for freelancers"
          className={fieldClass(!!nameError)}
        />
        {nameError && (
          <p id="name-error" className="text-sm text-red-600 dark:text-red-400">
            {nameError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <label htmlFor="brief" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Business brief
          </label>
          <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-500">
            {briefLength.toLocaleString()} / {MAX_BRIEF_CHARS.toLocaleString()}
          </span>
        </div>
        <textarea
          id="brief"
          name="brief"
          required
          rows={16}
          maxLength={MAX_BRIEF_CHARS}
          defaultValue={state.values?.brief}
          disabled={pending}
          onChange={(e) => setBriefLength(e.target.value.length)}
          aria-invalid={!!briefError}
          aria-describedby={briefError ? "brief-error brief-hint" : "brief-hint"}
          placeholder="Paste the client brief, meeting notes, or problem statement…"
          className={`${fieldClass(!!briefError)} min-h-64 resize-y py-3 font-mono text-[13px] leading-relaxed`}
        />
        <p id="brief-hint" className="text-xs text-zinc-500 dark:text-zinc-500">
          The original text is stored as a source and split into chunks for analysis.
        </p>
        {briefError && (
          <p id="brief-error" className="text-sm text-red-600 dark:text-red-400">
            {briefError}
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-3">
        <Link
          href="/"
          className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {pending && (
            <span
              aria-hidden
              className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white dark:border-zinc-900/30 dark:border-t-zinc-900"
            />
          )}
          {pending ? "Processing brief…" : "Submit"}
        </button>
      </div>
    </form>
  );
}

function fieldClass(invalid: boolean) {
  return [
    "w-full rounded-lg border bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400",
    "focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60",
    "dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600",
    invalid
      ? "border-red-400 focus:ring-red-500/30 dark:border-red-700"
      : "border-zinc-300 focus:border-zinc-500 focus:ring-zinc-900/10 dark:border-zinc-700 dark:focus:ring-zinc-100/10",
  ].join(" ");
}
