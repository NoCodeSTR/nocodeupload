/**
 * GET /api/airtable/tables?baseId=...
 *
 * List a base's tables and their fields, for the link-form table + field-mapping
 * pickers.
 *
 * 200 { tables: [{ id, name, fields: [{ id, name, type }] }] }
 * 400 invalid_request | 404 not_connected
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getAirtableToken } from "@/lib/airtable/connection";
import { listTables } from "@/lib/airtable/client";

export async function GET(request: NextRequest) {
  const user = await requireUser();

  const baseId = new URL(request.url).searchParams.get("baseId") ?? "";
  if (!baseId || baseId.length > 60) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const token = await getAirtableToken(user.id);
  if (!token) {
    return NextResponse.json({ error: "not_connected" }, { status: 404 });
  }

  try {
    const tables = await listTables(token, baseId);
    return NextResponse.json({ tables });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[airtable/tables] failed:", err);
    return NextResponse.json({ error: "airtable_error" }, { status: 502 });
  }
}
