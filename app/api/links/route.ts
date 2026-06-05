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
import { isPubliclySafeHttpUrl } from "@/lib/url-safety";

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

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

  // SSRF guard on the user-provided webhook URL.
  if (parsed.data.webhookUrl) {
    const check = isPubliclySafeHttpUrl(parsed.data.webhookUrl);
    if (!check.safe) {
      return NextResponse.json({ error: "invalid_webhook", reason: check.reason }, { status: 400 });
    }
  }
  if (parsed.data.successRedirectUrl && !isHttpUrl(parsed.data.successRedirectUrl)) {
    return NextResponse.json({ error: "invalid_redirect" }, { status: 400 });
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
