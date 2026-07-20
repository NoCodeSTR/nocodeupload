/**
 * Job handler registry — the ONLY place product code meets the Jobs Engine
 * (ADR-22). Handlers live in this folder and may import product domain
 * modules; lib/engine/jobs/ must never import from here or any product code.
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { JobHandler } from "@/lib/engine/jobs/types";
import { sendUploadWebhookClassified, sendBatchUploadWebhookClassified } from "@/lib/webhook";
import { logDelivery, hasSentDeliveryForJob } from "@/lib/notifications/deliveries";
import { createWebhookDeliverHandler, type WebhookDeliverPayload } from "./webhook-deliver";

async function loadWebhookOwner(
  p: WebhookDeliverPayload,
): Promise<{ userId: string; uploadLinkId: string } | null> {
  const admin = getSupabaseAdmin();
  const query = admin.from("uploads").select("user_id, upload_link_id").limit(1);
  const { data } =
    p.mode === "single"
      ? await query.eq("id", p.uploadId!)
      : await query.eq("batch_id", p.batchId!);
  const row = ((data ?? []) as Array<{ user_id: string; upload_link_id: string }>)[0];
  return row ? { userId: row.user_id, uploadLinkId: row.upload_link_id } : null;
}

export function allJobHandlers(): JobHandler[] {
  return [
    createWebhookDeliverHandler({
      sendSingle: (uploadId, jobId) => sendUploadWebhookClassified(uploadId, jobId),
      sendBatch: (batchId, jobId) => sendBatchUploadWebhookClassified(batchId, jobId),
      loadOwner: loadWebhookOwner,
      logDelivery: (args) => logDelivery({ ...args, channel: "webhook" }),
      hasSentDelivery: hasSentDeliveryForJob,
    }),
  ];
}
