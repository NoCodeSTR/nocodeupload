/**
 * GET /api/slack/connect
 *
 * Starts the Slack OAuth (incoming-webhook) flow: require an authenticated
 * user, set a CSRF state cookie, and redirect to Slack's consent screen where
 * the user picks a channel. Errors land on /settings with ?error=.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { generateState, setStateCookie } from "@/lib/state";
import { buildSlackAuthUrl } from "@/lib/slack";
import { features, publicEnv } from "@/lib/env";

export async function GET() {
  await requireUser();
  const { NEXT_PUBLIC_APP_URL } = publicEnv();

  if (!features().slack) {
    return NextResponse.redirect(
      `${NEXT_PUBLIC_APP_URL}/settings?error=${encodeURIComponent("Slack isn't configured on this deployment.")}`,
    );
  }

  try {
    const state = generateState();
    setStateCookie(state);
    return NextResponse.redirect(buildSlackAuthUrl(state));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't start Slack connect.";
    return NextResponse.redirect(`${NEXT_PUBLIC_APP_URL}/settings?error=${encodeURIComponent(message)}`);
  }
}
