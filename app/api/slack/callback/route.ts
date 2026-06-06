/**
 * GET /api/slack/callback?code=...&state=...
 *
 * Slack redirects here after the user authorizes. We verify the state cookie,
 * exchange the code for an incoming-webhook URL (+ channel/team), and store it
 * as a Slack notification destination (webhook URL encrypted). Lands on
 * /settings?connected=slack or ?error=.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { readAndClearStateCookie } from "@/lib/state";
import { exchangeSlackCode } from "@/lib/slack";
import { createSlackDestination } from "@/lib/notifications/destinations";
import { publicEnv } from "@/lib/env";

function settingsRedirect(qs: string): NextResponse {
  return NextResponse.redirect(`${publicEnv().NEXT_PUBLIC_APP_URL}/settings?${qs}`);
}

export async function GET(request: NextRequest) {
  const user = await requireUser();

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  const cookieState = readAndClearStateCookie();

  if (oauthError) return settingsRedirect(`error=${encodeURIComponent(oauthError)}`);
  if (!code) return settingsRedirect(`error=${encodeURIComponent("Missing authorization code.")}`);
  if (!state || !cookieState || state !== cookieState) {
    return settingsRedirect(`error=${encodeURIComponent("Invalid state. Please try connecting again.")}`);
  }

  let install;
  try {
    install = await exchangeSlackCode(code);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Slack authorization failed.";
    // eslint-disable-next-line no-console
    console.error("[slack/callback] exchange failed:", err);
    return settingsRedirect(`error=${encodeURIComponent(message)}`);
  }

  try {
    await createSlackDestination({ userId: user.id, install });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't save the Slack channel.";
    // eslint-disable-next-line no-console
    console.error("[slack/callback] save failed:", err);
    return settingsRedirect(`error=${encodeURIComponent(message)}`);
  }

  return settingsRedirect(`connected=slack`);
}
