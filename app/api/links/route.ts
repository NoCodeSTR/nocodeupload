/**
 * POST /api/links — create a new upload link.
 *
 * Auth: requireUser(). Body validated with uploadLinkCreateSchema. The chosen
 * storage connection must belong to the user (enforced in createLink()).
 *
 * 201 { link }                         — created
 * 400 { error: "invalid_request", issues } — bad body
 * 404 { error: "connection_not_found" }    — connection isn't the user's
 * 500 { error }                            — unexpected
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { uploadLinkCreateSchema } from "@/lib/schemas";
import { createLink } from "@/lib/links";

export async function POST(request: NextRequest) {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const parsed = uploadLinkCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const link = await createLink(user.id, parsed.data);
    return NextResponse.json({ link }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "CONNECTION_NOT_FOUND") {
      return NextResponse.json({ error: "connection_not_found" }, { status: 404 });
    }
    // eslint-disable-next-line no-console
    console.error("[POST /api/links] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
