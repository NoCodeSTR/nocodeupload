/**
 * Service-role Supabase client. BYPASSES Row-Level Security.
 * Use ONLY in server-side code that needs to:
 *   - Read/write encrypted OAuth tokens
 *   - Insert public upload rows on behalf of anonymous visitors
 *   - Run privileged admin queries
 * Never import this from a client component or route reachable by browsers
 * without explicit auth checks.
 */
import { createClient } from "@supabase/supabase-js";
import { coreEnv } from "@/lib/env";

let cachedAdmin: ReturnType<typeof createClient> | null = null;

export function getSupabaseAdmin() {
  if (cachedAdmin) return cachedAdmin;
  const env = coreEnv();
  cachedAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAdmin;
}
