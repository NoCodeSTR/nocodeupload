/**
 * Slack OAuth (bot-token flow) + Web API helpers.
 *
 * We request a bot token so owners connect their workspace ONCE and then pick
 * any channel (and an optional person to @mention) from dropdowns — rather than
 * one webhook per channel. Posting uses chat.postMessage; we auto-join public
 * channels the bot isn't in yet.
 *
 * Scopes: chat:write, channels:read, groups:read, users:read, channels:join.
 * Redirect URI is derived from NEXT_PUBLIC_APP_URL, so the Slack app must list
 * exactly `${NEXT_PUBLIC_APP_URL}/api/slack/callback` as a Redirect URL.
 */
import "server-only";
import { coreEnv } from "@/lib/env";

const AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const ACCESS_URL = "https://slack.com/api/oauth.v2.access";
const API = "https://slack.com/api";
const SCOPES = "chat:write,channels:read,groups:read,users:read,channels:join";

export function slackRedirectUri(): string {
  return `${coreEnv().NEXT_PUBLIC_APP_URL}/api/slack/callback`;
}

export function buildSlackAuthUrl(state: string): string {
  const env = coreEnv();
  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID ?? "",
    scope: SCOPES,
    redirect_uri: slackRedirectUri(),
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface SlackInstall {
  botToken: string;
  teamId: string;
  teamName: string;
}

/** Exchange the OAuth code for a bot token + workspace identity. */
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
    access_token?: string; // the bot token (xoxb-…) for v2 bot installs
    team?: { id?: string; name?: string };
  };
  if (!data.ok || !data.access_token) {
    throw new Error(`Slack authorization failed: ${data.error ?? "unknown error"}`);
  }
  return {
    botToken: data.access_token,
    teamId: data.team?.id ?? "",
    teamName: data.team?.name ?? "",
  };
}

async function slackGet<T>(token: string, method: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API}/${method}?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return (await res.json()) as T;
}

export interface SlackChannel {
  id: string;
  name: string;
}
export interface SlackMember {
  id: string;
  name: string;
}

/** List channels the bot can see (public + private it's in). */
export async function listChannels(token: string): Promise<SlackChannel[]> {
  const data = await slackGet<{
    ok?: boolean;
    channels?: Array<{ id: string; name: string; is_archived?: boolean }>;
  }>(token, "conversations.list", {
    types: "public_channel,private_channel",
    exclude_archived: "true",
    limit: "200",
  });
  return (data.channels ?? [])
    .filter((c) => !c.is_archived)
    .map((c) => ({ id: c.id, name: c.name }));
}

/** List real people in the workspace (no bots, no deleted, no Slackbot). */
export async function listMembers(token: string): Promise<SlackMember[]> {
  const data = await slackGet<{
    ok?: boolean;
    members?: Array<{
      id: string;
      name: string;
      real_name?: string;
      deleted?: boolean;
      is_bot?: boolean;
      profile?: { display_name?: string; real_name?: string };
    }>;
  }>(token, "users.list", { limit: "200" });
  return (data.members ?? [])
    .filter((m) => !m.deleted && !m.is_bot && m.id !== "USLACKBOT")
    .map((m) => ({
      id: m.id,
      name: m.profile?.display_name || m.profile?.real_name || m.real_name || m.name,
    }));
}

async function joinChannel(token: string, channel: string): Promise<void> {
  await fetch(`${API}/conversations.join`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel }),
    cache: "no-store",
  }).catch(() => {});
}

/**
 * Post a message to a channel. Retries once after joining if the bot isn't in
 * the (public) channel yet. Returns { ok, detail }.
 */
export async function postChatMessage(
  token: string,
  channel: string,
  text: string,
  blocks?: unknown[],
): Promise<{ ok: boolean; detail?: string }> {
  async function post(): Promise<{ ok?: boolean; error?: string }> {
    const res = await fetch(`${API}/chat.postMessage`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel, text, ...(blocks ? { blocks } : {}) }),
      cache: "no-store",
    });
    return (await res.json()) as { ok?: boolean; error?: string };
  }
  try {
    let data = await post();
    if (!data.ok && data.error === "not_in_channel") {
      await joinChannel(token, channel);
      data = await post();
    }
    return data.ok ? { ok: true } : { ok: false, detail: data.error ?? "post failed" };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "post failed" };
  }
}
