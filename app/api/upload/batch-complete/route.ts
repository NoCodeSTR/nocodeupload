/**
 * POST /api/upload/batch-complete
 *
 * Anonymous endpoint. The browser calls this once it finishes uploading every
 * file in a multi-file submission, passing the batch id it generated. This is
 * the authoritative "the batch is done" trigger for the bundled notification —
 * it also covers cases where a file's initiate failed (so the count-based path
 * in the chunk route can never reach the declared size).
 *
 * Best-effort: the bundled send is deduped by an atomic claim, so calling this
 * after the chunk route already sent is a harmless no-op.
 *
 * Body: { batchId }
 * 200 { ok: true }
 * 400 invalid_request
 */
import { NextResponse, type NextRequest } from "next/server";
import { finalizeBatchFromClient } from "@/lib/batch";
import { finalizeAirtableBatchFromClient } from "@/lib/airtable/record";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const batchId = (body as { batchId?: unknown })?.batchId;
  if (typeof batchId !== "string" || !UUID_RE.test(batchId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // Airtable per-batch record FIRST (authoritative trigger; deduped by claim) so
  // the record id is persisted before the bundled notification/webhook fires and
  // can be included in the webhook payload.
  try {
    await finalizeAirtableBatchFromClient(batchId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[upload/batch-complete] airtable record failed:", err);
  }

  try {
    await finalizeBatchFromClient(batchId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[upload/batch-complete] failed:", err);
    // Still 200 — notifications are best-effort and must never block the UI.
  }

  return NextResponse.json({ ok: true });
}
