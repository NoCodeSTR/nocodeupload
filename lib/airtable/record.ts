/**
 * Airtable record creation — the destination that runs ALONGSIDE Drive/YouTube.
 *
 * Decoupled from notification bundling: a link can bundle notifications but
 * still create one Airtable record per file (or vice-versa). Exactly-once is
 * guaranteed by an atomic claim on uploads.airtable_recorded_at:
 *   - per_upload → claim the single row.
 *   - per_batch  → claim the whole batch (first finalizer wins), one record.
 *
 * Triggers (mirroring lib/batch.ts):
 *   recordAfterUpload(uploadId)            — chunk route, after each file lands.
 *   finalizeAirtableBatchFromClient(batch) — /api/upload/batch-complete.
 *
 * Attachments (opt-in): we temporarily share each Drive file (anyone-with-link),
 * hand Airtable the download URL, confirm Airtable ingested the bytes, then
 * revoke the share. Link mode (default) just writes the file URL — no sharing,
 * no extra latency. Every attempt is logged to notification_deliveries as the
 * "airtable" channel.
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getBatchProgress } from "@/lib/uploads";
import { getValidAccessToken } from "@/lib/tokens";
import { fileCategory } from "@/lib/upload-validation";
import { resultUrlFor } from "@/lib/result-url";
import { logDelivery } from "@/lib/notifications/deliveries";
import { getAirtableToken } from "@/lib/airtable/connection";
import {
  createRecord,
  getRecord,
  type AirtableFieldValue,
} from "@/lib/airtable/client";
import {
  setFilePublicRead,
  removeFilePermission,
  driveDownloadUrl,
} from "@/lib/providers/google/drive";
import type { AirtableConfig } from "@/lib/db-types";
import type { NotifyResult } from "@/lib/notifications/types";

const UPLOAD_FIELDS =
  "id, upload_link_id, user_id, storage_connection_id, provider, provider_file_id, original_filename, mime_type, file_size_bytes, uploader_name, uploader_email, uploader_message, custom_data, completed_at, status, batch_id";

interface UploadRecordRow {
  id: string;
  upload_link_id: string;
  user_id: string;
  storage_connection_id: string;
  provider: string | null;
  provider_file_id: string | null;
  original_filename: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  uploader_name: string | null;
  uploader_email: string | null;
  uploader_message: string | null;
  custom_data: Record<string, string> | null;
  completed_at: string | null;
  status: string;
  batch_id: string | null;
}

// --- Config loader -----------------------------------------------------------

interface LinkAirtable {
  userId: string;
  config: AirtableConfig;
}

/** Load a link's Airtable config; null unless it's present + enabled + targeted. */
async function loadLinkAirtable(uploadLinkId: string): Promise<LinkAirtable | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("upload_links")
    .select("user_id, airtable_config")
    .eq("id", uploadLinkId)
    .maybeSingle();
  const link = data as { user_id: string; airtable_config: AirtableConfig | null } | null;
  if (!link?.airtable_config) return null;
  const cfg = link.airtable_config;
  if (!cfg.enabled || !cfg.baseId || !cfg.tableId) return null;
  return { userId: link.user_id, config: cfg };
}

// --- Claims (exactly-once) ---------------------------------------------------

/** Claim the single upload row for a per_upload record. First caller wins. */
async function claimUploadForAirtable(uploadId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("uploads")
    .update({ airtable_recorded_at: new Date().toISOString() } as never)
    .eq("id", uploadId)
    .is("airtable_recorded_at", null)
    .eq("status", "complete")
    .select("id");
  return (data?.length ?? 0) > 0;
}

/** Claim the whole batch for a per_batch record (batch-wide marker). */
async function claimBatchForAirtable(batchId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("uploads")
    .update({ airtable_recorded_at: new Date().toISOString() } as never)
    .eq("batch_id", batchId)
    .is("airtable_recorded_at", null)
    .select("id");
  return (data?.length ?? 0) > 0;
}

// --- Loaders -----------------------------------------------------------------

async function loadUpload(uploadId: string): Promise<UploadRecordRow | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin.from("uploads").select(UPLOAD_FIELDS).eq("id", uploadId).maybeSingle();
  return (data as UploadRecordRow | null) ?? null;
}

