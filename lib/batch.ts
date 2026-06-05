/**
 * Batch notification orchestration.
 *
 * A "batch" is a set of files uploaded together in one submission (they share a
 * batch_id). When the link has bundle_notifications on, we send ONE notification
 * + webhook for the whole batch instead of one per file.
 *
 * Exactly-once delivery is guaranteed by an atomic claim (claimBatchNotification):
 * whichever trigger reaches a "batch is done" state first wins and sends; any
 * other no-ops. Two triggers race, by design, for robustness:
 *
 *   1. The chunk route, after each file finalizes — fires once every declared
 *      file has reached a terminal state (the "last finalizer wins" path). This
 *      is resilient to the uploader closing their tab after the last file.
 *   2. The client's /api/upload/batch-complete call, after its upload loop ends
 *      — authoritative "the browser is done", which also covers the case where a
 *      file's initiate failed (so no row exists and the count-based path can
 *      never reach the declared size).
 *
 * Known limitation: if the uploader abandons mid-batch (files still in flight),
 * no bundled notification fires. Completed files are safely in storage and
 * visible in the dashboard; the owner just doesn't get a partial-batch ping.
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getBatchProgress, claimBatchNotification } from "@/lib/uploads";
import { sendUploadNotification, sendBatchUploadNotification } from "@/lib/email";
import { sendUploadWebhook, sendBatchUploadWebhook } from "@/lib/webhook";

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

async function sendSingle(uploadId: string): Promise<void> {
  await Promise.allSettled([sendUploadNotification(uploadId), sendUploadWebhook(uploadId)]);
}

/**
 * Claim + send the bundled notification for a batch, if it's ready.
 *  - requireDeclaredComplete: only fire once `terminal >= batch_size` (the
 *    chunk-route path, so we don't fire mid-batch since rows are created lazily).
 *    When false (client path), fire as long as nothing is still uploading.
 */
async function maybeSendBatch(
  batchId: string,
  opts: { requireDeclaredComplete: boolean },
): Promise<void> {
  const progress = await getBatchProgress(batchId);
  if (progress.total === 0) return;
  // Never fire while a file in the batch is still uploading.
  if (progress.uploading > 0) return;

  if (opts.requireDeclaredComplete) {
    // Without a declared size we can't tell "all arrived" apart from "between
    // files" (rows are created lazily), so defer to the client trigger.
    if (progress.declaredSize == null) return;
    if (progress.terminal < progress.declaredSize) return;
  }

  // Exactly one caller wins the claim and sends.
  const claimed = await claimBatchNotification(batchId);
  if (!claimed) return;
  await Promise.allSettled([
    sendBatchUploadNotification(batchId),
    sendBatchUploadWebhook(batchId),
  ]);
}

/**
 * Called by the chunk route after a file finalizes. Routes to a single
 * notification, per-file (bundling off), or the bundled batch path.
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

  // Not part of a batch → single notification (the common, original path).
  if (!upload.batch_id) {
    await sendSingle(uploadId);
    return;
  }

  const bundling = await getLinkBundling(upload.upload_link_id);
  if (!bundling) {
    // Owner wants one notification per file, even within a batch.
    await sendSingle(uploadId);
    return;
  }

  await maybeSendBatch(upload.batch_id, { requireDeclaredComplete: true });
}

/**
 * Called by /api/upload/batch-complete once the browser finishes its upload
 * loop. Authoritative "done" trigger (also covers initiate failures). No-op
 * when the link has bundling off (the chunk route already sent per-file).
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
