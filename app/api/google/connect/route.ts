/**
 * GET /api/google/connect[?target=google_drive|youtube]
 *
 * Starts the Google OAuth flow:
 *   1. Require an authenticated user (storage OAuth is per-user, never
 *      conflated with SaaS auth).
 *   2. Generate a CSRF state, set HttpOnly cookie.
 *   3. Stash the connection target (Drive vs YouTube) in a cookie so the
 *      callback knows which provider/scopes were requested.
 *   4. Build the consent URL via the Google adapter and 302 to Google.
 *
 * Drive and YouTube share one OAuth app but request different scopes:
 *   - target=google_drive (default) → drive.file (sensitive, light verification)
 *   - target=youtube               → youtube.upload (sensitive, audited)
 *
 * Errors surface to /settings with ?error=... so the user sees something
 * useful instead of a JSON blob.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  generateState,
  setStateCookie,
  setOAuthTargetCookie,
  type OAuthTarget,
} from "@/lib/state";
import {
  buildAuthorizationUrl,
  GOOGLE_DRIVE_SCOPES,
  YOUTUBE_SCOPES,
} from "@/lib/providers/google/oauth";
import { publicEnv } from "@/lib/env";
import { YOUTUBE_ENABLED } from "@/lib/features";

export async function GET(request: NextRequest) {
  // Forces redirect to /login if not signed in.
  await requireUser();

  const target: OAuthTarget =
    new URL(request.url).searchParams.get("target") === "youtube"
      ? "youtube"
      : "google_drive";

  // YouTube is gated off (deferred until the YouTube API audit + quota are
  // approved). Never request the youtube.upload scope while disabled.
  if (target === "youtube" && !YOUTUBE_ENABLED) {
    const env = publicEnv();
    return NextResponse.redirect(
      `${env.NEXT_PUBLIC_APP_URL}/settings?error=${encodeURIComponent(
        "YouTube uploads are coming soon and can't be connected yet.",
      )}`,
    );
  }

  try {
    const state = generateState();
    setStateCookie(state);
    setOAuthTargetCookie(target);
    const scopes = target === "youtube" ? YOUTUBE_SCOPES : GOOGLE_DRIVE_SCOPES;
    const authUrl = buildAuthorizationUrl(state, scopes);
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
