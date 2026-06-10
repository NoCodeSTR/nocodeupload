/**
 * Airtable deep-link builder — isomorphic (no secrets, no server-only).
 *
 * Builds the canonical airtable.com URL that opens a specific record's expanded
 * view: https://airtable.com/{baseId}/{tableId}/{recordId}. Used to surface the
 * created/updated record on the submission detail page and in webhook payloads
 * so owners can jump straight from a submission to its Airtable row.
 *
 * Returns null unless all three ids are present and well-formed, so callers can
 * conditionally render the link without extra guards.
 */
const BASE_RE = /^app[A-Za-z0-9]{6,}$/;
const TABLE_RE = /^tbl[A-Za-z0-9]{6,}$/;
const REC_RE = /^rec[A-Za-z0-9]{6,}$/;

export function airtableRecordUrl(
  baseId: string | null | undefined,
  tableId: string | null | undefined,
  recordId: string | null | undefined,
): string | null {
  if (!baseId || !tableId || !recordId) return null;
  if (!BASE_RE.test(baseId) || !TABLE_RE.test(tableId) || !REC_RE.test(recordId)) return null;
  return `https://airtable.com/${baseId}/${tableId}/${recordId}`;
}
