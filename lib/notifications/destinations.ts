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
import { formatPgError } from "@/lib/pg-error";
import type { NotificationDestinationRow, NotificationDestinationType } from "@/lib/db-types";

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
