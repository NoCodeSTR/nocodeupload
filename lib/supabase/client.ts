/**
 * Browser-side Supabase client.
 * Use in client components only. Reads the anon key.
 */
import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

export function createSupabaseBrowserClient() {
  const env = publicEnv();
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