async function loadCompleteBatchUploads(batchId: string): Promise<UploadRecordRow[]> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("uploads")
    .select(UPLOAD_FIELDS)
    .eq("batch_id", batchId)
    .eq("status", "complete")
    .order("completed_at", { ascending: true });
  return (data ?? []) as UploadRecordRow[];
}

// --- Value building ----------------------------------------------------------

function humanSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function isoDate(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Resolve a mapping source key to a string value for the given upload set. */
function sourceValue(key: string, uploads: UploadRecordRow[]): string {
  const rep = uploads[0];
  if (key.startsWith("field:")) {
    const label = key.slice("field:".length).trim().toLowerCase();
    const cd = rep.custom_data ?? {};
    const k = Object.keys(cd).find((kk) => kk.toLowerCase() === label);
    return k ? cd[k] : "";
  }
  switch (key) {
    case "link":
      return uploads
        .map((u) => resultUrlFor(u.provider as never, u.provider_file_id))
        .filter(Boolean)
        .join("\n");
    case "filename":
      return uploads.map((u) => u.original_filename).join("\n");
    case "filetype":
      return Array.from(new Set(uploads.map((u) => fileCategory(u.mime_type)))).join(", ");
    case "size":
      return humanSize(uploads.reduce((sum, u) => sum + (u.file_size_bytes ?? 0), 0));
    case "name":
      return rep.uploader_name ?? "";
    case "email":
      return rep.uploader_email ?? "";
    case "message":
      return rep.uploader_message ?? "";
    case "date":
      return isoDate(rep.completed_at ? new Date(rep.completed_at) : new Date());
    case "count":
      return String(uploads.length);
    default:
      return "";
  }
}

// --- Attachment ingestion (share → fetch → revoke) ---------------------------

const ATTACH_POLL_TRIES = 6;
const ATTACH_POLL_DELAY_MS = 1500;

function isIngested(value: unknown, expected: number): boolean {
  if (!Array.isArray(value) || value.length < expected) return false;
  // Airtable populates `size` (and `type`) once it has downloaded the bytes.
  return value.every((a) => a && typeof a === "object" && typeof (a as { size?: unknown }).size === "number");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Build + create one record -----------------------------------------------

async function buildAndCreate(args: {
  uploads: UploadRecordRow[];
  userId: string;
  uploadLinkId: string;
  config: AirtableConfig;
  uploadId: string | null;
  batchId: string | null;
}): Promise<void> {
  const { uploads, userId, uploadLinkId, config, uploadId, batchId } = args;
  if (uploads.length === 0) return;

  const target = config.tableName || config.baseName || "Airtable";

  const token = await getAirtableToken(userId, { admin: true });
  if (!token) {
    await logDelivery({
      userId,
      uploadLinkId,
      channel: "airtable",
      result: { status: "skipped", target, detail: "Airtable not connected — reconnect in Settings" },
      uploadId,
      batchId,
    });
    return;
  }

  // Mapped + static fields (plain strings; Airtable typecasts on create).
  const fields: Record<string, AirtableFieldValue> = {};
  for (const [srcKey, fieldName] of Object.entries(config.mapping ?? {})) {
    if (!fieldName) continue;
    const v = sourceValue(srcKey, uploads);
    if (v && v.trim() !== "") fields[fieldName] = v;
  }
  for (const sv of config.staticValues ?? []) {
    if (sv.field && sv.value) fields[sv.field] = sv.value;
  }

  // Opt-in attachments: temporarily share each Drive file, hand Airtable the URL.
  const shares: Array<{ fileId: string; permissionId: string }> = [];
  let driveToken: string | null = null;
  if (config.attachFiles && config.attachFieldName) {
    const driveUploads = uploads.filter((u) => u.provider === "google_drive" && u.provider_file_id);
    if (driveUploads.length > 0) {
      try {
        const res = await getValidAccessToken({
          userId,
          connectionId: uploads[0].storage_connection_id,
        });
        driveToken = res.accessToken;
      } catch {
        driveToken = null;
      }
      if (driveToken) {
        const attachments: Array<{ url: string; filename?: string }> = [];
        for (const u of driveUploads) {
          try {
            const { permissionId } = await setFilePublicRead({
              accessToken: driveToken,
              fileId: u.provider_file_id!,
            });
            shares.push({ fileId: u.provider_file_id!, permissionId });
            attachments.push({ url: driveDownloadUrl(u.provider_file_id!), filename: u.original_filename });
          } catch {
            /* skip this file's attachment; the link field still carries it */
          }
        }
        if (attachments.length > 0) {
          fields[config.attachFieldName] = attachments;
        }
      }
    }
  }

  let result: NotifyResult;
  try {
    const record = await createRecord({
      token,
      baseId: config.baseId,
      tableId: config.tableId,
      fields,
    });

    // If we shared files, wait for Airtable to copy them, then revoke.
    if (shares.length > 0 && config.attachFieldName) {
      for (let i = 0; i < ATTACH_POLL_TRIES; i++) {
        await sleep(ATTACH_POLL_DELAY_MS);
        try {
          const fresh = await getRecord({
            token,
            baseId: config.baseId,
            tableId: config.tableId,
            recordId: record.id,
          });
          if (isIngested(fresh.fields[config.attachFieldName], shares.length)) break;
        } catch {
          break;
        }
      }
      if (driveToken) {
        for (const s of shares) {
          await removeFilePermission({ accessToken: driveToken, fileId: s.fileId, permissionId: s.permissionId });
        }
      }
    }

    result = { status: "sent", target, detail: `Record ${record.id}` };
  } catch (err) {
    // Revoke any shares even if the create failed.
    if (driveToken && shares.length > 0) {
      for (const s of shares) {
        await removeFilePermission({ accessToken: driveToken, fileId: s.fileId, permissionId: s.permissionId });
      }
    }
    result = { status: "failed", target, detail: err instanceof Error ? err.message : "create failed" };
  }

  await logDelivery({ userId, uploadLinkId, channel: "airtable", result, uploadId, batchId });
}

// --- Batch helper ------------------------------------------------------------

async function maybeRecordBatch(args: {
  batchId: string;
  uploadLinkId: string;
  link: LinkAirtable;
  requireDeclaredComplete: boolean;
}): Promise<void> {
  const progress = await getBatchProgress(args.batchId);
  if (progress.total === 0) return;
  if (progress.uploading > 0) return;
  if (args.requireDeclaredComplete) {
    if (progress.declaredSize == null) return;
    if (progress.terminal < progress.declaredSize) return;
  }
  const claimed = await claimBatchForAirtable(args.batchId);
  if (!claimed) return;
  const uploads = await loadCompleteBatchUploads(args.batchId);
  if (uploads.length === 0) return;
  await buildAndCreate({
    uploads,
    userId: args.link.userId,
    uploadLinkId: args.uploadLinkId,
    config: args.link.config,
    uploadId: null,
    batchId: args.batchId,
  });
}

// --- Public entry points -----------------------------------------------------

/** Chunk route: called after each file finalizes. Routes by record mode. */
export async function recordAfterUpload(uploadId: string): Promise<void> {
  const upload = await loadUpload(uploadId);
  if (!upload || upload.status !== "complete") return;

  const link = await loadLinkAirtable(upload.upload_link_id);
  if (!link) return;

  if (link.config.recordMode === "per_upload") {
    if (!(await claimUploadForAirtable(uploadId))) return;
    await buildAndCreate({
      uploads: [upload],
      userId: link.userId,
      uploadLinkId: upload.upload_link_id,
      config: link.config,
      uploadId,
      batchId: upload.batch_id,
    });
    return;
  }

  // per_batch
  if (!upload.batch_id) {
    // A single-file submission still gets exactly one record.
    if (!(await claimUploadForAirtable(uploadId))) return;
    await buildAndCreate({
      uploads: [upload],
      userId: link.userId,
      uploadLinkId: upload.upload_link_id,
      config: link.config,
      uploadId,
      batchId: null,
    });
    return;
  }

  await maybeRecordBatch({
    batchId: upload.batch_id,
    uploadLinkId: upload.upload_link_id,
    link,
    requireDeclaredComplete: true,
  });
}

/** batch-complete route: authoritative "batch done" trigger for per_batch mode. */
export async function finalizeAirtableBatchFromClient(batchId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("uploads")
    .select("upload_link_id")
    .eq("batch_id", batchId)
    .limit(1)
    .maybeSingle();
  const row = data as { upload_link_id: string } | null;
  if (!row) return;

  const link = await loadLinkAirtable(row.upload_link_id);
  if (!link) return;
  if (link.config.recordMode !== "per_batch") return; // per_upload already handled per file

  await maybeRecordBatch({
    batchId,
    uploadLinkId: row.upload_link_id,
    link,
    requireDeclaredComplete: false,
  });
}
