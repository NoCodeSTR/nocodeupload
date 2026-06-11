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
import { getAirtableToken } from "@/lib/airtable/connection";
import { getRecord } from "@/lib/airtable/client";
import { getLinkBySlugAdmin } from "@/lib/links";
import { prefillKey } from "@/lib/filename";
import type { UploadLinkRow } from "@/lib/db-types";

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
 * Multi-table record sources: for each declared source on the link, read its
 * recordId from the URL (by the source's alias key) and pull ONLY the declared
 * fields, returned under namespaced keys `${aliasKey}.${fieldKey}` so they line
 * up with {{alias.Field}} merge tags (renderMergeTags normalizes both sides via
 * prefillKey). All sources share the link's base.
 *
 * Security: only fields the owner explicitly selected are fetched and surfaced
 * (they ride to the browser as merge values), so a source with no selected
 * fields pulls nothing. Uses the owner's token; fails closed per source.
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
  if (!link || !cfg?.enabled || !cfg.baseId || sources.length === 0) return {};

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
      const allowed = new Set((src.fields ?? []).filter(Boolean));
      if (!src.tableId || !src.alias || allowed.size === 0) return;
      const aliasKey = prefillKey(src.alias);
      const recordId = normParams[aliasKey];
      if (!recordId || !REC_ID_RE.test(recordId)) return;
      try {
        const rec = await getRecord({ token, baseId: cfg.baseId, tableId: src.tableId, recordId });
        for (const [field, value] of Object.entries(rec.fields ?? {})) {
          if (!allowed.has(field)) continue; // only owner-declared fields leave Airtable
          const s = toStr(value);
          if (s) out[`${aliasKey}.${prefillKey(field)}`] = s;
        }
      } catch {
        /* fail closed — a missing record / scope never blocks the page */
      }
    }),
  );
  return out;
}
