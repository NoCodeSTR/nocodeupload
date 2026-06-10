/**
 * Quo (OpenPhone) SMS rendering + sending for upload/batch notifications.
 *
 * SMS is plain text. Without a custom template we send a short one-line summary
 * (with a "Details:" deep-link back to the submission); with a rule's
 * messageTemplate we render it (tokens: {name}, {message}, {link},
 * {submission}, {field:Label}, {count}, …) so owners can write their own copy
 * ("Hey Mike, new maintenance video: {link} …"). Returns a NotifyResult.
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { fileCategory } from "@/lib/upload-validation";
import { resultUrlFor } from "@/lib/result-url";
import { renderText } from "@/lib/filename";
import { submissionUrl } from "@/lib/submissions";
import { sendQuoMessage } from "@/lib/quo";
import type { NotifyResult } from "@/lib/notifications/types";
import type { StorageProvider } from "@/lib/db-types";

export interface QuoCreds {
  apiKey: string;
  from: string;
  to: string;
}

const SELECT =
  "provider, provider_file_id, original_filename, mime_type, uploader_name, uploader_email, uploader_message, custom_data, upload_link_id, submission_id";

interface Row {
  provider: StorageProvider | null;
  provider_file_id: string | null;
  original_filename: string;
  mime_type: string | null;
  uploader_name: string | null;
  uploader_email: string | null;
  uploader_message: string | null;
  custom_data: Record<string, string> | null;
  upload_link_id: string;
  submission_id: string | null;
}

async function linkName(uploadLinkId: string): Promise<string> {
  const admin = getSupabaseAdmin();
  const { data } = await admin.from("upload_links").select("name").eq("id", uploadLinkId).maybeSingle();
  return (data as { name: string } | null)?.name ?? "your upload link";
}

function renderMessage(template: string, u: Row, resultUrl: string | null, count: number): string {
  return renderText(template, {
    originalFilename: u.original_filename,
    uploaderName: u.uploader_name,
    uploaderEmail: u.uploader_email,
    uploaderMessage: u.uploader_message,
    customData: u.custom_data ?? {},
    resultUrl,
    submissionUrl: u.submission_id ? submissionUrl(u.submission_id) : null,
    count,
    date: new Date(),
  });
}

export async function sendQuoForUpload(
  creds: QuoCreds,
  uploadId: string,
  message?: string,
): Promise<NotifyResult> {
  const admin = getSupabaseAdmin();
  const { data } = await admin.from("uploads").select(SELECT).eq("id", uploadId).maybeSingle();
  const u = data as Row | null;
  if (!u) return { status: "skipped", target: creds.to, detail: "upload not found" };

  const url = resultUrlFor(u.provider, u.provider_file_id);
  const subUrl = u.submission_id ? submissionUrl(u.submission_id) : null;
  let content: string;
  if (message && message.trim()) {
    content = renderMessage(message, u, url, 1) || u.original_filename;
  } else {
    const name = await linkName(u.upload_link_id);
    const by = u.uploader_name ? ` from ${u.uploader_name}` : "";
    content =
      `New upload to ${name}: ${u.original_filename} (${fileCategory(u.mime_type)})${by}.` +
      (url ? ` ${url}` : "") +
      (subUrl ? ` Details: ${subUrl}` : "");
  }

  const res = await sendQuoMessage({ ...creds, content });
  return res.ok ? { status: "sent", target: creds.to } : { status: "failed", target: creds.to, detail: res.detail };
}

export async function sendQuoForBatch(
  creds: QuoCreds,
  batchId: string,
  message?: string,
): Promise<NotifyResult> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("uploads")
    .select(SELECT)
    .eq("batch_id", batchId)
    .eq("status", "complete");
  const uploads = (data ?? []) as Row[];
  if (uploads.length === 0) return { status: "skipped", target: creds.to, detail: "no completed files in batch" };

  const rep = uploads[0];
  const firstUrl = resultUrlFor(rep.provider, rep.provider_file_id);
  const subUrl = rep.submission_id ? submissionUrl(rep.submission_id) : null;
  let content: string;
  if (message && message.trim()) {
    content = renderMessage(message, rep, firstUrl, uploads.length) || `${uploads.length} files uploaded`;
  } else {
    const name = await linkName(rep.upload_link_id);
    const by = rep.uploader_name ? ` by ${rep.uploader_name}` : "";
    content =
      `${uploads.length} files uploaded to ${name}${by}.` +
      (subUrl ? ` Details: ${subUrl}` : firstUrl ? ` First: ${firstUrl}` : "");
  }

  const res = await sendQuoMessage({ ...creds, content });
  return res.ok ? { status: "sent", target: creds.to } : { status: "failed", target: creds.to, detail: res.detail };
}
