/**
 * Per-link webhook delivery (Zapier / Make / custom endpoints).
 *
 * On a completed upload, if the link has a webhook_url, POST a JSON payload
 * signed with the link's webhook_secret (HMAC-SHA256). Recipients verify by
 * recomputing the signature over the raw body.
 *
 *   Headers:
 *     Content-Type: application/json
 *     X-NoCodeUpload-Event: upload.completed
 *     X-NoCodeUpload-Signature: sha256=<hex>
 *
 * Best-effort and bounded by a timeout — a slow/broken webhook never blocks or
 * fails the upload.
 */
import "server-only";
import { createHmac } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isPubliclySafeHttpUrl } from "@/lib/url-safety";

const TIMEOUT_MS = 10_000;

export async function sendUploadWebhook(uploadId: string): Promise<void> {
  const admin = getSupabaseAdmin();

  const { data: uploadData } = await admin
    .from("uploads")
    .select(
      "upload_link_id, provider_file_id, original_filename, mime_type, file_size_bytes, uploader_name, uploader_email, uploader_message, status, completed_at",
    )
    .eq("id", uploadId)
    .maybeSingle();
  const upload = uploadData as
    | {
        upload_link_id: string;
        provider_file_id: string | null;
        original_filename: string;
        mime_type: string | null;
        file_size_bytes: number | null;
        uploader_name: string | null;
        uploader_email: string | null;
        uploader_message: string | null;
        status: string;
        completed_at: string | null;
      }
    | null;
  if (!upload || upload.status !== "complete") return;

  const { data: linkData } = await admin
    .from("upload_links")
    .select("id, name, slug, webhook_url, webhook_secret")
    .eq("id", upload.upload_link_id)
    .maybeSingle();
  const link = linkData as
    | { id: string; name: string; slug: string; webhook_url: string | null; webhook_secret: string | null }
    | null;
  if (!link || !link.webhook_url) return;

  // Defense in depth: never POST to an unsafe target even if one slipped past
  // the save-time check (e.g. a row predating this guard).
  if (!isPubliclySafeHttpUrl(link.webhook_url).safe) {
    // eslint-disable-next-line no-console
    console.warn("[webhook] skipping unsafe webhook URL");
    return;
  }

  const payload = {
    event: "upload.completed",
    uploadId,
    link: { id: link.id, name: link.name, slug: link.slug },
    file: {
      name: upload.original_filename,
      mimeType: upload.mime_type,
      sizeBytes: upload.file_size_bytes,
      driveFileId: upload.provider_file_id,
      driveUrl: upload.provider_file_id
        ? `https://drive.google.com/file/d/${upload.provider_file_id}/view`
        : null,
    },
    uploader: {
      name: upload.uploader_name,
      email: upload.uploader_email,
      message: upload.uploader_message,
    },
    uploadedAt: upload.completed_at ?? new Date().toISOString(),
  };

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-NoCodeUpload-Event": "upload.completed",
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
      // eslint-disable-next-line no-console
      console.warn(`[webhook] ${link.webhook_url} responded ${res.status}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[webhook] delivery failed:", err instanceof Error ? err.message : err);
  } finally {
    clearTimeout(timer);
  }
}
