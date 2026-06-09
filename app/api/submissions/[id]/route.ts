/**
 * PATCH /api/submissions/[id]
 *
 * Owner edits a submission's operational status (new / in_progress / done /
 * archived) or tags from the inbox. RLS scopes the write to the owner.
 *
 * Body: { status?, tags? }
 * 200 { ok: true } | 400 invalid_request | 404 not_found
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { submissionUpdateSchema } from "@/lib/schemas";
import { updateSubmission } from "@/lib/submissions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
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
  const parsed = submissionUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    await updateSubmission(user.id, params.id, parsed.data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[submissions PATCH] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
