/**
 * Server-side helpers for the submissions table — the first-class "submission"
 * object (form answers + uploader context + 0..N files).
 *
 * A submission is created/looked-up when an upload starts (see uploads.ts), so
 * every file is grouped under the submit it belongs to. Batched multi-file
 * uploads share ONE submission (deduped by batch_id). The owner-facing reads
 * (inbox) come in Checkpoint 2; this file currently covers creation + the read
 * primitives the pipeline needs.
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { UploadLinkRow } from "@/lib/db-types";

/**
 * Find-or-create the submission an incoming upload belongs to.
 *
 * - Batched (batchId set): one submission per batch — first file creates it, the
 *   rest attach (deduped by the unique batch_id). Concurrent initiates are safe
 *   thanks to the unique constraint + ignoreDuplicates.
 * - Single (no batchId): a fresh submission per file.
 *
 * Best-effort: returns null on any failure so the upload still proceeds
 * (uploads.submission_id is nullable).
 */
export async function findOrCreateSubmissionForUpload(args: {
  link: UploadLinkRow;
  batchId: string | null;
  uploaderName: string | null;
  uploaderEmail: string | null;
  uploaderMessage: string | null;
  customData: Record<string, string>;
}): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const base = {
    upload_link_id: args.link.id,
    user_id: args.link.user_id,
    submission_type: "upload" as const,
    uploader_name: args.uploaderName,
    uploader_email: args.uploaderEmail,
    uploader_message: args.uploaderMessage,
    custom_data: args.customData,
  };

  try {
    if (args.batchId) {
      // First file wins; concurrent inserts collapse onto the unique batch_id.
      await admin
        .from("submissions")
        .upsert({ ...base, batch_id: args.batchId } as never, {
          onConflict: "batch_id",
          ignoreDuplicates: true,
        });
      const { data } = await admin
        .from("submissions")
        .select("id")
        .eq("batch_id", args.batchId)
        .maybeSingle();
      return (data as { id: string } | null)?.id ?? null;
    }

    const { data } = await admin
      .from("submissions")
      .insert(base as never)
      .select("id")
      .single();
    return (data as { id: string } | null)?.id ?? null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[submissions] find-or-create failed (upload proceeds):", err);
    return null;
  }
}
