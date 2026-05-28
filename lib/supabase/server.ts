/**
 * Server-side Supabase client (request-scoped).
 * Use in Server Components, Route Handlers, and Server Actions.
 * Honors the user's session cookie and respects RLS.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";

export function createSupabaseServerClient() {
  const cookieStore = cookies();
  const env = publicEnv();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component — cookies are read-only.
            // Refresh logic in middleware handles writes.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // See above.
          }
        },
      },
    },
  );
}
