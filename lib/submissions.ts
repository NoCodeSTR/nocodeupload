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
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatPgError } from "@/lib/pg-error";
import { coreEnv } from "@/lib/env";
import type {
  UploadLinkRow,
  SubmissionRow,
  StorageProvider,
  NotificationDeliveryRow,
} from "@/lib/db-types";
import type { SubmissionUpdateInput } from "@/lib/schemas";

/**
 * Canonical owner-facing URL for a submission's detail page in the dashboard.
 * Used by the {submission} notification token and the notification deep-links
 * (email/Slack/Quo/webhook) so recipients can jump back into NoCodeUpload to see
 * the full submission — every file, every answer, and the links it produced.
 */
export function submissionUrl(id: string): string {
  const base = coreEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  return `${base}/dashboard/submissions/${id}`;
}

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

// --- Owner-facing reads (the inbox) ------------------------------------------

export interface SubmissionListItem {
  id: string;
  uploadLinkId: string;
  linkName: string;
  status: SubmissionRow["status"];
  submissionType: SubmissionRow["submission_type"];
  uploaderName: string | null;
  uploaderEmail: string | null;
  uploaderMessage: string | null;
  customData: Record<string, string> | null;
  fileCount: number;
  createdAt: string;
}

export interface SubmissionFileItem {
  id: string;
  originalFilename: string;
  mimeType: string | null;
  fileSizeBytes: number | null;
  status: "uploading" | "complete" | "failed";
  provider: StorageProvider | null;
  providerFileId: string | null;
  createdAt: string;
}

export interface SubmissionDetail {
  submission: SubmissionRow;
  linkName: string;
  files: SubmissionFileItem[];
  deliveries: NotificationDeliveryRow[];
}

/** Sanitize a search term for a PostgREST or() filter (strip its delimiters). */
function safeSearch(s: string): string {
  return s.replace(/[%,()]/g, "").trim();
}

/**
 * List the user's submissions across all links (newest first), with file counts
 * and the link name. Optional filters: a single link, a project, or a search
 * over uploader name / email / message.
 */
export async function listSubmissions(
  userId: string,
  opts: { linkId?: string; projectId?: string; search?: string; limit?: number } = {},
): Promise<SubmissionListItem[]> {
  const supabase = createSupabaseServerClient();
  let q = supabase
    .from("submissions")
    .select("*, upload_links!inner(name, project_id)")
    .eq("user_id", userId);

  if (opts.linkId) q = q.eq("upload_link_id", opts.linkId);
  if (opts.projectId) q = q.eq("upload_links.project_id", opts.projectId);
  const s = safeSearch(opts.search ?? "");
  if (s) {
    q = q.or(`uploader_name.ilike.%${s}%,uploader_email.ilike.%${s}%,uploader_message.ilike.%${s}%`);
  }
  q = q.order("created_at", { ascending: false }).limit(opts.limit ?? 200);

  const { data, error } = await q;
  if (error) throw new Error(formatPgError("Failed to list submissions", error));

  const rows = (data ?? []) as unknown as Array<
    SubmissionRow & {
      upload_links: { name: string; project_id: string | null } | { name: string; project_id: string | null }[] | null;
    }
  >;
  if (rows.length === 0) return [];

  // File counts in one query (avoid N+1). Exclude form-only "carrier" rows
  // (source_block_id '__form'), which exist only to drive the pipeline.
  const ids = rows.map((r) => r.id);
  const counts = new Map<string, number>();
  const { data: ups } = await supabase
    .from("uploads")
    .select("submission_id, source_block_id")
    .in("submission_id", ids);
  for (const u of (ups ?? []) as Array<{ submission_id: string | null; source_block_id: string | null }>) {
    if (u.submission_id && u.source_block_id !== "__form") {
      counts.set(u.submission_id, (counts.get(u.submission_id) ?? 0) + 1);
    }
  }

  return rows.map((r) => {
    const link = Array.isArray(r.upload_links) ? r.upload_links[0] : r.upload_links;
    return {
      id: r.id,
      uploadLinkId: r.upload_link_id,
      linkName: link?.name ?? "Link",
      status: r.status,
      submissionType: r.submission_type,
      uploaderName: r.uploader_name,
      uploaderEmail: r.uploader_email,
      uploaderMessage: r.uploader_message,
      customData: r.custom_data,
      fileCount: counts.get(r.id) ?? 0,
      createdAt: r.created_at,
    };
  });
}

