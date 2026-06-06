/**
 * DELETE /api/notifications/destinations/[id] — remove a destination.
 * Ownership is enforced by the helper (scoped by user_id).
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { deleteDestination } from "@/lib/notifications/destinations";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    await deleteDestination({ userId: user.id, id: params.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[DELETE /api/notifications/destinations/[id]] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
