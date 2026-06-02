/**
 * Email notifications via Resend. Entirely optional: every function no-ops if
 * RESEND_API_KEY / RESEND_FROM_EMAIL aren't configured (features().emailNotifications).
 *
 * sendUploadNotification(uploadId) emails the link owner when a file lands,
 * branded with their company logo, including the uploader's details and an
 * open-in-Drive link.
 */
import "server-only";
import { Resend } from "resend";
import { coreEnv, features } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendUploadNotification(uploadId: string): Promise<void> {
  if (!features().emailNotifications) return;

  const env = coreEnv();
  const admin = getSupabaseAdmin();

  const { data: uploadData } = await admin
    .from("uploads")
    .select(
      "upload_link_id, provider_file_id, original_filename, mime_type, file_size_bytes, uploader_name, uploader_email, uploader_message, status",
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
      }
    | null;
  if (!upload || upload.status !== "complete") return;

  const { data: linkData } = await admin
    .from("upload_links")
    .select("name, user_id, branding_color, branding_logo_url")
    .eq("id", upload.upload_link_id)
    .maybeSingle();
  const link = linkData as
    | { name: string; user_id: string; branding_color: string | null; branding_logo_url: string | null }
    | null;
  if (!link) return;

  const { data: profileData } = await admin
    .from("profiles")
    .select("email, logo_url")
    .eq("id", link.user_id)
    .maybeSingle();
  const profile = profileData as { email: string | null; logo_url: string | null } | null;
  const to = profile?.email;
  if (!to) return;

  const accent = link.branding_color || "#2563eb";
  const logo = link.branding_logo_url || profile?.logo_url || null;
  const driveUrl = upload.provider_file_id
    ? `https://drive.google.com/file/d/${upload.provider_file_id}/view`
    : null;
  const appUrl = env.NEXT_PUBLIC_APP_URL;

  const rows: string[] = [];
  if (upload.uploader_name) rows.push(row("From", escapeHtml(upload.uploader_name)));
  if (upload.uploader_email) rows.push(row("Email", escapeHtml(upload.uploader_email)));
  if (upload.uploader_message) rows.push(row("Message", escapeHtml(upload.uploader_message)));
  rows.push(row("File", escapeHtml(upload.original_filename)));

  const html = `
  <div style="font-family:Inter,system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#18181b">
    ${logo ? `<div style="text-align:center;margin-bottom:16px"><img src="${logo}" alt="" style="max-height:48px;max-width:200px;object-fit:contain"/></div>` : ""}
    <h1 style="font-size:18px;margin:0 0 4px">New upload received</h1>
    <p style="color:#71717a;margin:0 0 20px">Someone just uploaded to <strong>${escapeHtml(link.name)}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${rows.join("")}</table>
    ${
      driveUrl
        ? `<div style="margin-top:24px"><a href="${driveUrl}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">Open in Google Drive</a></div>`
        : ""
    }
    <p style="margin-top:28px;color:#a1a1aa;font-size:12px">
      <a href="${appUrl}/dashboard" style="color:#a1a1aa">Manage your upload links</a> · NoCode Upload
    </p>
  </div>`;

  const resend = new Resend(env.RESEND_API_KEY!);
  await resend.emails.send({
    from: env.RESEND_FROM_EMAIL!,
    to,
    subject: `New upload: ${link.name}`,
    html,
    ...(upload.uploader_email ? { replyTo: upload.uploader_email } : {}),
  });
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 12px 6px 0;color:#71717a;vertical-align:top;white-space:nowrap">${label}</td>
    <td style="padding:6px 0;color:#18181b">${value}</td>
  </tr>`;
}
