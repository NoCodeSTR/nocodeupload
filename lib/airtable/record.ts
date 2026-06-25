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
import { createRecord, updateRecord, getRecord, listTables, type AirtableFieldValue } from "@/lib/airtable/client";
import { parseRecordSourceKey, getFieldMappings } from "@/lib/airtable/sources";
import { renderMergeTags } from "@/lib/merge-tags";
import { prefillKey } from "@/lib/filename";
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
  "id, upload_link_id, user_id, storage_connection_id, provider, provider_file_id, original_filename, mime_type, file_size_bytes, uploader_name, uploader_email, uploader_message, custom_data, completed_at, status, batch_id, airtable_record_id, source_record_ids";

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
  source_record_ids: Record<string, string> | null;
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

/** Best-effort stringify of an Airtable cell (for copying pulled source values). */
function cellToStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "Yes" : "";
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        if (x == null) return "";
        if (typeof x === "string" || typeof x === "number") return String(x);
        if (typeof x === "object") {
          const o = x as Record<string, unknown>;
          return String(o.name ?? o.text ?? o.email ?? o.url ?? o.id ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join(", ");
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return String(o.name ?? o.text ?? o.email ?? o.url ?? o.id ?? "");
  }
  return "";
}

/** Truthy strings that mean "checked" for an Airtable checkbox column. */
const CHECKBOX_TRUE = new Set(["1", "true", "yes", "y", "checked", "x", "on", "✓"]);

/** Coerce a string value to the shape Airtable expects for a given column type. */
function coerceForType(type: string | undefined, val: AirtableFieldValue): AirtableFieldValue {
  // Only coerce plain string values; arrays (attachments, linked records) pass through.
  if (typeof val !== "string") return val;
  if (type === "checkbox") return CHECKBOX_TRUE.has(val.trim().toLowerCase());
  return val; // numbers/dates/selects: Airtable typecast handles string coercion
}

/**
 * Resolve the built field map (keyed by the mapping's stored destination NAMES)
 * against the table's LIVE schema, so a write survives whitespace/case drift and
 * a renamed/removed column never sinks the whole atomic PATCH:
 *   - match each key to a live field (exact, then trimmed + case-insensitive),
 *   - rewrite the key to the field's EXACT current name,
 *   - coerce the value to the column's type (e.g. checkbox → boolean),
 *   - collect any keys with no matching column so the caller can report them.
 * Fails open (returns the original fields) if the schema can't be read.
 */
