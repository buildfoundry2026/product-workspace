import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components. Uses the publishable key only;
 * all data access is still gated by RLS.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
