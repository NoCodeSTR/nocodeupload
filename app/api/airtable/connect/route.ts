/**
 * POST   /api/airtable/connect   — save + validate an Airtable Personal Access Token
 * DELETE /api/airtable/connect   — disconnect Airtable
 *
 * The PAT is validated with a /meta/whoami call before we store it (encrypted),
 * so a bad token surfaces immediately rather than at upload time.
 *
 * POST body: { token }
 * 200 { ok: true, email? }
 * 400 invalid_request | invalid_token
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { airtableConnectSchema } from "@/lib/schemas";
import { airtableWhoami } from "@/lib/airtable/client";
import { saveAirtableToken, deleteAirtableConnection } from "@/lib/airtable/connection";

export async function POST(request: NextRequest) {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const parsed = airtableConnectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const token = parsed.data.token.trim();

  // Validate the token before persisting it.
  let email: string | undefined;
  try {
    const who = await airtableWhoami(token);
    email = who.email;
  } catch {
    return NextResponse.json(
      { error: "invalid_token", detail: "Airtable rejected that token. Check it has data.records:write and schema.bases:read scopes." },
      { status: 400 },
    );
  }

  try {
    await saveAirtableToken(user.id, token);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[airtable/connect] save failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, email });
}

export async function DELETE() {
  const user = await requireUser();
  try {
    await deleteAirtableConnection(user.id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[airtable/connect] delete failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
