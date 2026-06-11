/**
 * Airtable field-mapping source vocabulary (isomorphic).
 *
 * A "source" is a piece of upload context we can write into an Airtable field.
 * The link-form editor uses this list to render the mapping dropdowns; the
 * server-side record builder (lib/airtable/record.ts) resolves each key to a
 * value. Custom fields are addressed dynamically as "field:<Label>".
 */

export interface AirtableSourceDef {
  key: string;
  label: string;
  /** Hint shown in the editor. */
  hint?: string;
}

/** Built-in sources, in display order. */
export const AIRTABLE_BUILTIN_SOURCES: AirtableSourceDef[] = [
  { key: "link", label: "File link", hint: "Drive / YouTube URL (batch: one per line)" },
  { key: "filename", label: "File name", hint: "Final (templated) name" },
  { key: "filetype", label: "File type", hint: "image / video / pdf / …" },
  { key: "size", label: "File size", hint: "e.g. 4.2 MB" },
  { key: "name", label: "Uploader name" },
  { key: "email", label: "Uploader email" },
  { key: "message", label: "Message / notes" },
  { key: "date", label: "Upload date", hint: "YYYY-MM-DD" },
  { key: "count", label: "Number of files", hint: "Useful in per-batch mode" },
];

/** The mapping key for a custom field, derived from its label. */
export function customFieldSourceKey(label: string): string {
  return `field:${label}`;
}

// --- Record sources (other-table references) ---------------------------------
// Mapping keys for pulling another table's record into the destination row:
//   ref:<aliasKey>            → the source RECORD itself (write [recordId] into a
//                               linked-record field on the destination).
//   ref:<aliasKey>:<Field>    → a pulled VALUE from the source record (copy into
//                               any destination field).
// aliasKey is the prefill-key form of the source alias (no colons), so parsing
// on the first colon after the prefix is unambiguous; the field name is the
// remainder (it may itself contain colons).
import { prefillKey } from "@/lib/filename";
import type { RecordSource, AirtableFieldMapping } from "@/lib/db-types";

/**
 * Canonical, destination-oriented field mappings for a config. Prefers the new
 * `fieldMappings` (destination field → value source); when it's undefined (a
 * legacy config), converts the old `mapping` (source key → destination field).
 * An explicit empty `fieldMappings` array means "saved with the new editor, no
 * mappings" and is NOT overridden by legacy data.
 */
export function getFieldMappings(cfg: {
  fieldMappings?: AirtableFieldMapping[];
  mapping?: Record<string, string>;
}): AirtableFieldMapping[] {
  if (cfg.fieldMappings !== undefined) {
    return cfg.fieldMappings.filter((m) => m.field && m.source);
  }
  const out: AirtableFieldMapping[] = [];
  for (const [source, field] of Object.entries(cfg.mapping ?? {})) {
    if (source && field) out.push({ field, source });
  }
  return out;
}

const REF_REC_ID_RE = /^rec[A-Za-z0-9]{6,}$/;

/** Mapping key that links a source record into a destination linked field. */
export function recordSourceLinkKey(aliasKey: string): string {
  return `ref:${aliasKey}`;
}

/** Mapping key that copies a pulled source value into a destination field. */
export function recordSourceValueKey(aliasKey: string, field: string): string {
  return `ref:${aliasKey}:${field}`;
}

/** Parse a ref: mapping key. Returns null for non-ref keys. */
export function parseRecordSourceKey(
  key: string,
): { aliasKey: string; field: string | null } | null {
  if (!key.startsWith("ref:")) return null;
  const rest = key.slice("ref:".length);
  const sep = rest.indexOf(":");
  if (sep === -1) return { aliasKey: rest, field: null };
  return { aliasKey: rest.slice(0, sep), field: rest.slice(sep + 1) };
}

/**
 * Resolve { aliasKey: recordId } from the link's record sources + the submit's
 * URL prefills. Used at submit time to persist which record each source points
 * at (uploads.source_record_ids). Only well-formed record ids are kept.
 */
export function resolveSourceRecordIds(
  sources: RecordSource[] | undefined,
  prefillValues: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!sources?.length || !prefillValues) return out;
  // Normalize prefill keys to prefill-key form so ?Cleaner_Record= still matches.
  const norm: Record<string, string> = {};
  for (const [k, v] of Object.entries(prefillValues)) {
    if (v != null && String(v).trim() !== "") norm[prefillKey(k)] = String(v).trim();
  }
  for (const s of sources) {
    const aliasKey = prefillKey(s.alias || "");
    const rec = aliasKey ? norm[aliasKey] : "";
    if (rec && REF_REC_ID_RE.test(rec)) out[aliasKey] = rec;
  }
  return out;
}

/** A human label for any source key (built-in, "field:<Label>", or "ref:…"). */
export function sourceLabel(key: string): string {
  if (key.startsWith("field:")) return key.slice("field:".length);
  const ref = parseRecordSourceKey(key);
  if (ref) return ref.field ? `${ref.aliasKey} · ${ref.field}` : `${ref.aliasKey} (record link)`;
  return AIRTABLE_BUILTIN_SOURCES.find((s) => s.key === key)?.label ?? key;
}
