import type { JwtPayload, User } from "@supabase/supabase-js";

/**
 * Single-owner authorization. Mirrors app_private.is_authorized_owner() in
 * supabase/schema.sql: the identity must carry the owner's email and be linked
 * to Google. Fails closed when AUTHORIZED_OWNER_EMAIL is not configured.
 *
 * Server-only: AUTHORIZED_OWNER_EMAIL is not exposed to the browser.
 */
export function getAuthorizedOwnerEmail(): string | null {
  const email = process.env.AUTHORIZED_OWNER_EMAIL?.trim().toLowerCase();
  return email ? email : null;
}

type Identity = Pick<User, "email" | "app_metadata"> | JwtPayload;

export function isAuthorizedOwner(identity: Identity | null | undefined): boolean {
  const ownerEmail = getAuthorizedOwnerEmail();
  if (!ownerEmail || !identity?.email) return false;

  const providers = identity.app_metadata?.providers ?? [];
  return (
    identity.email.trim().toLowerCase() === ownerEmail &&
    providers.includes("google")
  );
}
