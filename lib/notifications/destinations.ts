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
    const c = d.config as { channel?: string; team?: string };
    return c.channel ? `${c.team ? `${c.team} · ` : ""}${c.channel}` : null;
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

/** Persist a connected Slack channel (incoming webhook URL stored encrypted). */
export async function createSlackDestination(args: {
  userId: string;
  install: SlackInstall;
}): Promise<{ id: string }> {
  const supabase = createSupabaseServerClient();
  const blob = encryptString(args.install.webhookUrl);
  const channel = args.install.channel || "channel";
  const label = [args.install.teamName, channel].filter(Boolean).join(" · ") || "Slack";
  const row = {
    user_id: args.userId,
    type: "slack",
    label,
    config: {
      webhook_ciphertext: blob.ciphertext,
      webhook_iv: blob.iv,
      webhook_auth_tag: blob.authTag,
      channel,
      team: args.install.teamName,
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

/** Decrypt a Slack destination's incoming webhook URL (null if not present). */
export function decryptSlackWebhook(config: Record<string, unknown>): string | null {
  const ciphertext = config.webhook_ciphertext as string | undefined;
  const iv = config.webhook_iv as string | undefined;
  const authTag = config.webhook_auth_tag as string | undefined;
  if (!ciphertext || !iv || !authTag) return null;
  try {
    return decryptString({ ciphertext, iv, authTag });
  } catch {
    return null;
  }
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
