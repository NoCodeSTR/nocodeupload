/**
 * Slack message rendering + sending for upload/batch notifications.
 *
 * Builds a compact Block Kit message (header + uploader/field context + file
 * links) and POSTs it to the destination's incoming webhook. Returns a
 * NotifyResult so the dispatch layer can log it.
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { fileCategory } from "@/lib/upload-validation";
import { resultUrlFor, resultUrlLabel } from "@/lib/result-url";
import { renderText } from "@/lib/filename";
import { postSlackWebhook } from "@/lib/slack";
import type { NotifyResult } from "@/lib/notifications/types";
import type { StorageProvider } from "@/lib/db-types";

const SELECT =
  "provider, provider_file_id, original_filename, mime_type, uploader_name, uploader_email, uploader_message, custom_data, upload_link_id";

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
}

/** Slack mrkdwn requires escaping these three characters in text content. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function linkName(uploadLinkId: string): Promise<string> {
  const admin = getSupabaseAdmin();
  const { data } = await admin.from("upload_links").select("name").eq("id", uploadLinkId).maybeSingle();
  return (data as { name: string } | null)?.name ?? "your upload link";
}

function contextFields(rep: Row): { type: "mrkdwn"; text: string }[] {
  const fields: { type: "mrkdwn"; text: string }[] = [];
  if (rep.uploader_name) fields.push({ type: "mrkdwn", text: `*From:*\n${esc(rep.uploader_name)}` });
  if (rep.uploader_email) fields.push({ type: "mrkdwn", text: `*Email:*\n${esc(rep.uploader_email)}` });
  for (const [label, value] of Object.entries(rep.custom_data ?? {})) {
    if (value && fields.length < 10) fields.push({ type: "mrkdwn", text: `*${esc(label)}:*\n${esc(String(value))}` });
  }
  return fields;
}

async function send(webhookUrl: string, text: string, blocks: unknown[]): Promise<NotifyResult> {
  const res = await postSlackWebhook(webhookUrl, { text, blocks });
  return res.ok ? { status: "sent" } : { status: "failed", detail: res.detail };
}

function renderMessage(template: string, u: Row, resultUrl: string | null, count: number): string {
  return renderText(template, {
    originalFilename: u.original_filename,
    uploaderName: u.uploader_name,
    uploaderEmail: u.uploader_email,
    uploaderMessage: u.uploader_message,
    customData: u.custom_data ?? {},
    resultUrl,
    count,
    date: new Date(),
  });
}

export async function sendSlackForUpload(
  webhookUrl: string,
  uploadId: string,
  message?: string,
): Promise<NotifyResult> {
  const admin = getSupabaseAdmin();
  const { data } = await admin.from("uploads").select(SELECT).eq("id", uploadId).maybeSingle();
  const u = data as Row | null;
  if (!u) return { status: "skipped", detail: "upload not found" };

  const name = await linkName(u.upload_link_id);
  const url = resultUrlFor(u.provider, u.provider_file_id);
  const label = resultUrlLabel(u.provider);

  // Custom message (rule template) → render as the lead section; otherwise the
  // standard file/context layout. The Open button is kept either way.
  const blocks: unknown[] = [];
  if (message && message.trim()) {
    const rendered = renderMessage(message, u, url, 1).trim();
    if (rendered) blocks.push({ type: "section", text: { type: "mrkdwn", text: esc(rendered) } });
  } else {
    blocks.push({ type: "header", text: { type: "plain_text", text: `New upload: ${name}`.slice(0, 150) } });
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*${esc(u.original_filename)}*  _(${fileCategory(u.mime_type)})_` } });
    const fields = contextFields(u);
    if (fields.length) blocks.push({ type: "section", fields });
    if (u.uploader_message) blocks.push({ type: "section", text: { type: "mrkdwn", text: `> ${esc(u.uploader_message)}` } });
  }
  if (url) blocks.push({ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: label }, url }] });

  return send(webhookUrl, `New upload: ${name}`, blocks);
}

export async function sendSlackForBatch(
  webhookUrl: string,
  batchId: string,
  message?: string,
): Promise<NotifyResult> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("uploads")
    .select(SELECT + ", completed_at")
    .eq("batch_id", batchId)
    .eq("status", "complete")
    .order("completed_at", { ascending: true });
  const uploads = (data ?? []) as Row[];
  if (uploads.length === 0) return { status: "skipped", detail: "no completed files in batch" };

  const rep = uploads[0];
  const name = await linkName(rep.upload_link_id);

  // Up to 20 files as bulleted mrkdwn links to keep the message tidy.
  const fileLines = uploads.slice(0, 20).map((u) => {
    const url = resultUrlFor(u.provider, u.provider_file_id);
    const fn = esc(u.original_filename);
    return url ? `• <${url}|${fn}>` : `• ${fn}`;
  });
  if (uploads.length > 20) fileLines.push(`…and ${uploads.length - 20} more`);

  const blocks: unknown[] = [];
  if (message && message.trim()) {
    const firstUrl = resultUrlFor(rep.provider, rep.provider_file_id);
    const rendered = renderMessage(message, rep, firstUrl, uploads.length).trim();
    if (rendered) blocks.push({ type: "section", text: { type: "mrkdwn", text: esc(rendered) } });
  } else {
    blocks.push({ type: "header", text: { type: "plain_text", text: `${uploads.length} files: ${name}`.slice(0, 150) } });
    const fields = contextFields(rep);
    if (fields.length) blocks.push({ type: "section", fields });
    if (rep.uploader_message) blocks.push({ type: "section", text: { type: "mrkdwn", text: `> ${esc(rep.uploader_message)}` } });
  }
  blocks.push({ type: "section", text: { type: "mrkdwn", text: fileLines.join("\n") } });

  return send(webhookUrl, `${uploads.length} files uploaded to ${name}`, blocks);
}
