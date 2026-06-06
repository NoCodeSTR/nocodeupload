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
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendNewSignupNotification } from "@/lib/email";

/**
 * Fire the admin new-signup email exactly once per user. Claims the profile's
 * signup_notified flag atomically (update ... where signup_notified = false),
 * so the email never repeats on subsequent logins. Best-effort; never blocks.
 */
async function maybeNotifyNewSignup(userId: string, email: string | null): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from("profiles")
      .update({ signup_notified: true } as never)
      .eq("id", userId)
      .eq("signup_notified", false)
      .select("id")
      .maybeSingle();
    if (data) await sendNewSignupNotification(email);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[auth/callback] signup notify failed:", err);
  }
}

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
  const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?message=${encodeURIComponent(error.message)}`,
    );
  }

  // Best-effort operator alert on the user's first authenticated arrival.
  const user = sessionData?.user;
  if (user) await maybeNotifyNewSignup(user.id, user.email ?? null);

  const safeNext = next.startsWith("/") ? next : "/dashboard";
  return NextResponse.redirect(`${origin}${safeNext}`);
}
