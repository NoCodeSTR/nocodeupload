/**
 * GET /api/airtable/records
 *
 * Owner-authenticated record lookups for the builder's Preview Mode (and, later,
 * the uploader record picker).
 *
 *  ?baseId=&tableId=&primaryField=&q=   → list mode: { records: [{ id, label }] }
 *      (label = the primary field value; q does a primary-field SEARCH; capped)
 *  ?baseId=&tableId=&recordId=          → single mode: { record: { id, fields } }
 *
 * 400 invalid_request | 404 not_connected | 502 airtable_error
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getAirtableToken } from "@/lib/airtable/connection";
import { listRecords, getRecord } from "@/lib/airtable/client";

const REC_ID_RE = /^rec[A-Za-z0-9]{6,}$/;

/** Best-effort human label for a record's primary-field value. */
function cellToLabel(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "Yes" : "";
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        if (x == null) return "";
        if (typeof x === "string" || typeof x === "number") return String(x);
        if (typeof x === "object") return String((x as Record<string, unknown>).name ?? "");
        return "";
      })
      .filter(Boolean)
      .join(", ");
  }
  if (typeof v === "object") return String((v as Record<string, unknown>).name ?? "");
  return "";
}

export async function GET(request: NextRequest) {
  const user = await requireUser();
  const sp = new URL(request.url).searchParams;
  const baseId = sp.get("baseId") ?? "";
  const tableId = sp.get("tableId") ?? "";
  const recordId = sp.get("recordId");
  const primaryField = sp.get("primaryField") ?? "";
  const q = (sp.get("q") ?? "").trim();

  if (!baseId || baseId.length > 60 || !tableId || tableId.length > 60) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const token = await getAirtableToken(user.id);
  if (!token) {
    return NextResponse.json({ error: "not_connected" }, { status: 404 });
  }

  try {
    // Single mode: fetch one record's full fields (for substitution).
    if (recordId) {
      if (!REC_ID_RE.test(recordId)) {
        return NextResponse.json({ error: "invalid_request" }, { status: 400 });
      }
      const rec = await getRecord({ token, baseId, tableId, recordId });
      return NextResponse.json({ record: { id: rec.id, fields: rec.fields ?? {} } });
    }

    // List mode: id + primary-field label (cheap — only the label field).
    const safePrimary = primaryField && !/[{}]/.test(primaryField) ? primaryField : "";
    const filterByFormula =
      q && safePrimary
        ? `SEARCH(LOWER("${q.replace(/["\\]/g, "").slice(0, 100)}"), LOWER({${safePrimary}} & ""))`
        : undefined;
    const records = await listRecords({
      token,
      baseId,
      tableId,
      fields: safePrimary ? [safePrimary] : undefined,
      maxRecords: 25,
      filterByFormula,
    });
    const out = records.map((r) => ({
      id: r.id,
      label: (safePrimary ? cellToLabel(r.fields?.[safePrimary]) : "") || r.id,
    }));
    return NextResponse.json({ records: out });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[airtable/records] failed:", err);
    return NextResponse.json({ error: "airtable_error" }, { status: 502 });
  }
}
