/**
 * notification_deliveries — write (service role, from the anonymous upload
 * pipeline) and read (owner, RLS) the per-attempt log that powers the
 * "what happened to my notifications" view.
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatPgError } from "@/lib/pg-error";
import type { NotificationDeliveryRow } from "@/lib/db-types";
import type { NotifyResult, NotificationChannel } from "@/lib/notifications/types";

export async function logDelivery(args: {
  userId: string;
  uploadLinkId: string;
  channel: NotificationChannel;
  result: NotifyResult;
  uploadId?: string | null;
  batchId?: string | null;
}): Promise<void> {
  const admin = getSupabaseAdmin();
  const row = {
    user_id: args.userId,
    upload_link_id: args.uploadLinkId,
    upload_id: args.uploadId ?? null,
    batch_id: args.batchId ?? null,
    channel: args.channel,
    target: args.result.target ?? null,
    status: args.result.status,
    detail: args.result.detail ?? null,
  };
  const { error } = await admin.from("notification_deliveries").insert(row as never);
  if (error) {
    // Best-effort: logging must never break the upload flow.
    // eslint-disable-next-line no-console
    console.warn("[deliveries] log failed:", formatPgError("log", error));
  }
}

export async function listDeliveriesForLink(args: {
  userId: string;
  linkId: string;
  limit?: number;
}): Promise<NotificationDeliveryRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("notification_deliveries")
    .select("*")
    .eq("user_id", args.userId)
    .eq("upload_link_id", args.linkId)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 20);
  if (error) throw new Error(formatPgError("Failed to list deliveries", error));
  return (data ?? []) as NotificationDeliveryRow[];
}
