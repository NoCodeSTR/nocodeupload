"use server";

/**
 * Server actions for /login.
 *
 * Important: server actions can return JSON for the client to render
 * (errors, etc.) OR call redirect() — but not both. Use returns for
 * recoverable errors, redirect for success.
 */
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";

export async function signInWithPassword(formData: FormData): Promise<{ error?: string } | void> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  redirect(next.startsWith("/") ? next : "/dashboard");
}

export async function sendMagicLink(
  formData: FormData,
): Promise<{ error?: string; sent?: boolean } | void> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Email is required." };

  const supabase = createSupabaseServerClient();
  const env = publicEnv();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      // Do NOT auto-create users from magic-link sign-in on the login page.
      // Sign-up has its own flow.
      shouldCreateUser: false,
    },
  });

  if (error) {
    return { error: error.message };
  }
  return { sent: true };
}
