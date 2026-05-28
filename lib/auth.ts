/**
 * Server-side auth helpers for the dashboard.
 *
 * Use `requireUser()` in any Server Component / Route Handler / Server Action
 * that should only run for authenticated users — it redirects to /login if the
 * session is missing or expired.
 *
 * Use `getUser()` when you want the user (or null) without forcing a redirect.
 */
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Get the current authenticated user, or null if there's no valid session.
 * Use this when an unauthenticated state is valid (e.g. landing page banners
 * that change based on login state).
 */
export async function getUser(): Promise<User | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Get the current user, or redirect to /login if not signed in.
 * Use this in any route under /dashboard or /settings.
 */
export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}
