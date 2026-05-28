/**
 * OAuth-style callback for Supabase Auth.
 *
 * Handles two arrival paths:
 *
 *  1. Magic-link click: `?code=...` from supabase.auth.signInWithOtp({...})
 *  2. Email confirmation click: `?code=...` from supabase.auth.signUp({...})
 *
 * In both cases we exchange the code for a session (which writes the cookies)
 * and then redirect to `?next=...` or /dashboard.
 *
 * On failure we redirect to /login with an error message so the user isn't
 * left staring at a blank page.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
  const errorDescription = searchParams.get("error_description");

  if (errorDescription) {
    return NextResponse.redirect(
      `${origin}/login?message=${encodeURIComponent(errorDescription)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?message=${encodeURIComponent("Missing auth code.")}`,
    );
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?message=${encodeURIComponent(error.message)}`,
    );
  }

  const safeNext = next.startsWith("/") ? next : "/dashboard";
  return NextResponse.redirect(`${origin}${safeNext}`);
}
