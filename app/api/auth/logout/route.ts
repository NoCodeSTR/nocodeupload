/**
 * Logout — POST /api/auth/logout
 *
 * Implemented as a POST route handler (not a server action) so the topbar
 * can fire it from a plain HTML form. signOut() clears the session cookies
 * via the server client's cookie adapter, then we 303 to the landing page.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
