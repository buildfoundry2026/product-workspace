import type { Metadata } from "next";
import Link from "next/link";
import { NewProjectForm } from "./new-project-form";

export const metadata: Metadata = {
  title: "New project · Product Workspace",
};

export default function NewProjectPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link
          href="/"
          className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← All projects
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          New project
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Name the project and paste the business brief to start discovery.
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-950">
        <NewProjectForm />
      </div>
    </div>
  );
}
