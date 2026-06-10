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
import { coreEnv } from "@/lib/env";
import { encryptToToken } from "@/lib/crypto/tokens";
import { fileCategory } from "@/lib/upload-validation";
import { resultUrlFor } from "@/lib/result-url";
import { logDelivery } from "@/lib/notifications/deliveries";
import { getAirtableToken } from "@/lib/airtable/connection";
import { createRecord, updateRecord, type AirtableFieldValue } from "@/lib/airtable/client";
import type { AirtableConfig } from "@/lib/db-types";
import type { NotifyResult } from "@/lib/notifications/types";

// Attachment proxy: files up to this size are streamed to Airtable through our
// signed /api/airtable/file proxy. Larger files (big videos) keep just the link.
const ATTACH_MAX_BYTES = 100 * 1024 * 1024;
// How long the signed attachment URL stays valid for Airtable to fetch it.
const ATTACH_TOKEN_TTL_MS = 30 * 60 * 1000;
// Airtable record id shape — guard before a two-way-sync update.
const REC_ID_RE = /^rec[A-Za-z0-9]{6,}$/;

const UPLOAD_FIELDS =
  "id, upload_link_id, user_id, storage_connection_id, provider, provider_file_id, original_filename, mime_type, file_size_bytes, uploader_name, uploader_email, uploader_message, custom_data, completed_at, status, batch_id, airtable_record_id";

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
  airtable_record_id: string | null;
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

// --- Attachments (private signed proxy URLs) ---------------------------------

/**
 * Build Airtable attachment objects for the Drive files in this record. Each
 * points at our signed /api/airtable/file proxy (not a public Drive share), so
 * Airtable can fetch every file reliably while it stays valid — no share/revoke
 * race that previously dropped all-but-one file in multi-file submissions.
 */
function buildAttachments(uploads: UploadRecordRow[]): Array<{ url: string; filename: string }> {
  const appUrl = coreEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const exp = Date.now() + ATTACH_TOKEN_TTL_MS;
  const out: Array<{ url: string; filename: string }> = [];
  for (const u of uploads) {
    if (u.provider !== "google_drive" || !u.provider_file_id) continue;
    if ((u.file_size_bytes ?? 0) > ATTACH_MAX_BYTES) continue; // too big — link carries it
    const token = encryptToToken(`${u.id}|${exp}`);
    out.push({ url: `${appUrl}/api/airtable/file/${token}`, filename: u.original_filename });
  }
  return out;
}

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

  // Opt-in attachments: point Airtable at our signed proxy for each Drive file.
  // All files in a multi-file submission go into one attachment field at once.
  if (config.attachFiles && config.attachFieldName) {
    const attachments = buildAttachments(uploads);
    if (attachments.length > 0) {
      fields[config.attachFieldName] = attachments;
    }
  }

  // Two-way sync: when the link opts in and the submission carries a valid
  // record id, UPDATE that record; otherwise create a new one.
  const targetRecordId = uploads[0]?.airtable_record_id ?? null;
  const doUpdate = Boolean(
    config.updateRecordWhenPresent && targetRecordId && REC_ID_RE.test(targetRecordId),
  );

  let result: NotifyResult;
  let recordId: string | null = null;
  try {
    const record = doUpdate
      ? await updateRecord({
          token,
          baseId: config.baseId,
          tableId: config.tableId,
          recordId: targetRecordId as string,
          fields,
        })
      : await createRecord({ token, baseId: config.baseId, tableId: config.tableId, fields });
    recordId = record.id ?? null;
    result = { status: "sent", target, detail: `${doUpdate ? "Updated" : "Created"} record ${record.id}` };
  } catch (err) {
    result = {
      status: "failed",
      target,
      detail: err instanceof Error ? err.message : doUpdate ? "update failed" : "create failed",
    };
  }

  // Persist the record id back onto the upload row(s) so it's durably available
  // to the webhook payload and the submission detail page (covers freshly CREATED
  // records, which previously lived only in the delivery-log detail string).
  // Isolated from the create/update try above: a DB hiccup here must never flip a
  // successful Airtable write to "failed" — that would retry and double-create.
  if (recordId) {
    try {
      const admin = getSupabaseAdmin();
      await admin
        .from("uploads")
        .update({ airtable_record_id: recordId } as never)
        .in(
          "id",
          uploads.map((u) => u.id),
        );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[airtable] failed to persist record id back to uploads (record was written):", err);
    }
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

// --- Batch webhook reliability -----------------------------------------------

const RECORD_POLL_INTERVAL_MS = 250;
// Safety cap, set just above the Airtable API timeout (lib/airtable/client.ts):
// if the claim-winning request's create call runs long, it logs a delivery row
// by ~15s, so we'll observe the outcome before this cap in practice.
const RECORD_WAIT_MAX_MS = 18_000;

/**
 * Resolve a per_batch submission's Airtable record id reliably for the bundled
 * webhook, waiting out the cross-request race where one request wins the Airtable
 * claim while another sends the notification.
 *
 * Both the chunk route and the batch-complete route run Airtable BEFORE
 * notifications, so the request that ends up sending the webhook has already
 * kicked off (or completed) the record write. When it completed the write itself
 * the id is present on the first read (zero wait — the common case). Only when a
 * *peer* request holds the claim do we poll, keying off the durable completion
 * signal:
 *   - the record id appearing on a batch row  → success, return it; OR
 *   - an "airtable" delivery row for the batch → done with no id (failed/skipped),
 *     so stop waiting and return null.
 * buildAndCreate persists the id BEFORE logging that delivery row, so observing
 * the row guarantees the id (if any) is already committed.
 *
 * Caller gates this to per_batch + Airtable-enabled links, so a plain return of
 * null here means "no record for this batch" — never "didn't bother to check".
 */
export async function awaitBatchAirtableRecordId(batchId: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const deadline = Date.now() + RECORD_WAIT_MAX_MS;

  for (;;) {
    // 1) Success signal — id persisted on any row of the batch. Checked first so
    //    a freshly-succeeded write (id set, delivery row a beat behind) wins.
    const { data: idRows } = await admin
      .from("uploads")
      .select("airtable_record_id")
      .eq("batch_id", batchId)
      .not("airtable_record_id", "is", null)
      .limit(1);
    const id = (idRows?.[0] as { airtable_record_id: string | null } | undefined)?.airtable_record_id ?? null;
    if (id) return id;

    // 2) Done-without-id signal — the Airtable attempt logged a delivery row but
    //    produced no record (failed/skipped). Nothing more is coming.
    const { data: delRows } = await admin
      .from("notification_deliveries")
      .select("id")
      .eq("batch_id", batchId)
      .eq("channel", "airtable")
      .limit(1);
    if ((delRows?.length ?? 0) > 0) return null;

    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, RECORD_POLL_INTERVAL_MS));
  }
}
