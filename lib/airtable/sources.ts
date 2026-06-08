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

/** A human label for any source key (built-in or "field:<Label>"). */
export function sourceLabel(key: string): string {
  if (key.startsWith("field:")) return key.slice("field:".length);
  return AIRTABLE_BUILTIN_SOURCES.find((s) => s.key === key)?.label ?? key;
}
