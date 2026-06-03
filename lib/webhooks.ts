/**
 * Best-effort signed webhook delivery for completed uploads.
 *
 * Webhooks are intentionally isolated from the upload response path: failures,
 * slow receivers, or bad URLs are logged but never change the completed upload.
 */
import "server-only";
import { createHmac } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const WEBHOOK_TIMEOUT_MS = 5000;

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

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
  if (!upload || upload.status !== "complete" || !upload.provider_file_id) return;

  const { data: linkData } = await admin
    .from("upload_links")
    .select("id, name, slug, webhook_url, webhook_secret")
    .eq("id", upload.upload_link_id)
    .maybeSingle();

  const link = linkData as
    | {
        id: string;
        name: string;
        slug: string;
        webhook_url: string | null;
        webhook_secret: string | null;
      }
    | null;
  if (!link?.webhook_url || !link.webhook_secret) return;

  const payload = {
    event: "upload.completed",
    link: {
      id: link.id,
      name: link.name,
      slug: link.slug,
    },
    file: {
      name: upload.original_filename,
      mimeType: upload.mime_type,
      sizeBytes: upload.file_size_bytes,
      driveFileId: upload.provider_file_id,
      driveUrl: `https://drive.google.com/file/d/${upload.provider_file_id}/view`,
    },
    uploader: {
      name: upload.uploader_name,
      email: upload.uploader_email,
      message: upload.uploader_message,
    },
    uploadedAt: upload.completed_at ?? new Date().toISOString(),
  };

  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", link.webhook_secret).update(body).digest("hex");

  try {
    const res = await fetch(link.webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "NoCodeUpload-Webhooks/1.0",
        "X-NoCodeUpload-Event": "upload.completed",
        "X-NoCodeUpload-Signature": `sha256=${signature}`,
      },
      body,
      signal: timeoutSignal(WEBHOOK_TIMEOUT_MS),
    });

    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn("[webhook] receiver returned non-2xx:", res.status, link.webhook_url);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[webhook] delivery failed:", err);
  }
}
