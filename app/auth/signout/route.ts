import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

/** POST-only so sign-out cannot be triggered by a cross-site link or prefetch. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
