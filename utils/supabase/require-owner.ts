import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "./server";
import { isAuthorizedOwner } from "./authorization";

/**
 * Authoritative owner lookup for Server Components, Server Functions, and
 * Route Handlers. Uses getUser(), which validates the session with the Auth
 * server (catching revoked or deleted users that a cached JWT would not).
 * Returns null when there is no session or the user is not the owner.
 * Memoized per request.
 */
export const getOwner = cache(async () => {
  // Session checks read the clock (token expiry). With Partial Prefetching,
  // cookie-derived App Shell prerenders reject Date.now(), so defer to request time.
  await connection();
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || !isAuthorizedOwner(user)) {
    return null;
  }
  return { supabase, user };
});

/** Like getOwner(), but redirects to /login instead of returning null. */
export const requireOwner = cache(async () => {
  const owner = await getOwner();
  if (!owner) {
    redirect("/login");
  }
  return owner;
});
