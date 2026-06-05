/**
 * POST /api/links/[id]/duplicate
 *
 * Duplicate one of the user's links into a new draft (fresh slug + signing
 * secret, "Copy of …" name) and return the new link id so the client can
 * redirect to its edit page. Ownership is enforced by the helper (scoped by
 * user_id); a link that isn't the user's 404s.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { duplicateLink } from "@/lib/links";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await requireUser();
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const link = await duplicateLink({ userId: user.id, linkId: params.id });
    return NextResponse.json({ id: link.id });
  } catch (err) {
    if (err instanceof Error && err.message === "LINK_NOT_FOUND") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    // eslint-disable-next-line no-console
    console.error("[POST /api/links/[id]/duplicate] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
