/**
 * GET /api/google/connect
 *
 * Starts the Google OAuth flow:
 *   1. Require an authenticated user (storage OAuth is per-user, never
 *      conflated with SaaS auth).
 *   2. Generate a CSRF state, set HttpOnly cookie.
 *   3. Build the consent URL via the Google adapter and 302 to Google.
 *
 * Errors surface to /settings with ?error=... so the user sees something
 * useful instead of a JSON blob.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { generateState, setStateCookie } from "@/lib/state";
import { buildAuthorizationUrl } from "@/lib/providers/google/oauth";
import { publicEnv } from "@/lib/env";

export async function GET() {
  // Forces redirect to /login if not signed in.
  await requireUser();

  try {
    const state = generateState();
    setStateCookie(state);
    const authUrl = buildAuthorizationUrl(state);
    return NextResponse.redirect(authUrl);
  } catch (err) {
    // Most likely cause: Google env vars not configured.
    const env = publicEnv();
    const message =
      err instanceof Error ? err.message : "Failed to start Google OAuth";
    return NextResponse.redirect(
      `${env.NEXT_PUBLIC_APP_URL}/settings?error=${encodeURIComponent(message)}`,
    );
  }
}
