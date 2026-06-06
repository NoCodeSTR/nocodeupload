/**
 * Slack OAuth (incoming-webhook flow) + message posting.
 *
 * We use the `incoming-webhook` scope: during install Slack shows the user a
 * channel picker and returns a webhook URL bound to that channel. We store the
 * URL (encrypted) and POST Block Kit JSON to it — no bot token management, and
 * the channel is chosen in Slack's own UI.
 *
 * The redirect URI is derived from NEXT_PUBLIC_APP_URL, so the Slack app must
 * list exactly `${NEXT_PUBLIC_APP_URL}/api/slack/callback` as a Redirect URL.
 */
import "server-only";
import { coreEnv } from "@/lib/env";

const AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const ACCESS_URL = "https://slack.com/api/oauth.v2.access";

export function slackRedirectUri(): string {
  return `${coreEnv().NEXT_PUBLIC_APP_URL}/api/slack/callback`;
}

export function buildSlackAuthUrl(state: string): string {
  const env = coreEnv();
  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID ?? "",
    // incoming-webhook is a bot scope in OAuth v2.
    scope: "incoming-webhook",
    redirect_uri: slackRedirectUri(),
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface SlackInstall {
  webhookUrl: string;
  channel: string;
  teamName: string;
}

/** Exchange the OAuth code for an incoming-webhook URL + channel/team. */
export async function exchangeSlackCode(code: string): Promise<SlackInstall> {
  const env = coreEnv();
  const body = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID ?? "",
    client_secret: env.SLACK_CLIENT_SECRET ?? "",
    code,
    redirect_uri: slackRedirectUri(),
  });
  const res = await fetch(ACCESS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    team?: { name?: string };
    incoming_webhook?: { url?: string; channel?: string };
  };
  if (!data.ok || !data.incoming_webhook?.url) {
    throw new Error(`Slack authorization failed: ${data.error ?? "unknown error"}`);
  }
  return {
    webhookUrl: data.incoming_webhook.url,
    channel: data.incoming_webhook.channel ?? "",
    teamName: data.team?.name ?? "",
  };
}

/** POST a Block Kit payload to an incoming webhook. Never throws. */
export async function postSlackWebhook(
  webhookUrl: string,
  payload: unknown,
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, detail: `responded ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "post failed" };
  }
}
