import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedOwner } from "./authorization";

/** Routes reachable without a session. Everything else requires the owner. */
const PUBLIC_PATHS = ["/login", "/auth/"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) =>
    p.endsWith("/") ? pathname.startsWith(p) : pathname === p,
  );
}

/**
 * Refreshes the Supabase session cookie and enforces the single-owner rule.
 * This is an optimistic gate only; the protected layout and RLS re-verify.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const responseHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          Object.assign(responseHeaders, headers);
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and getClaims(): it refreshes
  // the session, and skipping it can randomly log the user out.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;

  const { pathname } = request.nextUrl;
  const authorized = isAuthorizedOwner(claims);

  // Signed in with a non-owner Google account: clear the session.
  if (claims && !authorized) {
    await supabase.auth.signOut();
    if (!isPublicPath(pathname)) {
      return redirectWithSession(request, supabaseResponse, responseHeaders, "/login", {
        error: "unauthorized",
      });
    }
    return supabaseResponse;
  }

  if (!authorized && !isPublicPath(pathname)) {
    const next = pathname + request.nextUrl.search;
    return redirectWithSession(request, supabaseResponse, responseHeaders, "/login", {
      next,
    });
  }

  if (authorized && pathname === "/login") {
    return redirectWithSession(request, supabaseResponse, responseHeaders, "/");
  }

  return supabaseResponse;
}

/** Redirect while carrying over any refreshed/cleared auth cookies. */
function redirectWithSession(
  request: NextRequest,
  source: NextResponse,
  headers: Record<string, string>,
  pathname: string,
  params: Record<string, string> = {},
) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );

  const redirect = NextResponse.redirect(url);
  source.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  Object.entries(headers).forEach(([key, value]) =>
    redirect.headers.set(key, value),
  );
  return redirect;
}
