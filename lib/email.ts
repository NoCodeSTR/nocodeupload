/**
 * Email notifications via Resend.
 *
 * Structure (Notifications v2): rendering is separated from sending so the same
 * branded email can go to the link owner (default) OR to an arbitrary address
 * (a routing-rule destination). Every send returns a NotifyResult so the
 * dispatch layer can log it — a missing RESEND_API_KEY / RESEND_FROM_EMAIL now
 * surfaces as a visible "skipped: email not configured" instead of a silent
 * no-op.
 */
import "server-only";
import { Resend } from "resend";
import { coreEnv, features } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { fileCategory } from "@/lib/upload-validation";
import { resultUrlFor, resultUrlLabel } from "@/lib/result-url";
import type { NotifyResult } from "@/lib/notifications/types";
import type { StorageProvider } from "@/lib/db-types";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 12px 6px 0;color:#71717a;vertical-align:top;white-space:nowrap">${label}</td>
    <td style="padding:6px 0;color:#18181b">${value}</td>
  </tr>`;
}

interface UploadEmailRow {
  upload_link_id: string;
  provider: StorageProvider | null;
  provider_file_id: string | null;
  original_filename: string;
  mime_type: string | null;
  uploader_name: string | null;
  uploader_email: string | null;
  uploader_message: string | null;
  custom_data: Record<string, string> | null;
}

interface LinkEmailRow {
  name: string;
  user_id: string;
  branding_color: string | null;
  branding_logo_url: string | null;
  notify_email: boolean;
}

interface EmailContent {
  subject: string;
  html: string;
  replyTo: string | null;
}

const UPLOAD_SELECT =
  "upload_link_id, provider, provider_file_id, original_filename, mime_type, uploader_name, uploader_email, uploader_message, custom_data";

// --- Low-level send ----------------------------------------------------------

/** Send pre-rendered content to one address. Returns a loggable status. */
async function sendEmail(to: string, content: EmailContent): Promise<NotifyResult> {
  if (!features().emailNotifications) {
    return {
      status: "skipped",
      target: to,
      detail: "Email not configured (set RESEND_API_KEY and RESEND_FROM_EMAIL)",
    };
  }
  const env = coreEnv();
  try {
    const resend = new Resend(env.RESEND_API_KEY!);
    const res = await resend.emails.send({
      from: env.RESEND_FROM_EMAIL!,
      to,
      subject: content.subject,
      html: content.html,
      ...(content.replyTo ? { replyTo: content.replyTo } : {}),
    });
    if (res.error) {
      return { status: "failed", target: to, detail: res.error.message };
    }
    return { status: "sent", target: to };
  } catch (err) {
    return { status: "failed", target: to, detail: err instanceof Error ? err.message : "send failed" };
  }
}

// --- Loaders -----------------------------------------------------------------

async function loadLink(uploadLinkId: string): Promise<{ link: LinkEmailRow; logo: string | null; ownerEmail: string | null } | null> {
  const admin = getSupabaseAdmin();
  const { data: linkData } = await admin
    .from("upload_links")
    .select("name, user_id, branding_color, branding_logo_url, notify_email")
    .eq("id", uploadLinkId)
    .maybeSingle();
  const link = linkData as LinkEmailRow | null;
  if (!link) return null;

  const { data: profileData } = await admin
    .from("profiles")
    .select("email, logo_url")
    .eq("id", link.user_id)
    .maybeSingle();
  const profile = profileData as { email: string | null; logo_url: string | null } | null;

  return {
    link,
    logo: link.branding_logo_url || profile?.logo_url || null,
    ownerEmail: profile?.email ?? null,
  };
}

// --- Renderers ---------------------------------------------------------------

function renderSingle(upload: UploadEmailRow, link: LinkEmailRow, logo: string | null): EmailContent {
  const accent = link.branding_color || "#2563eb";
  const appUrl = coreEnv().NEXT_PUBLIC_APP_URL;
  const resultUrl = resultUrlFor(upload.provider, upload.provider_file_id);
  const resultLabel = resultUrlLabel(upload.provider);

  const rows: string[] = [];
  if (upload.uploader_name) rows.push(row("From", escapeHtml(upload.uploader_name)));
  if (upload.uploader_email) rows.push(row("Email", escapeHtml(upload.uploader_email)));
  if (upload.uploader_message) rows.push(row("Message", escapeHtml(upload.uploader_message)));
  for (const [label, value] of Object.entries(upload.custom_data ?? {})) {
    if (value) rows.push(row(escapeHtml(label), escapeHtml(String(value))));
  }
  rows.push(row("File", escapeHtml(upload.original_filename)));
  rows.push(row("Type", fileCategory(upload.mime_type)));

  const html = `
  <div style="font-family:Inter,system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#18181b">
    ${logo ? `<div style="text-align:center;margin-bottom:16px"><img src="${logo}" alt="" style="max-height:48px;max-width:200px;object-fit:contain"/></div>` : ""}
    <h1 style="font-size:18px;margin:0 0 4px">New upload received</h1>
    <p style="color:#71717a;margin:0 0 20px">Someone just uploaded to <strong>${escapeHtml(link.name)}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${rows.join("")}</table>
    ${
      resultUrl
        ? `<div style="margin-top:24px"><a href="${resultUrl}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">${resultLabel}</a></div>`
        : ""
    }
    <p style="margin-top:28px;color:#a1a1aa;font-size:12px">
      <a href="${appUrl}/dashboard" style="color:#a1a1aa">Manage your upload links</a>
    </p>
    <p style="margin-top:6px;color:#a1a1aa;font-size:12px">
      Powered by <a href="https://nocodeupload.com/?ref=email" style="color:#71717a;font-weight:600;text-decoration:none">NoCodeUpload.com</a>
    </p>
  </div>`;

  return { subject: `New upload: ${link.name}`, html, replyTo: upload.uploader_email };
}

function renderBatch(uploads: UploadEmailRow[], link: LinkEmailRow, logo: string | null): EmailContent {
  const accent = link.branding_color || "#2563eb";
  const appUrl = coreEnv().NEXT_PUBLIC_APP_URL;
  const count = uploads.length;
  const rep = uploads[0];

  const metaRows: string[] = [];
  if (rep.uploader_name) metaRows.push(row("From", escapeHtml(rep.uploader_name)));
  if (rep.uploader_email) metaRows.push(row("Email", escapeHtml(rep.uploader_email)));
  if (rep.uploader_message) metaRows.push(row("Message", escapeHtml(rep.uploader_message)));
  for (const [label, value] of Object.entries(rep.custom_data ?? {})) {
    if (value) metaRows.push(row(escapeHtml(label), escapeHtml(String(value))));
  }

  const fileRows = uploads
    .map((u) => {
      const url = resultUrlFor(u.provider, u.provider_file_id);
      const label = resultUrlLabel(u.provider);
      const anchor = url
        ? `<a href="${url}" style="color:${accent};text-decoration:none;font-weight:600">${label}</a>`
        : "";
      return `<tr>
        <td style="padding:8px 12px 8px 0;color:#18181b;border-top:1px solid #f4f4f5">${escapeHtml(u.original_filename)}</td>
        <td style="padding:8px 12px 8px 0;color:#71717a;border-top:1px solid #f4f4f5;white-space:nowrap">${fileCategory(u.mime_type)}</td>
        <td style="padding:8px 0;border-top:1px solid #f4f4f5;text-align:right;white-space:nowrap">${anchor}</td>
      </tr>`;
    })
    .join("");

  const html = `
  <div style="font-family:Inter,system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18181b">
    ${logo ? `<div style="text-align:center;margin-bottom:16px"><img src="${logo}" alt="" style="max-height:48px;max-width:200px;object-fit:contain"/></div>` : ""}
    <h1 style="font-size:18px;margin:0 0 4px">${count} files received</h1>
    <p style="color:#71717a;margin:0 0 20px">Someone uploaded ${count} files to <strong>${escapeHtml(link.name)}</strong> in one go.</p>
    ${metaRows.length ? `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">${metaRows.join("")}</table>` : ""}
    <table style="width:100%;border-collapse:collapse;font-size:14px">${fileRows}</table>
    <p style="margin-top:28px;color:#a1a1aa;font-size:12px">
      <a href="${appUrl}/dashboard" style="color:#a1a1aa">Manage your upload links</a>
    </p>
    <p style="margin-top:6px;color:#a1a1aa;font-size:12px">
      Powered by <a href="https://nocodeupload.com/?ref=email" style="color:#71717a;font-weight:600;text-decoration:none">NoCodeUpload.com</a>
    </p>
  </div>`;

  return { subject: `New upload: ${link.name} (${count} files)`, html, replyTo: rep.uploader_email };
}

// --- Content builders (load + render) ---------------------------------------

async function buildUploadContent(uploadId: string): Promise<
  { content: EmailContent; link: LinkEmailRow; ownerEmail: string | null } | null
> {
  const admin = getSupabaseAdmin();
  const { data } = await admin.from("uploads").select(UPLOAD_SELECT).eq("id", uploadId).maybeSingle();
  const upload = data as UploadEmailRow | null;
  if (!upload) return null;
  const linkInfo = await loadLink(upload.upload_link_id);
  if (!linkInfo) return null;
  return {
    content: renderSingle(upload, linkInfo.link, linkInfo.logo),
    link: linkInfo.link,
    ownerEmail: linkInfo.ownerEmail,
  };
}

async function buildBatchContent(batchId: string): Promise<
  { content: EmailContent; link: LinkEmailRow; ownerEmail: string | null } | null
> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("uploads")
    .select(UPLOAD_SELECT + ", completed_at")
    .eq("batch_id", batchId)
    .eq("status", "complete")
    .order("completed_at", { ascending: true });
  const uploads = (data ?? []) as UploadEmailRow[];
  if (uploads.length === 0) return null;
  const linkInfo = await loadLink(uploads[0].upload_link_id);
  if (!linkInfo) return null;
  return {
    content: renderBatch(uploads, linkInfo.link, linkInfo.logo),
    link: linkInfo.link,
    ownerEmail: linkInfo.ownerEmail,
  };
}

// --- Public senders ----------------------------------------------------------

/** Default owner notification for a single upload (respects notify_email). */
export async function sendUploadNotification(uploadId: string): Promise<NotifyResult> {
  const built = await buildUploadContent(uploadId);
  if (!built) return { status: "skipped", detail: "upload or link not found" };
  if (built.link.notify_email === false) return { status: "skipped", target: "owner", detail: "email disabled for this link" };
  if (!built.ownerEmail) return { status: "skipped", detail: "owner has no email on file" };
  return sendEmail(built.ownerEmail, built.content);
}

/** Default owner notification for a batch (respects notify_email). */
export async function sendBatchUploadNotification(batchId: string): Promise<NotifyResult> {
  const built = await buildBatchContent(batchId);
  if (!built) return { status: "skipped", detail: "no completed files in batch" };
  if (built.link.notify_email === false) return { status: "skipped", target: "owner", detail: "email disabled for this link" };
  if (!built.ownerEmail) return { status: "skipped", detail: "owner has no email on file" };
  return sendEmail(built.ownerEmail, built.content);
}

/** Rule destination: send a single-upload email to an explicit address. */
export async function sendUploadEmailTo(to: string, uploadId: string): Promise<NotifyResult> {
  const built = await buildUploadContent(uploadId);
  if (!built) return { status: "skipped", target: to, detail: "upload or link not found" };
  return sendEmail(to, built.content);
}

/** Rule destination: send a batch email to an explicit address. */
export async function sendBatchEmailTo(to: string, batchId: string): Promise<NotifyResult> {
  const built = await buildBatchContent(batchId);
  if (!built) return { status: "skipped", target: to, detail: "no completed files in batch" };
  return sendEmail(to, built.content);
}
