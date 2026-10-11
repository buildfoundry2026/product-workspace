import type { Metadata } from "next";
import { Suspense } from "react";
import { safeRedirectPath } from "@/utils/safe-redirect";
import { GoogleSignInButton } from "./google-sign-in-button";

export const metadata: Metadata = {
  title: "Sign in · Product Workspace",
};

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "This Google account is not authorized to access this workspace.",
  oauth_failed: "Google sign-in failed. Please try again.",
  missing_code: "The sign-in link was invalid or expired. Please try again.",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-8 flex flex-col gap-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Product Workspace
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Sign in with the authorized Google account to continue.
          </p>
        </div>

        <Suspense fallback={<SignInFallback />}>
          <SignInSection searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

/** Reads searchParams, so it must render inside a Suspense boundary. */
async function SignInSection({
  searchParams,
}: {
  searchParams: PageProps<"/login">["searchParams"];
}) {
  const params = await searchParams;
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const next = safeRedirectPath(typeof params.next === "string" ? params.next : undefined);
  const errorMessage = errorKey
    ? (ERROR_MESSAGES[errorKey] ?? "Something went wrong. Please try again.")
    : null;

  return (
    <>
      {errorMessage && (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        >
          {errorMessage}
        </div>
      )}
      <GoogleSignInButton next={next} />
    </>
  );
}

function SignInFallback() {
  return (
    <div
      aria-hidden
      className="h-11 w-full animate-pulse rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
    />
  );
}