/** Full detail for one submission: files + the delivery log per channel. */
export async function getSubmissionDetail(
  userId: string,
  submissionId: string,
): Promise<SubmissionDetail | null> {
  const supabase = createSupabaseServerClient();
  const { data: sData, error } = await supabase
    .from("submissions")
    .select("*, upload_links(name)")
    .eq("id", submissionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(formatPgError("Failed to load submission", error));
  if (!sData) return null;

  const subRaw = sData as unknown as SubmissionRow & {
    upload_links: { name: string } | { name: string }[] | null;
  };
  const link = Array.isArray(subRaw.upload_links) ? subRaw.upload_links[0] : subRaw.upload_links;

  const { data: filesData } = await supabase
    .from("uploads")
    .select("id, original_filename, mime_type, file_size_bytes, status, provider, provider_file_id, source_block_id, created_at")
    .eq("submission_id", submissionId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  const files = ((filesData ?? []) as Array<{
    id: string;
    original_filename: string;
    mime_type: string | null;
    file_size_bytes: number | null;
    status: "uploading" | "complete" | "failed";
    provider: StorageProvider | null;
    provider_file_id: string | null;
    source_block_id: string | null;
    created_at: string;
  }>)
    .filter((f) => f.source_block_id !== "__form") // hide the form carrier
    .map((f) => ({
    id: f.id,
    originalFilename: f.original_filename,
    mimeType: f.mime_type,
    fileSizeBytes: f.file_size_bytes,
    status: f.status,
    provider: f.provider,
    providerFileId: f.provider_file_id,
    createdAt: f.created_at,
  }));

  // Deliveries are keyed by batch_id (batched) or upload_id (single) — gather both.
  const deliveries: NotificationDeliveryRow[] = [];
  const seen = new Set<string>();
  const pushAll = (arr: NotificationDeliveryRow[]) => {
    for (const d of arr) {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        deliveries.push(d);
      }
    }
  };
  if (subRaw.batch_id) {
    const { data } = await supabase
      .from("notification_deliveries")
      .select("*")
      .eq("user_id", userId)
      .eq("batch_id", subRaw.batch_id);
    pushAll((data ?? []) as NotificationDeliveryRow[]);
  }
  const uploadIds = files.map((f) => f.id);
  if (uploadIds.length > 0) {
    const { data } = await supabase
      .from("notification_deliveries")
      .select("*")
      .eq("user_id", userId)
      .in("upload_id", uploadIds);
    pushAll((data ?? []) as NotificationDeliveryRow[]);
  }
  deliveries.sort((a, b) => b.created_at.localeCompare(a.created_at));

  return {
    submission: subRaw as unknown as SubmissionRow,
    linkName: link?.name ?? "Link",
    files,
    deliveries,
  };
}

/** Owner edit to a submission (status / tags). RLS scopes to the owner. */
export async function updateSubmission(
  userId: string,
  submissionId: string,
  input: SubmissionUpdateInput,
): Promise<void> {
  const supabase = createSupabaseServerClient();
  const patch: Record<string, unknown> = {};
  if (input.status !== undefined) patch.status = input.status;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase
    .from("submissions")
    .update(patch as never)
    .eq("id", submissionId)
    .eq("user_id", userId);
  if (error) throw new Error(formatPgError("Failed to update submission", error));
}
