/**
 * DELETE /api/connections/[id]
 *
 * Provider-agnostic disconnect. Looks up the connection, dispatches to the
 * provider adapter's `revoke()` (best-effort), then deletes the row.
 *
 * Returns 409 when the connection still has upload_links FK'd to it —
 * those links would break, so we force the user to delete the links first.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { disconnectConnection } from "@/lib/connections";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await requireUser();

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "Invalid connection id" }, { status: 400 });
  }

  const result = await disconnectConnection({
    userId: user.id,
    connectionId: params.id,
  });

  if (result.ok) {
    return NextResponse.json({ ok: true });
  }

  const status =
    result.errorCode === "not_found"
      ? 404
      : result.errorCode === "has_links"
        ? 409
        : 500;
  return NextResponse.json({ error: result.message }, { status });
}
