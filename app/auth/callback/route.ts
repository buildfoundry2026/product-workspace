import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { isAuthorizedOwner } from "@/utils/supabase/authorization";
import { safeRedirectPath } from "@/utils/safe-redirect";

/**
 * Google OAuth (PKCE) callback: exchanges the auth code for a session, then
 * rejects any account other than the configured owner.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"));

  const loginUrl = (error: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error)}`);

  if (searchParams.get("error")) {
    return loginUrl("oauth_failed");
  }
  if (!code) {
    return loginUrl("missing_code");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    console.error("OAuth code exchange failed", error?.message);
    return loginUrl("oauth_failed");
  }

  if (!isAuthorizedOwner(data.user)) {
    await supabase.auth.signOut();
    return loginUrl("unauthorized");
  }

  // Behind a load balancer the public host is in x-forwarded-host.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocal = process.env.NODE_ENV === "development";
  const base = !isLocal && forwardedHost ? `https://${forwardedHost}` : origin;

  return NextResponse.redirect(`${base}${next}`);
}
