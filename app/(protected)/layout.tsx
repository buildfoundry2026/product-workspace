import { Suspense } from "react";
import { requireOwner } from "@/utils/supabase/require-owner";
import { PageSkeleton } from "./page-skeleton";

/**
 * Layout for every authenticated route. proxy.ts gates optimistically; the
 * Suspense-wrapped components below re-verify the owner server-side before
 * rendering any user data or page content.
 */
export default function ProtectedLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
          <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Product Workspace
          </span>
          <Suspense
            fallback={
              <div className="h-5 w-40 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
            }
          >
            <UserMenu />
          </Suspense>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8">
        <Suspense fallback={<PageSkeleton />}>
          <OwnerGate>{children}</OwnerGate>
        </Suspense>
      </div>
    </div>
  );
}

async function OwnerGate({ children }: { children: React.ReactNode }) {
  await requireOwner();
  return children;
}

async function UserMenu() {
  const { user } = await requireOwner();

  return (
    <div className="flex items-center gap-4">
      <span className="hidden text-sm text-zinc-600 sm:inline dark:text-zinc-400">
        {user.email}
      </span>
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
