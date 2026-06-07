/**
 * DELETE /api/projects/[id] — delete a project. Links in it are unassigned
 * automatically (FK ON DELETE SET NULL). Owner-scoped.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { deleteProject } from "@/lib/projects";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    await deleteProject({ userId: user.id, id: params.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[DELETE /api/projects/[id]] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
