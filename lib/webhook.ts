/**
 * Per-link webhook delivery (Zapier / Make / custom endpoints).
 *
 * On a completed upload (or a completed batch), if the link has a webhook_url,
 * POST a JSON payload signed with the link's webhook_secret (HMAC-SHA256).
 * Recipients verify by recomputing the signature over the raw body.
 *
 *   Headers:
 *     Content-Type: application/json
 *     X-NoCodeUpload-Event: upload.completed | batch.completed
 *     X-NoCodeUpload-Signature: sha256=<hex>
 *
 * Every payload carries `uploadType` ("single" | "batch") and a `files` array
 * (length 1 for singles) so automations can branch cleanly. `file` (the first
 * file) is retained for back-compat. Point Slack/Quo automations at
 * `files[].url` (Drive file or YouTube watch URL). A `submission` object
 * ({ id, url }) deep-links back into NoCodeUpload to the full submission.
 *
 * Best-effort and bounded by a timeout — a slow/broken webhook never blocks or
 * fails the upload.
 */
import "server-only";
import { createHmac } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isPubliclySafeHttpUrl } from "@/lib/url-safety";
import { fileCategory } from "@/lib/upload-validation";
import { resultUrlFor } from "@/lib/result-url";
import { submissionUrl } from "@/lib/submissions";
import type { StorageProvider } from "@/lib/db-types";
import type { NotifyResult } from "@/lib/notifications/types";

const TIMEOUT_MS = 10_000;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "webhook";
  }
}

const UPLOAD_COLUMNS =
  "upload_link_id, submission_id, provider_file_id, provider, original_filename, mime_type, file_size_bytes, uploader_name, uploader_email, uploader_message, custom_data, batch_id, batch_size, status, completed_at";

interface UploadShape {
  upload_link_id: string;
  submission_id: string | null;
  provider_file_id: string | null;
  provider: StorageProvider | null;
  original_filename: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  uploader_name: string | null;
  uploader_email: string | null;
  uploader_message: string | null;
  custom_data: Record<string, string> | null;
  batch_id: string | null;
  batch_size: number | null;
  status: string;
  completed_at: string | null;
}

interface LinkShape {
  id: string;
  name: string;
  slug: string;
  webhook_url: string | null;
  webhook_secret: string | null;
}

/** Per-file payload shape — shared by single and batch deliveries. */
function filePayload(u: UploadShape) {
  return {
    name: u.original_filename,
    mimeType: u.mime_type,
    // Coarse category for automation filters (e.g. Zapier "only videos").
    category: fileCategory(u.mime_type),
    sizeBytes: u.file_size_bytes,
    provider: u.provider ?? "google_drive",
    providerFileId: u.provider_file_id,
    // The canonical link to open the result — Drive file or YouTube watch URL.
    url: resultUrlFor(u.provider, u.provider_file_id),
    // Back-compat: Drive-only fields (null for YouTube).
    driveFileId: u.provider === "youtube" ? null : u.provider_file_id,
    driveUrl:
      u.provider !== "youtube" && u.provider_file_id
        ? `https://drive.google.com/file/d/${u.provider_file_id}/view`
        : null,
  };
}

/**
 * Submission deep-link — back into NoCodeUpload to see the full submission (every
 * file, every answer, and the links it produced). Null on legacy rows with no
 * submission_id.
 */
function submissionPayload(u: UploadShape) {
  return u.submission_id ? { id: u.submission_id, url: submissionUrl(u.submission_id) } : null;
}

async function loadLink(uploadLinkId: string): Promise<LinkShape | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("upload_links")
    .select("id, name, slug, webhook_url, webhook_secret")
    .eq("id", uploadLinkId)
    .maybeSingle();
  return (data ?? null) as LinkShape | null;
}

