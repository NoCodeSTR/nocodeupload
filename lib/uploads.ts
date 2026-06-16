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
import { findOrCreateSubmissionForUpload } from "@/lib/submissions";
import { getValidAccessToken } from "@/lib/tokens";
import { setFilePublicRead } from "@/lib/providers/google/drive";
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
  batchId?: string | null;
  batchSize?: number | null;
  // Per-box overrides (multi-box links): the destination + which box.
  storageConnectionId?: string | null;
  folderId?: string | null;
  sourceBlockId?: string | null;
  // Airtable record id this submission targets (two-way sync); null = create.
  airtableRecordId?: string | null;
  // Resolved record-source ids for this submission: { aliasKey: recordId }.
  sourceRecordIds?: Record<string, string> | null;
}): Promise<string> {
  const admin = getSupabaseAdmin();

  // Group this file under its submission (one per batch; one per single file).
  // Best-effort: a null id just means the file isn't linked yet (column nullable).
  const submissionId = await findOrCreateSubmissionForUpload({
    link: args.link,
    batchId: args.batchId ?? null,
    uploaderName: args.uploaderName ?? null,
    uploaderEmail: args.uploaderEmail ?? null,
    uploaderMessage: args.uploaderMessage ?? null,
    customData: args.customData ?? {},
  });

  const row = {
    upload_link_id: args.link.id,
    user_id: args.link.user_id,
    storage_connection_id: args.storageConnectionId ?? args.link.storage_connection_id,
    folder_id: args.folderId ?? args.link.folder_id,
    source_block_id: args.sourceBlockId ?? null,
    airtable_record_id: args.airtableRecordId ?? null,
    source_record_ids: args.sourceRecordIds ?? {},
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
    batch_id: args.batchId ?? null,
    batch_size: args.batchSize ?? null,
    submission_id: submissionId,
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
 *
 * On a successful complete, if the link opts into public files, grant the Drive
 * file "anyone with the link can view" so notification links open for external
 * recipients (best-effort — never blocks completion).
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
    .select("id, user_id, upload_link_id, storage_connection_id, provider, provider_file_id")
    .maybeSingle();

  if (error) {
    throw new Error(formatPgError("Failed to finalize upload", error));
  }
  const row = data as {
    id: string;
    user_id: string;
    upload_link_id: string;
    storage_connection_id: string | null;
    provider: string | null;
    provider_file_id: string | null;
  } | null;

  if (row && args.providerFileId) {
    await maybeShareDriveFile(row);
  }
  return { ok: Boolean(row) };
}

/**
 * Best-effort: when the upload's link has public_files on, grant the completed
 * Drive file an "anyone with the link can view" permission (kept, not revoked).
 * Drive only — YouTube uploads are already unlisted. Never throws.
 */
async function maybeShareDriveFile(row: {
  user_id: string;
  upload_link_id: string;
  storage_connection_id: string | null;
  provider: string | null;
  provider_file_id: string | null;
}): Promise<void> {
  try {
    if (row.provider !== "google_drive" || !row.provider_file_id || !row.storage_connection_id) {
      return;
    }
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from("upload_links")
      .select("public_files")
      .eq("id", row.upload_link_id)
      .maybeSingle();
    if (!(data as { public_files: boolean } | null)?.public_files) return;

    const { accessToken } = await getValidAccessToken({
      userId: row.user_id,
      connectionId: row.storage_connection_id,
    });
    await setFilePublicRead({ accessToken, fileId: row.provider_file_id });
  } catch (err) {
    // Sharing is best-effort: a failure must not fail the upload completion.
    // eslint-disable-next-line no-console
    console.warn("[finalizeUpload] public share failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Progress snapshot for a batch — how many of the declared files have reached a
 * terminal state. Used to decide when a bundled notification can fire.
 */
export async function getBatchProgress(batchId: string): Promise<{
  declaredSize: number | null;
  total: number;
  terminal: number;
  uploading: number;
}> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("uploads")
    .select("status, batch_size")
    .eq("batch_id", batchId);
  if (error) {
    throw new Error(formatPgError("Failed to read batch progress", error));
  }
  const rows = (data ?? []) as Array<{ status: string; batch_size: number | null }>;
  let terminal = 0;
  let uploading = 0;
  let declaredSize: number | null = null;
  for (const r of rows) {
    if (r.batch_size != null) declaredSize = r.batch_size;
    if (r.status === "uploading") uploading += 1;
    else terminal += 1;
  }
  return { declaredSize, total: rows.length, terminal, uploading };
}

/**
 * Atomically claim the right to send a batch's bundled notification. Sets
 * batch_notified_at on every row of the batch, but only where it's still null —
 * so the first caller wins (gets rows back) and any concurrent caller gets none.
 * Returns true only for the winner.
 */
export async function claimBatchNotification(batchId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("uploads")
    .update({ batch_notified_at: new Date().toISOString() } as never)
    .eq("batch_id", batchId)
    .is("batch_notified_at", null)
    .select("id");
  if (error) {
    throw new Error(formatPgError("Failed to claim batch notification", error));
  }
  return (data?.length ?? 0) > 0;
}
