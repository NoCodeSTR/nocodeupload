/**
 * PATCH  /api/links/[id] — edit a link or toggle its active state.
 * DELETE /api/links/[id] — delete a link (uploads cascade).
 *
 * Auth: requireUser(). Both verify ownership (the helpers scope by user_id).
 * PATCH body is validated with uploadLinkUpdateSchema (all fields optional),
 * so a simple { isActive: false } toggle is a valid PATCH.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { uploadLinkUpdateSchema } from "@/lib/schemas";
import { updateLink, deleteLink } from "@/lib/links";
import { isPubliclySafeHttpUrl } from "@/lib/url-safety";

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await requireUser();
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const parsed = uploadLinkUpdateSchema.safeParse(body);
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
    const link = await updateLink({ userId: user.id, linkId: params.id, input: parsed.data });
    return NextResponse.json({ link });
  } catch (err) {
    if (err instanceof Error && err.message === "LINK_NOT_FOUND") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (err instanceof Error && err.message === "CONNECTION_NOT_FOUND") {
      return NextResponse.json({ error: "connection_not_found" }, { status: 404 });
    }
    // eslint-disable-next-line no-console
    console.error("[PATCH /api/links/[id]] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await requireUser();
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    await deleteLink({ userId: user.id, linkId: params.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[DELETE /api/links/[id]] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
