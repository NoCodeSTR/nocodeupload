/**
 * GET /api/google/callback?code=...&state=...
 *
 * Google redirects here after the user clicks Allow on the consent screen.
 * Flow:
 *   1. Require an authenticated user (the same user who started /connect).
 *   2. Read and clear the state cookie. Compare to ?state= param.
 *   3. Exchange ?code= for tokens + identity (lib/providers/google/oauth).
 *   4. Encrypt tokens and upsert into storage_connections (lib/connections).
 *   5. Redirect to /settings?connected=google_drive (or ?error=...).
 *
 * All error paths land at /settings with a human-readable ?error= so the UI
 * can show a banner. Token material never leaks into the URL or the
 * browser process.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { readAndClearStateCookie, readAndClearOAuthTargetCookie } from "@/lib/state";
import { exchangeCode } from "@/lib/providers/google/oauth";
import { upsertConnection } from "@/lib/connections";
import { publicEnv } from "@/lib/env";

function settingsRedirect(qs: string): NextResponse {
  const { NEXT_PUBLIC_APP_URL } = publicEnv();
  return NextResponse.redirect(`${NEXT_PUBLIC_APP_URL}/settings?${qs}`);
}

export async function GET(request: NextRequest) {
  const user = await requireUser();

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");
  const oauthErrorDescription = searchParams.get("error_description");

  // Always clear the state + target cookies, even on error, to prevent replay.
  const cookieState = readAndClearStateCookie();
  const target = readAndClearOAuthTargetCookie();

  if (oauthError) {
    return settingsRedirect(
      `error=${encodeURIComponent(oauthErrorDescription ?? oauthError)}`,
    );
  }

  if (!code) {
    return settingsRedirect(`error=${encodeURIComponent("Missing authorization code.")}`);
  }

  if (!state || !cookieState || state !== cookieState) {
    return settingsRedirect(
      `error=${encodeURIComponent("Invalid state. Please try connecting again.")}`,
    );
  }

  let result;
  try {
    result = await exchangeCode(code);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to exchange code with Google.";
    // eslint-disable-next-line no-console
    console.error("[google/callback] exchangeCode failed:", err);
    return settingsRedirect(`error=${encodeURIComponent(message)}`);
  }

  try {
    await upsertConnection({
      userId: user.id,
      provider: target,
      result,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to store connection.";
    // eslint-disable-next-line no-console
    console.error("[google/callback] upsertConnection failed:", err);
    return settingsRedirect(`error=${encodeURIComponent(message)}`);
  }

  return settingsRedirect(`connected=${target}`);
}
