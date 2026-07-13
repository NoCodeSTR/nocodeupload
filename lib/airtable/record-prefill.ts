/**
 * Airtable record personalization (read-only).
 *
 * Given a link with an Airtable base+table configured (and the opt-in flag) and
 * a recordId from the URL, fetch that record and expose its columns as a value
 * map keyed by the column-name slug (prefillKey form) — ready for merge tags in
 * content blocks and for prefilling hidden/visible fields by matching label.
 *
 * Uses the OWNER's Airtable token (admin client) and requires data.records:read
 * on the PAT. Fails closed (empty map) on any error, missing scope, opt-out, or
 * record-not-found, so personalization never blocks the page or an upload.
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAirtableToken } from "@/lib/airtable/connection";
import { getRecord, updateRecord } from "@/lib/airtable/client";
import { getLinkBySlugAdmin } from "@/lib/links";
import { resolveSourceRecordIds } from "@/lib/airtable/sources";
import { prefillKey } from "@/lib/filename";
import type { UploadLinkRow, AirtableConfig } from "@/lib/db-types";

// Airtable record ids look like rec + alphanumerics. Cheap guard before a fetch.
const REC_ID_RE = /^rec[A-Za-z0-9]{6,}$/;

/** Best-effort stringify of an Airtable cell value for merge tags / prefills. */
function toStr(v: unknown): string {
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

/**
 * Fetch the record's columns as { prefillKey(columnName): value }. Empty unless
 * the link opted in, has a base+table, the id looks valid, and the record loads.
 */
export async function getAirtableRecordValues(
  link: UploadLinkRow,
  recordId: string | null | undefined,
): Promise<Record<string, string>> {
  const cfg = link.airtable_config;
  if (
    !recordId ||
    !cfg?.enabled ||
    !cfg.allowRecordPrefill ||
    !cfg.baseId ||
    !cfg.tableId ||
    !REC_ID_RE.test(recordId)
  ) {
    return {};
  }
  const token = await getAirtableToken(link.user_id, { admin: true });
  if (!token) return {};
  try {
    const rec = await getRecord({ token, baseId: cfg.baseId, tableId: cfg.tableId, recordId });
    const out: Record<string, string> = {};
    for (const [field, value] of Object.entries(rec.fields ?? {})) {
      const s = toStr(value);
      if (s) out[prefillKey(field)] = s;
    }
    return out;
  } catch {
    return {};
  }
}

/** Same, but loads the link by slug (for the public page, which only has the public row). */
export async function getAirtableRecordValuesBySlug(
  slug: string,
  recordId: string | null | undefined,
): Promise<Record<string, string>> {
  if (!recordId) return {};
  let link: UploadLinkRow | null;
  try {
    link = await getLinkBySlugAdmin(slug);
  } catch {
    return {};
  }
  if (!link) return {};
  return getAirtableRecordValues(link, recordId);
}

/**
 * Scan a link's rendered copy for {{alias.Field}} merge tags and collect, per
 * source alias, the set of referenced field keys. This is what lets the owner
 * use ANY field of a connected table without pre-selecting it, while only the
 * fields actually referenced ever leave Airtable for the browser. Scans the
 * surfaces that render merge tags: content blocks, section heading/text, and
 * custom-field defaults.
 */
function collectReferencedSourceFields(
  link: UploadLinkRow,
  aliasKeys: Set<string>,
): Map<string, Set<string>> {
  const refs = new Map<string, Set<string>>();
  const strings: string[] = [];
  for (const b of link.content_blocks ?? []) if (b?.text) strings.push(b.text);
  for (const s of link.sections ?? []) {
    if (s?.heading) strings.push(s.heading);
    if (s?.text) strings.push(s.text);
  }
  for (const f of link.custom_fields ?? []) if (f?.value) strings.push(f.value);
  // Dynamic prefill for the built-in name/email can reference sources too — but
  // only when SHOWN to the uploader. Hidden prefills are resolved server-side
  // (getAirtableSourceValuesForSubmit), so their tokens must NOT pull source
  // values into the browser payload here.
  if (link.prefill_name && !link.hide_name) strings.push(link.prefill_name);
  if (link.prefill_email && !link.hide_email) strings.push(link.prefill_email);
  // The success screen can greet by connected data ("Thanks {{guest.First Name}}!").
  if (link.success_message) strings.push(link.success_message);

  const tagRe = /\{\{([^}]+)\}\}/g;
  for (const str of strings) {
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(str))) {
      const inner = m[1].split("|")[0].trim(); // drop |fallback
      const dot = inner.indexOf(".");
      if (dot === -1) continue;
      const aliasKey = prefillKey(inner.slice(0, dot));
      const fieldKey = prefillKey(inner.slice(dot + 1));
      if (!aliasKey || !fieldKey || !aliasKeys.has(aliasKey)) continue;
      if (!refs.has(aliasKey)) refs.set(aliasKey, new Set());
      refs.get(aliasKey)!.add(fieldKey);
    }
  }

  // Field-visibility conditions controlled by a connected record need their
  // controlling field's value in the browser to evaluate live — include it
  // (it's a reference like a merge tag, except it drives show/hide).
  for (const f of link.custom_fields ?? []) {
    const sw = f?.showWhen;
    if (!sw?.source || !sw.fieldId) continue;
    const aliasKey = prefillKey(sw.source);
    const fieldKey = prefillKey(sw.fieldId);
    if (!aliasKeys.has(aliasKey)) continue;
    if (!refs.has(aliasKey)) refs.set(aliasKey, new Set());
    refs.get(aliasKey)!.add(fieldKey);
  }
  return refs;
}