/** Sign + POST the payload to the link's webhook. Never throws; returns status. */
async function deliver(link: LinkShape, eventName: string, payload: unknown): Promise<NotifyResult> {
  if (!link.webhook_url) return { status: "skipped", detail: "no webhook configured" };
  const target = hostOf(link.webhook_url);
  // Defense in depth: never POST to an unsafe target even if one slipped past
  // the save-time check (e.g. a row predating this guard).
  if (!isPubliclySafeHttpUrl(link.webhook_url).safe) {
    return { status: "skipped", target, detail: "unsafe webhook URL" };
  }

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-NoCodeUpload-Event": eventName,
  };
  if (link.webhook_secret) {
    const sig = createHmac("sha256", link.webhook_secret).update(body).digest("hex");
    headers["X-NoCodeUpload-Signature"] = `sha256=${sig}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(link.webhook_url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      return { status: "failed", target, detail: `responded ${res.status}` };
    }
    return { status: "sent", target };
  } catch (err) {
    return { status: "failed", target, detail: err instanceof Error ? err.message : "delivery failed" };
  } finally {
    clearTimeout(timer);
  }
}

/** Single-file webhook — one completed upload. */
export async function sendUploadWebhook(uploadId: string): Promise<NotifyResult> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("uploads")
    .select(UPLOAD_COLUMNS)
    .eq("id", uploadId)
    .maybeSingle();
  const upload = (data ?? null) as UploadShape | null;
  if (!upload || upload.status !== "complete") return { status: "skipped", detail: "upload not complete" };

  const link = await loadLink(upload.upload_link_id);
  if (!link || !link.webhook_url) return { status: "skipped", detail: "no webhook configured" };

  const file = filePayload(upload);
  return deliver(link, "upload.completed", {
    event: "upload.completed",
    uploadType: "single",
    uploadId,
    link: { id: link.id, name: link.name, slug: link.slug },
    // Deep-link back into NoCodeUpload to see the full submission.
    submission: submissionPayload(upload),
    // Present even on per-file sends (bundling off) so automations can still
    // group files uploaded together by batch id.
    batch: upload.batch_id ? { id: upload.batch_id, fileCount: upload.batch_size } : null,
    file,
    files: [file],
    uploader: {
      name: upload.uploader_name,
      email: upload.uploader_email,
      message: upload.uploader_message,
    },
    // Owner-defined tags (prefilled/hidden custom fields) — the Airtable/Make
    // matching key, e.g. { "Cleaner Record ID": "rec123", "Phone": "555..." }.
    customData: upload.custom_data ?? {},
    uploadedAt: upload.completed_at ?? new Date().toISOString(),
  });
}

/**
 * Batch webhook — one POST summarizing every file uploaded together in a single
 * submission. uploadType "batch", with a `batch` object and the full `files`
 * array. No-ops if the link has no webhook or no files in the batch completed.
 */
export async function sendBatchUploadWebhook(batchId: string): Promise<NotifyResult> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("uploads")
    .select(UPLOAD_COLUMNS)
    .eq("batch_id", batchId)
    .eq("status", "complete")
    .order("completed_at", { ascending: true });
  const uploads = (data ?? []) as UploadShape[];
  if (uploads.length === 0) return { status: "skipped", detail: "no completed files in batch" };

  const rep = uploads[0];
  const link = await loadLink(rep.upload_link_id);
  if (!link || !link.webhook_url) return { status: "skipped", detail: "no webhook configured" };

  const files = uploads.map(filePayload);
  const uploadedAt =
    uploads.reduce<string | null>((latest, u) => {
      if (u.completed_at && (!latest || u.completed_at > latest)) return u.completed_at;
      return latest;
    }, null) ?? new Date().toISOString();

  return deliver(link, "batch.completed", {
    event: "batch.completed",
    uploadType: "batch",
    batch: { id: batchId, fileCount: files.length },
    link: { id: link.id, name: link.name, slug: link.slug },
    // Deep-link back into NoCodeUpload to see the full submission.
    submission: submissionPayload(rep),
    // Back-compat: `file` is the first file in the batch.
    file: files[0],
    files,
    uploader: {
      name: rep.uploader_name,
      email: rep.uploader_email,
      message: rep.uploader_message,
    },
    customData: rep.custom_data ?? {},
    uploadedAt,
  });
}
