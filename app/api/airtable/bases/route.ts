/**
 * GET /api/airtable/bases
 *
 * List the bases the connected token can see, for the link-form base picker.
 *
 * 200 { bases: [{ id, name }] }
 * 404 not_connected
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getAirtableToken } from "@/lib/airtable/connection";
import { listBases } from "@/lib/airtable/client";

export async function GET() {
  const user = await requireUser();

  const token = await getAirtableToken(user.id);
  if (!token) {
    return NextResponse.json({ error: "not_connected" }, { status: 404 });
  }

  try {
    const bases = await listBases(token);
    return NextResponse.json({ bases: bases.map((b) => ({ id: b.id, name: b.name })) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[airtable/bases] failed:", err);
    return NextResponse.json({ error: "airtable_error" }, { status: 502 });
  }
}