/**
 * Multi-table record sources: for each connected source, read its recordId from
 * the URL (by the source's alias key) and surface its fields under namespaced
 * keys `${aliasKey}.${fieldKey}` so they line up with {{alias.Field}} merge tags
 * (renderMergeTags normalizes both sides via prefillKey). All sources share the
 * link's base.
 *
 * Exposure model: the full record is fetched server-side with the owner's token,
 * but only fields the owner actually REFERENCES in the form's copy ship to the
 * browser — so connecting a table makes every field usable, yet an unreferenced
 * column never lands in the page source. (Mapping/writeback fetches its own copy
 * server-side, so it can use any field regardless.) Fails closed per source.
 *
 * `params` is the raw query map; record ids are matched by the alias's prefill
 * key, e.g. alias "cleaner" → ?cleaner=recXXX.
 */
export async function getAirtableSourceValuesBySlug(
  slug: string,
  params: Record<string, string | string[] | undefined>,
): Promise<Record<string, string>> {
  let link: UploadLinkRow | null;
  try {
    link = await getLinkBySlugAdmin(slug);
  } catch {
    return {};
  }
  const cfg = link?.airtable_config;
  const sources = cfg?.recordSources ?? [];
  // Connected Data powers personalization independently of record creation, so
  // this is gated on a base + sources — NOT on the create-a-record flag.
  if (!link || !cfg?.baseId || sources.length === 0) return {};

  // Which source fields does the form's copy actually reference? Only those ship.
  const aliasKeys = new Set(sources.map((s) => prefillKey(s.alias || "")).filter(Boolean));
  const referenced = collectReferencedSourceFields(link, aliasKeys);
  if (referenced.size === 0) return {};

  // Normalize the URL params once: prefillKey(paramName) → first string value.
  const normParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val != null && val !== "") normParams[prefillKey(k)] = String(val);
  }

  const token = await getAirtableToken(link.user_id, { admin: true });
  if (!token) return {};

  const out: Record<string, string> = {};
  await Promise.all(
    sources.map(async (src) => {
      if (!src.tableId || !src.alias) return;
      const aliasKey = prefillKey(src.alias);
      const wanted = referenced.get(aliasKey);
      if (!wanted || wanted.size === 0) return; // nothing referenced → no fetch
      const recordId = normParams[aliasKey];
      if (!recordId || !REC_ID_RE.test(recordId)) return;
      try {
        const rec = await getRecord({ token, baseId: cfg.baseId, tableId: src.tableId, recordId });
        for (const [field, value] of Object.entries(rec.fields ?? {})) {
          const fieldKey = prefillKey(field);
          if (!wanted.has(fieldKey)) continue; // only referenced fields leave Airtable
          const s = toStr(value);
          if (s) out[`${aliasKey}.${fieldKey}`] = s;
        }
      } catch {
        /* fail closed — a missing record / scope never blocks the page */
      }
    }),
  );
  return out;
}

/**
 * Submit-time source values: fetch each connected source's record (id resolved
 * from the URL prefills) and return ALL its fields namespaced as
 * `${aliasKey}.${fieldKey}`. Used server-side to resolve dynamic HIDDEN prefills
 * (e.g. a silently-attached name of {{guest.First Name}}) authoritatively — the
 * values never reach the browser here. Fails closed per source. Callers should
 * gate the call so it only runs when a dynamic hidden value actually needs it.
 */
export async function getAirtableSourceValuesForSubmit(
  link: UploadLinkRow,
  prefillValues: Record<string, string>,
): Promise<Record<string, string>> {
  const cfg = link.airtable_config;
  const sources = cfg?.recordSources ?? [];
  if (!cfg?.baseId || sources.length === 0) return {};
  const recordIds = resolveSourceRecordIds(sources, prefillValues);
  if (Object.keys(recordIds).length === 0) return {};
  const token = await getAirtableToken(link.user_id, { admin: true });
  if (!token) return {};

  const out: Record<string, string> = {};
  await Promise.all(
    sources.map(async (src) => {
      const aliasKey = prefillKey(src.alias || "");
      const recordId = recordIds[aliasKey];
      if (!src.tableId || !recordId) return;
      try {
        const rec = await getRecord({ token, baseId: cfg.baseId, tableId: src.tableId, recordId });
        for (const [field, value] of Object.entries(rec.fields ?? {})) {
          const s = toStr(value);
          if (s) out[`${aliasKey}.${prefillKey(field)}`] = s;
        }
      } catch {
        /* fail closed */
      }
    }),
  );
  return out;
}

