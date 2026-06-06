/**
 * notification_destinations — reusable, account-level channels.
 *
 * Owner CRUD uses the cookie-aware client (RLS scopes to auth.uid()). The
 * dispatch layer resolves destinations with the service-role client because it
 * runs in the anonymous upload context.
 *
 * A-1 ships the "email" type. Slack lands in A-2 (its config will hold an
 * AES-GCM-encrypted incoming-webhook URL + channel/team).
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { encryptString, decryptString } from "@/lib/crypto/tokens";
import { formatPgError } from "@/lib/pg-error";
import type { NotificationDestinationRow, NotificationDestinationType } from "@/lib/db-types";
import type { SlackInstall } from "@/lib/slack";

/** Safe-for-UI projection — never includes secrets. */
export interface DestinationSummary {
  id: string;
  type: NotificationDestinationType;
  label: string;
  detail: string | null;
}

function safeDetail(d: NotificationDestinationRow): string | null {
  if (d.type === "email") return (d.config as { address?: string }).address ?? null;
  if (d.type === "slack") {
    const c = d.config as { channel_name?: string; mention_user_name?: string };
    if (!c.channel_name) return null;
    return `#${c.channel_name}${c.mention_user_name ? ` → @${c.mention_user_name}` : ""}`;
  }
  if (d.type === "quo") {
    const c = d.config as { to?: string };
    return c.to ? `SMS to ${c.to}` : null;
  }
  return null;
}

export async function listDestinations(userId: string): Promise<DestinationSummary[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("notification_destinations")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(formatPgError("Failed to list destinations", error));
  return ((data ?? []) as NotificationDestinationRow[]).map((d) => ({
    id: d.id,
    type: d.type,
    label: d.label,
    detail: safeDetail(d),
  }));
}

export async function createEmailDestination(args: {
  userId: string;
  label: string;
  address: string;
}): Promise<{ id: string }> {
  const supabase = createSupabaseServerClient();
  const row = {
    user_id: args.userId,
    type: "email",
    label: args.label,
    config: { address: args.address },
  };
  const { data, error } = await supabase
    .from("notification_destinations")
    .insert(row as never)
    .select("id")
    .single();
  if (error) throw new Error(formatPgError("Failed to create destination", error));
  return { id: (data as { id: string }).id };
}

// --- Slack workspace connections (bot token) ---------------------------------

export interface SlackConnectionSummary {
  id: string;
  teamId: string;
  teamName: string | null;
}

/** Upsert the connected workspace's bot token (encrypted). One per workspace. */
export async function createSlackConnection(args: {
  userId: string;
  install: SlackInstall;
}): Promise<void> {
  const supabase = createSupabaseServerClient();
  const blob = encryptString(args.install.botToken);
  const row = {
    user_id: args.userId,
    team_id: args.install.teamId,
    team_name: args.install.teamName,
    bot_token_ciphertext: blob.ciphertext,
    bot_token_iv: blob.iv,
    bot_token_auth_tag: blob.authTag,
  };
  const { error } = await supabase
    .from("slack_connections")
    .upsert(row as never, { onConflict: "user_id,team_id" });
  if (error) throw new Error(formatPgError("Failed to save Slack connection", error));
}

/** Safe list of connected Slack workspaces (no tokens). */
export async function listSlackConnections(userId: string): Promise<SlackConnectionSummary[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("slack_connections")
    .select("id, team_id, team_name")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(formatPgError("Failed to list Slack connections", error));
  return ((data ?? []) as Array<{ id: string; team_id: string; team_name: string | null }>).map((r) => ({
    id: r.id,
    teamId: r.team_id,
    teamName: r.team_name,
  }));
}

/** Decrypt a workspace's bot token (service role; null if missing/invalid). */
export async function getSlackBotToken(args: {
  userId: string;
  connectionId: string;
}): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("slack_connections")
    .select("bot_token_ciphertext, bot_token_iv, bot_token_auth_tag")
    .eq("id", args.connectionId)
    .eq("user_id", args.userId)
    .maybeSingle();
  const row = data as
    | { bot_token_ciphertext: string; bot_token_iv: string; bot_token_auth_tag: string }
    | null;
  if (!row) return null;
  try {
    return decryptString({
      ciphertext: row.bot_token_ciphertext,
      iv: row.bot_token_iv,
      authTag: row.bot_token_auth_tag,
    });
  } catch {
    return null;
  }
}

/** Create a Slack channel destination referencing a workspace connection. */
export async function createSlackChannelDestination(args: {
  userId: string;
  label: string;
  slackConnectionId: string;
  channelId: string;
  channelName: string;
  mentionUserId?: string | null;
  mentionUserName?: string | null;
}): Promise<{ id: string }> {
  const supabase = createSupabaseServerClient();
  const row = {
    user_id: args.userId,
    type: "slack",
    label: args.label,
    config: {
      slack_connection_id: args.slackConnectionId,
      channel_id: args.channelId,
      channel_name: args.channelName,
      mention_user_id: args.mentionUserId ?? null,
      mention_user_name: args.mentionUserName ?? null,
    },
  };
  const { data, error } = await supabase
    .from("notification_destinations")
    .insert(row as never)
    .select("id")
    .single();
  if (error) throw new Error(formatPgError("Failed to create Slack destination", error));
  return { id: (data as { id: string }).id };
}

/** Persist a Quo (OpenPhone) SMS destination — API key stored encrypted. */
export async function createQuoDestination(args: {
  userId: string;
  label: string;
  apiKey: string;
  from: string;
  to: string;
}): Promise<{ id: string }> {
  const supabase = createSupabaseServerClient();
  const blob = encryptString(args.apiKey);
  const row = {
    user_id: args.userId,
    type: "quo",
    label: args.label,
    config: {
      apikey_ciphertext: blob.ciphertext,
      apikey_iv: blob.iv,
      apikey_auth_tag: blob.authTag,
      from: args.from,
      to: args.to,
    },
  };
  const { data, error } = await supabase
    .from("notification_destinations")
    .insert(row as never)
    .select("id")
    .single();
  if (error) throw new Error(formatPgError("Failed to create Quo destination", error));
  return { id: (data as { id: string }).id };
}

/** Decrypt a Quo destination's credentials (null if incomplete/invalid). */
export function decryptQuoCreds(
  config: Record<string, unknown>,
): { apiKey: string; from: string; to: string } | null {
  const ciphertext = config.apikey_ciphertext as string | undefined;
  const iv = config.apikey_iv as string | undefined;
  const authTag = config.apikey_auth_tag as string | undefined;
  const from = config.from as string | undefined;
  const to = config.to as string | undefined;
  if (!ciphertext || !iv || !authTag || !from || !to) return null;
  try {
    return { apiKey: decryptString({ ciphertext, iv, authTag }), from, to };
  } catch {
    return null;
  }
}

export async function deleteDestination(args: { userId: string; id: string }): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("notification_destinations")
    .delete()
    .eq("id", args.id)
    .eq("user_id", args.userId);
  if (error) throw new Error(formatPgError("Failed to delete destination", error));
}

/** Service-role resolve for the dispatch layer (anonymous upload context). */
export async function getDestinationsByIds(
  userId: string,
  ids: string[],
): Promise<NotificationDestinationRow[]> {
  if (ids.length === 0) return [];
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("notification_destinations")
    .select("*")
    .eq("user_id", userId)
    .in("id", ids);
  if (error) throw new Error(formatPgError("Failed to load destinations", error));
  return (data ?? []) as NotificationDestinationRow[];
}