async function resolveWriteFields(args: {
  token: string;
  baseId: string;
  tableId: string;
  fields: Record<string, AirtableFieldValue>;
}): Promise<{ fields: Record<string, AirtableFieldValue>; dropped: string[] }> {
  const keys = Object.keys(args.fields);
  if (keys.length === 0) return { fields: args.fields, dropped: [] };
  let liveFields: Array<{ name: string; type: string }> = [];
  try {
    const tables = await listTables(args.token, args.baseId);
    liveFields = tables.find((t) => t.id === args.tableId)?.fields ?? [];
  } catch {
    return { fields: args.fields, dropped: [] }; // can't read schema → write as-is
  }
  if (liveFields.length === 0) return { fields: args.fields, dropped: [] };

  const byNorm = new Map<string, { name: string; type: string }>();
  for (const f of liveFields) byNorm.set(f.name.trim().toLowerCase(), f);

  const out: Record<string, AirtableFieldValue> = {};
  const dropped: string[] = [];
  for (const [key, val] of Object.entries(args.fields)) {
    const live = liveFields.find((f) => f.name === key) ?? byNorm.get(key.trim().toLowerCase());
    if (!live) {
      dropped.push(key);
      continue;
    }
    out[live.name] = coerceForType(live.type, val);
  }
  return { fields: out, dropped };
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

  // Destination-oriented mapping: each entry fills ONE field on the destination
  // table from a value source. Built-ins / custom fields resolve to a string;
  // record sources link the referenced record into a linked field (ref:<alias>)
  // or copy a pulled value (ref:<alias>:<Field>) fetched live with the owner
  // token (authoritative). Source records are fetched at most once each.
  const fields: Record<string, AirtableFieldValue> = {};
  const sourceRecordIds = uploads[0]?.source_record_ids ?? {};
  const sourceDefs = config.recordSources ?? [];
  const recCache = new Map<string, Record<string, unknown> | null>();
  const loadSourceFields = async (aliasKey: string): Promise<Record<string, unknown> | null> => {
    if (recCache.has(aliasKey)) return recCache.get(aliasKey) ?? null;
    const def = sourceDefs.find((s) => prefillKey(s.alias) === aliasKey);
    const recId = sourceRecordIds[aliasKey];
    if (!def?.tableId || !recId || !REC_ID_RE.test(recId)) {
      recCache.set(aliasKey, null);
      return null;
    }
    try {
      const rec = await getRecord({ token, baseId: config.baseId, tableId: def.tableId, recordId: recId });
      recCache.set(aliasKey, rec.fields ?? {});
      return rec.fields ?? {};
    } catch {
      recCache.set(aliasKey, null);
      return null;
    }
  };

  for (const { field: destField, source: srcKey } of getFieldMappings(config)) {
    if (!destField || !srcKey) continue;
    const ref = parseRecordSourceKey(srcKey);
    if (ref) {
      const recId = sourceRecordIds[ref.aliasKey];
      if (!recId || !REC_ID_RE.test(recId)) continue;
      if (ref.field == null) {
        fields[destField] = [recId]; // linked-record field takes [recordId]
      } else {
        const recFields = await loadSourceFields(ref.aliasKey);
        const v = cellToStr(recFields?.[ref.field]);
        if (v && v.trim() !== "") fields[destField] = v;
      }
    } else {
      const v = sourceValue(srcKey, uploads);
      if (v && v.trim() !== "") fields[destField] = v;
    }
  }

  // Constant values — templated: a constant may mix static text with merge tags
  // ({{name}}, {{date}}, {{Custom Field}}, {{cleaner.Phone}}). Render each against
  // the submission context: uploader fields, custom data, date/count, and any
  // connected-source fields it references (fetched once via loadSourceFields).
  const statics = config.staticValues ?? [];
  if (statics.length > 0) {
    const rep = uploads[0];
    const d = rep?.completed_at ? new Date(rep.completed_at) : new Date();
    const mergeMap: Record<string, string> = {
      name: rep?.uploader_name ?? "",
      email: rep?.uploader_email ?? "",
      message: rep?.uploader_message ?? "",
      date: isoDate(d),
      count: String(uploads.length),
    };
    for (const [label, val] of Object.entries(rep?.custom_data ?? {})) mergeMap[label] = val;
    // Collect connected-source aliases referenced in any constant, fetch each.
    const aliasesNeeded = new Set<string>();
    const tokenRe = /\{\{([^}]+)\}\}/g;
    for (const sv of statics) {
      let m: RegExpExecArray | null;
      while ((m = tokenRe.exec(sv.value ?? ""))) {
        const inner = m[1].split("|")[0].trim();
        const dot = inner.indexOf(".");
        if (dot > 0) aliasesNeeded.add(prefillKey(inner.slice(0, dot)));
      }
    }
    for (const aliasKey of aliasesNeeded) {
      const recFields = await loadSourceFields(aliasKey);
      if (recFields) {
        for (const [fname, fval] of Object.entries(recFields)) {
          mergeMap[`${aliasKey}.${fname}`] = cellToStr(fval);
        }
      }
    }
    for (const sv of statics) {
      if (!sv.field) continue;
      const rendered = renderMergeTags(sv.value ?? "", mergeMap);
      if (rendered.trim() !== "") fields[sv.field] = rendered;
    }
  }

  // Opt-in attachments: point Airtable at our signed proxy for each Drive file.
  // All files in a multi-file submission go into one attachment field at once.
  if (config.attachFiles && config.attachFieldName) {
    const attachments = buildAttachments(uploads);
    if (attachments.length > 0) {
      fields[config.attachFieldName] = attachments;
    }
  }

  // Create vs update. recordAction is authoritative; fall back to the legacy
  // updateRecordWhenPresent flag. For update, the target record id comes from the
  // link URL (?record=, persisted as airtable_record_id) or a connected source
  // alias (?guest=, in source_record_ids). The table is config.tableId — the
  // editor sets it to the alias's table when an alias source is chosen.
  const action: "create" | "update" =
    config.recordAction ?? (config.updateRecordWhenPresent ? "update" : "create");
  let updateTargetId: string | null = null;
  if (action === "update") {
    const src = config.updateRecordSource ?? "url";
    updateTargetId = src === "url" ? uploads[0]?.airtable_record_id ?? null : sourceRecordIds[src] ?? null;
  }
  const doUpdate = action === "update" && !!updateTargetId && REC_ID_RE.test(updateTargetId);

  // Update mode with no record id in the link → skip (never silently create one).
  if (action === "update" && !doUpdate) {
    await logDelivery({
      userId,
      uploadLinkId,
      channel: "airtable",
      result: { status: "skipped", target, detail: "Update mode: no record id was passed in the link" },
      uploadId,
      batchId,
    });
    return;
  }

  // Resolve destination names against the LIVE schema (tolerant to whitespace/
  // case), coerce each value to its column type (e.g. checkbox → boolean), and
  // drop columns the table no longer has — so a stale/renamed field name can't
  // fail the entire atomic write (the "Unknown field name" 422 class of bug).
  const { fields: writeFields, dropped } = await resolveWriteFields({
    token,
    baseId: config.baseId,
    tableId: config.tableId,
    fields,
  });
  const droppedNote = dropped.length
    ? ` (skipped ${dropped.length} unknown field${dropped.length === 1 ? "" : "s"}: ${dropped.join(", ")})`
    : "";

  // Update mode with nothing left to write is a silent no-op on Airtable's side
  // (a PATCH with empty fields changes nothing but returns 200). Surface it —
  // including any unknown fields — instead of a misleading "Updated".
  if (doUpdate && Object.keys(writeFields).length === 0) {
    await logDelivery({
      userId,
      uploadLinkId,
      channel: "airtable",
      result: {
        status: "skipped",
        target,
        detail: dropped.length
          ? `No writable fields matched the table — unknown field(s): ${dropped.join(", ")}. Re-pick them under Airtable mapping.`
          : "No fields were mapped to write — set a Source on the destination fields under Airtable mapping.",
      },
      uploadId,
      batchId,
    });
    return;
  }

  let result: NotifyResult;
  let recordId: string | null = null;
  try {
    const record = doUpdate
      ? await updateRecord({
          token,
          baseId: config.baseId,
          tableId: config.tableId,
          recordId: updateTargetId as string,
          fields: writeFields,
        })
      : await createRecord({ token, baseId: config.baseId, tableId: config.tableId, fields: writeFields });
    recordId = record.id ?? null;
    // A partial write (some fields skipped) still succeeded for the rest — report
    // it as sent but name the skipped fields so the owner can fix the mapping.
    result = {
      status: "sent",
      target,
      detail: `${doUpdate ? "Updated" : "Created"} record ${record.id}${droppedNote}`,
    };
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