/**
 * Update mode: fetch the record being updated (in the destination table) and
 * return its columns as { prefillKey(column): value } so the public form can
 * PRELOAD existing values into matching fields — the uploader edits the current
 * record instead of blanking unmapped/untouched columns. The id comes from the
 * link URL (?record=) or the chosen connected alias (?guest=). Empty unless the
 * link is in update mode with a valid record id. Fails closed.
 */
export async function getUpdateTargetValues(
  link: UploadLinkRow,
  params: Record<string, string | string[] | undefined>,
): Promise<Record<string, string>> {
  const cfg = link.airtable_config;
  if (cfg?.recordAction !== "update" || !cfg.baseId || !cfg.tableId) return {};

  const norm: Record<string, string> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val != null && val !== "") norm[prefillKey(k)] = String(val).trim();
  }
  const src = cfg.updateRecordSource ?? "url";
  const recordId = src === "url" ? norm.record ?? norm.recordid : norm[prefillKey(src)];
  if (!recordId || !REC_ID_RE.test(recordId)) return {};

  const token = await getAirtableToken(link.user_id, { admin: true });
  if (!token) return {};
  try {
    const rec = await getRecord({ token, baseId: cfg.baseId, tableId: cfg.tableId, recordId });
    const out: Record<string, string> = {};
    for (const [field, value] of Object.entries(rec.fields ?? {})) {
      const s = toStr(value);
      if (s) out[prefillKey(field)] = s;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Connected-record values for a COMPLETED submission, keyed by `${aliasKey}.${
 * fieldKey}`. Reads the submission's persisted source_record_ids (set at submit)
 * and fetches each connected record server-side. Used by the notification layer
 * to resolve {{alias.Field}} tokens in message bodies and to route to a phone /
 * email pulled from a connected record. Fails closed.
 */
export async function getSubmissionSourceValues(uploadId: string): Promise<Record<string, string>> {
  const admin = getSupabaseAdmin();
  const { data: up } = await admin
    .from("uploads")
    .select("user_id, upload_link_id, source_record_ids")
    .eq("id", uploadId)
    .maybeSingle();
  const upload = up as
    | { user_id: string; upload_link_id: string; source_record_ids: Record<string, string> | null }
    | null;
  const recordIds = upload?.source_record_ids ?? {};
  if (!upload || Object.keys(recordIds).length === 0) return {};

  const { data: linkData } = await admin
    .from("upload_links")
    .select("airtable_config")
    .eq("id", upload.upload_link_id)
    .maybeSingle();
  const cfg = (linkData as { airtable_config: AirtableConfig | null } | null)?.airtable_config;
  const sources = cfg?.recordSources ?? [];
  if (!cfg?.baseId || sources.length === 0) return {};

  const token = await getAirtableToken(upload.user_id, { admin: true });
  if (!token) return {};

  const out: Record<string, string> = {};
  await Promise.all(
    sources.map(async (src) => {
      const aliasKey = prefillKey(src.alias || "");
      const recordId = recordIds[aliasKey];
      if (!src.tableId || !recordId) return;
      try {
        const rec = await getRecord({ token, baseId: cfg.baseId, tableId: src.tableId, recordId });
        for (const [field, value] of Object.entries(rec.fields ?? {})) {
          const s = toStr(value);
          if (s) out[`${aliasKey}.${prefillKey(field)}`] = s;
        }
      } catch {
        /* fail closed */
      }
    }),
  );
  return out;
}

/** getUpdateTargetValues, loading the link by slug (public page). */
export async function getUpdateTargetValuesBySlug(
  slug: string,
  params: Record<string, string | string[] | undefined>,
): Promise<Record<string, string>> {
  let link: UploadLinkRow | null;
  try {
    link = await getLinkBySlugAdmin(slug);
  } catch {
    return {};
  }
  if (!link) return {};
  return getUpdateTargetValues(link, params);
}

/**
 * Write a single value into one field of a connected-source Airtable record.
 * Used to cache an app-created Drive folder id back onto the property record so
 * later submissions reuse the same folder. Best-effort — never throws.
 */
export async function writeAirtableField(args: {
  userId: string;
  baseId: string;
  tableId: string;
  recordId: string;
  field: string;
  value: string;
}): Promise<boolean> {
  try {
    if (!args.baseId || !args.tableId || !args.recordId || !args.field) return false;
    const token = await getAirtableToken(args.userId, { admin: true });
    if (!token) return false;
    await updateRecord({
      token,
      baseId: args.baseId,
      tableId: args.tableId,
      recordId: args.recordId,
      fields: { [args.field]: args.value },
    });
    return true;
  } catch {
    return false;
  }
}
