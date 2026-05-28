"use server";

/**
 * Server action for /signup.
 *
 * Flow:
 *  - Calls supabase.auth.signUp with email + password.
 *  - If the Supabase project has "Confirm email" enabled, the user gets
 *    a confirmation email; signup returns immediately and we redirect to
 *    /login?message=Check%20your%20email.
 *  - If "Confirm email" is off (typical for local dev), Supabase issues a
 *    session immediately and we redirect to /dashboard.
 */
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";

export async function signUp(formData: FormData): Promise<{ error?: string } | void> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const supabase = createSupabaseServerClient();
  const env = publicEnv();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  // session is null when email confirmation is required.
  if (!data.session) {
    redirect("/login?message=Check%20your%20email%20to%20confirm%20your%20account.");
  }

  redirect("/dashboard");
}
