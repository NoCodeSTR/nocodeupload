/**
 * Form-only submissions (no file upload).
 *
 * A form submission is stored as a submissions row (submission_type 'form')
 * PLUS one file-less "carrier" upload row (status complete, source_block_id
 * '__form'). The carrier lets the existing, well-tested pipeline — notification
 * dispatch, Airtable record creation, email rendering — fire unchanged for a
 * submission that has no files. The inbox hides carriers from file counts and
 * the files list.
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { UploadLinkRow } from "@/lib/db-types";

/** Marker on the carrier upload so the inbox can exclude it from real files. */
export const FORM_CARRIER_BLOCK = "__form";

export async function createFormSubmission(args: {
  link: UploadLinkRow;
  uploaderName: string | null;
  uploaderEmail: string | null;
  uploaderMessage: string | null;
  customData: Record<string, string>;
  ipHash?: string | null;
  airtableRecordId?: string | null;
}): Promise<{ submissionId: string | null; carrierUploadId: string }> {
  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { data: subData } = await admin
    .from("submissions")
    .insert({
      upload_link_id: args.link.id,
      user_id: args.link.user_id,
      batch_id: null,
      submission_type: "form",
      uploader_name: args.uploaderName,
      uploader_email: args.uploaderEmail,
      uploader_message: args.uploaderMessage,
      custom_data: args.customData,
      status: "new",
      completed_at: now,
    } as never)
    .select("id")
    .single();
  const submissionId = (subData as { id: string } | null)?.id ?? null;

  // File-less carrier: a 'complete' upload with no provider file. Drives the
  // existing notification + Airtable pipeline for a no-file submission.
  const { data: upData, error: upErr } = await admin
    .from("uploads")
    .insert({
      upload_link_id: args.link.id,
      user_id: args.link.user_id,
      storage_connection_id: null,
      folder_id: null,
      provider_file_id: null,
      original_filename: "Form submission",
      mime_type: null,
      file_size_bytes: null,
      uploader_name: args.uploaderName,
      uploader_email: args.uploaderEmail,
      uploader_message: args.uploaderMessage,
      uploader_ip_hash: args.ipHash ?? null,
      custom_data: args.customData,
      provider: null,
      batch_id: null,
      batch_size: null,
      submission_id: submissionId,
      source_block_id: FORM_CARRIER_BLOCK,
      airtable_record_id: args.airtableRecordId ?? null,
      status: "complete",
      completed_at: now,
    } as never)
    .select("id")
    .single();

  if (upErr || !upData) {
    throw new Error("Failed to create form submission");
  }
  return { submissionId, carrierUploadId: (upData as { id: string }).id };
}
