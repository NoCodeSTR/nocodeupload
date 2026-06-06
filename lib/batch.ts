/**
 * Batch notification orchestration.
 *
 * Decides single vs. bundled and guarantees exactly-once bundled delivery via
 * an atomic claim (claimBatchNotification), raced by two triggers (the chunk
 * route's "last file finalizes" and the client's batch-complete call). The
 * actual fan-out to channels (default email/webhook + routing rules) lives in
 * lib/notifications/dispatch.ts; this module just decides WHEN to dispatch.
 *
 * Known limitation: if the uploader abandons mid-batch, no bundled notification
 * fires. Completed files are safe in storage and visible in the dashboard.
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getBatchProgress, claimBatchNotification } from "@/lib/uploads";
import { deliverForUpload, deliverForBatch } from "@/lib/notifications/dispatch";

async function getLinkBundling(linkId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("upload_links")
    .select("bundle_notifications")
    .eq("id", linkId)
    .maybeSingle();
  const link = data as { bundle_notifications: boolean } | null;
  return link?.bundle_notifications ?? true;
}

/**
 * Claim + dispatch the bundled notification for a batch, if it's ready.
 *  - requireDeclaredComplete: only fire once `terminal >= batch_size` (the
 *    chunk-route path, so we don't fire mid-batch since rows are created
 *    lazily). When false (client path), fire as long as nothing is still
 *    uploading.
 */
async function maybeSendBatch(
  batchId: string,
  opts: { requireDeclaredComplete: boolean },
): Promise<void> {
  const progress = await getBatchProgress(batchId);
  if (progress.total === 0) return;
  if (progress.uploading > 0) return;

  if (opts.requireDeclaredComplete) {
    if (progress.declaredSize == null) return;
    if (progress.terminal < progress.declaredSize) return;
  }

  const claimed = await claimBatchNotification(batchId);
  if (!claimed) return;
  await deliverForBatch(batchId);
}

/**
 * Called by the chunk route after a file finalizes. Routes to a single
 * dispatch, per-file (bundling off), or the bundled batch path.
 */
export async function notifyAfterUpload(uploadId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("uploads")
    .select("batch_id, upload_link_id")
    .eq("id", uploadId)
    .maybeSingle();
  const upload = data as { batch_id: string | null; upload_link_id: string } | null;
  if (!upload) return;

  // Not part of a batch → single dispatch (the common, original path).
  if (!upload.batch_id) {
    await deliverForUpload(uploadId);
    return;
  }

  const bundling = await getLinkBundling(upload.upload_link_id);
  if (!bundling) {
    // Owner wants one notification per file, even within a batch.
    await deliverForUpload(uploadId);
    return;
  }

  await maybeSendBatch(upload.batch_id, { requireDeclaredComplete: true });
}

/**
 * Called by /api/upload/batch-complete once the browser finishes its upload
 * loop. Authoritative "done" trigger (also covers initiate failures). No-op
 * when the link has bundling off (the chunk route already dispatched per-file).
 */
export async function finalizeBatchFromClient(batchId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("uploads")
    .select("upload_link_id")
    .eq("batch_id", batchId)
    .limit(1)
    .maybeSingle();
  const upload = data as { upload_link_id: string } | null;
  if (!upload) return;

  const bundling = await getLinkBundling(upload.upload_link_id);
  if (!bundling) return;

  await maybeSendBatch(batchId, { requireDeclaredComplete: false });
}
