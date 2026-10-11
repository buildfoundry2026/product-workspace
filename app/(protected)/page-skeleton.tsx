export function PageSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-3">
      <div className="h-7 w-64 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}
