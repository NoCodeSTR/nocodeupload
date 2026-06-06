/**
 * Quo (OpenPhone) SMS rendering + sending for upload/batch notifications.
 *
 * SMS is plain text and should stay short, so we send a one-line summary with
 * the result link (Drive file / YouTube video). Returns a NotifyResult for the
 * dispatch layer to log.
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { fileCategory } from "@/lib/upload-validation";
import { resultUrlFor } from "@/lib/result-url";
import { sendQuoMessage } from "@/lib/quo";
import type { NotifyResult } from "@/lib/notifications/types";
import type { StorageProvider } from "@/lib/db-types";

export interface QuoCreds {
  apiKey: string;
  from: string;
  to: string;
}

const SELECT =
  "provider, provider_file_id, original_filename, mime_type, uploader_name, upload_link_id";

interface Row {
  provider: StorageProvider | null;
  provider_file_id: string | null;
  original_filename: string;
  mime_type: string | null;
  uploader_name: string | null;
  upload_link_id: string;
}

async function linkName(uploadLinkId: string): Promise<string> {
  const admin = getSupabaseAdmin();
  const { data } = await admin.from("upload_links").select("name").eq("id", uploadLinkId).maybeSingle();
  return (data as { name: string } | null)?.name ?? "your upload link";
}

export async function sendQuoForUpload(creds: QuoCreds, uploadId: string): Promise<NotifyResult> {
  const admin = getSupabaseAdmin();
  const { data } = await admin.from("uploads").select(SELECT).eq("id", uploadId).maybeSingle();
  const u = data as Row | null;
  if (!u) return { status: "skipped", target: creds.to, detail: "upload not found" };

  const name = await linkName(u.upload_link_id);
  const url = resultUrlFor(u.provider, u.provider_file_id);
  const by = u.uploader_name ? ` from ${u.uploader_name}` : "";
  const content =
    `New upload to ${name}: ${u.original_filename} (${fileCategory(u.mime_type)})${by}.` +
    (url ? ` ${url}` : "");

  const res = await sendQuoMessage({ ...creds, content });
  return res.ok ? { status: "sent", target: creds.to } : { status: "failed", target: creds.to, detail: res.detail };
}

export async function sendQuoForBatch(creds: QuoCreds, batchId: string): Promise<NotifyResult> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("uploads")
    .select(SELECT)
    .eq("batch_id", batchId)
    .eq("status", "complete");
  const uploads = (data ?? []) as Row[];
  if (uploads.length === 0) return { status: "skipped", target: creds.to, detail: "no completed files in batch" };

  const rep = uploads[0];
  const name = await linkName(rep.upload_link_id);
  const firstUrl = resultUrlFor(rep.provider, rep.provider_file_id);
  const by = rep.uploader_name ? ` by ${rep.uploader_name}` : "";
  const content =
    `${uploads.length} files uploaded to ${name}${by}.` +
    (firstUrl ? ` First: ${firstUrl}` : "");

  const res = await sendQuoMessage({ ...creds, content });
  return res.ok ? { status: "sent", target: creds.to } : { status: "failed", target: creds.to, detail: res.detail };
}
