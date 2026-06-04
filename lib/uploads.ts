/**
 * Server-side helpers for the uploads table.
 *
 * Anonymous visitors trigger these (no Supabase session), so they use the
 * service-role client — RLS has no INSERT policy for anon by design; all
 * upload-row writes flow through here.
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatPgError } from "@/lib/pg-error";
import type { UploadLinkRow, UploadRow } from "@/lib/db-types";

/**
 * Insert an 'uploading' row when a resumable session starts. Returns the
 * upload id (the capability token the browser uses to finalize).
 */
export async function createUploadRecord(args: {
  link: UploadLinkRow;
  filename: string;
  mimeType: string;
  size: number;
  uploaderName?: string | null;
  uploaderEmail?: string | null;
  uploaderMessage?: string | null;
  customData?: Record<string, string>;
  provider?: string | null;
  ipHash?: string | null;
}): Promise<string> {
  const admin = getSupabaseAdmin();
  const row = {
    upload_link_id: args.link.id,
    user_id: args.link.user_id,
    storage_connection_id: args.link.storage_connection_id,
    folder_id: args.link.folder_id,
    provider_file_id: null,
    original_filename: args.filename,
    mime_type: args.mimeType,
    file_size_bytes: args.size,
    uploader_name: args.uploaderName ?? null,
    uploader_email: args.uploaderEmail ?? null,
    uploader_message: args.uploaderMessage ?? null,
    uploader_ip_hash: args.ipHash ?? null,
    custom_data: args.customData ?? {},
    provider: args.provider ?? null,
    status: "uploading",
  };

  const { data, error } = await admin
    .from("uploads")
    .insert(row as never)
    .select("id")
    .single();

  if (error) {
    throw new Error(formatPgError("Failed to create upload record", error));
  }
  return (data as { id: string }).id;
}

/**
 * List uploads for a link, scoped to the owner (RLS: uploads owner can read).
 * Newest first. Used by the dashboard submissions view.
 */
export async function listUploadsForLink(args: {
  userId: string;
  linkId: string;
  limit?: number;
}): Promise<UploadRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("uploads")
    .select("*")
    .eq("upload_link_id", args.linkId)
    .eq("user_id", args.userId)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 200);

  if (error) {
    throw new Error(formatPgError("Failed to list uploads", error));
  }
  return (data ?? []) as UploadRow[];
}

/**
 * Mark an upload complete (providerFileId) or failed (errorMessage). Scoped
 * to a row currently in 'uploading' so a finalize can't flip an arbitrary row.
 */
export async function finalizeUpload(args: {
  uploadId: string;
  providerFileId?: string;
  errorMessage?: string;
}): Promise<{ ok: boolean }> {
  const admin = getSupabaseAdmin();

  const patch: Record<string, unknown> = args.providerFileId
    ? {
        status: "complete",
        provider_file_id: args.providerFileId,
        completed_at: new Date().toISOString(),
      }
    : {
        status: "failed",
        error_message: args.errorMessage?.slice(0, 500) ?? "Upload failed",
      };

  const { data, error } = await admin
    .from("uploads")
    .update(patch as never)
    .eq("id", args.uploadId)
    .eq("status", "uploading")
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(formatPgError("Failed to finalize upload", error));
  }
  return { ok: Boolean(data) };
}
