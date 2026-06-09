/**
 * POST /api/submissions/[id]/retry
 *
 * Re-runs delivery for a submission whose notifications or Airtable record
 * failed. It re-runs the notification dispatch (re-sending to the matched
 * destinations) and, if the Airtable record failed and never succeeded, clears
 * the single-create claim and re-creates it.
 *
 * Note: re-running dispatch re-sends to ALL matched destinations for the
 * submission (the per-attempt log doesn't carry the secrets needed to re-send a
 * single channel), so the UI confirms before calling this.
 *
 * 200 { ok: true } | 404 not_found
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { deliverForUpload, deliverForBatch } from "@/lib/notifications/dispatch";
import { recordAfterUpload } from "@/lib/airtable/record";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const maxDuration = 60;

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // Ownership check via RLS.
  const supabase = createSupabaseServerClient();
  const { data: subData } = await supabase
    .from("submissions")
    .select("id, batch_id")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();
  const sub = subData as { id: string; batch_id: string | null } | null;
  if (!sub) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const admin = getSupabaseAdmin();
  const { data: upData } = await admin
    .from("uploads")
    .select("id, status")
    .eq("submission_id", params.id);
  const uploads = (upData ?? []) as Array<{ id: string; status: string }>;
  const completed = uploads.filter((u) => u.status === "complete");
  const uploadIds = uploads.map((u) => u.id);

  // Gather this submission's deliveries (keyed by batch or by upload).
  const deliveries: Array<{ channel: string; status: string }> = [];
  if (sub.batch_id) {
    const { data } = await admin
      .from("notification_deliveries")
      .select("channel, status")
      .eq("batch_id", sub.batch_id);
    deliveries.push(...((data ?? []) as Array<{ channel: string; status: string }>));
  }
  if (uploadIds.length > 0) {
    const { data } = await admin
      .from("notification_deliveries")
      .select("channel, status")
      .in("upload_id", uploadIds);
    deliveries.push(...((data ?? []) as Array<{ channel: string; status: string }>));
  }
  const airtable = deliveries.filter((d) => d.channel === "airtable");
  const airtableSent = airtable.some((d) => d.status === "sent");
  const airtableFailed = airtable.some((d) => d.status === "failed");

  try {
    // Retry Airtable only if it failed and never succeeded (avoid duplicates):
    // clear the single-create claim, then re-run per completed file. The claim
    // dedupes per_upload vs per_batch internally.
    if (airtableFailed && !airtableSent) {
      await admin
        .from("uploads")
        .update({ airtable_recorded_at: null } as never)
        .eq("submission_id", params.id);
      for (const u of completed) {
        await recordAfterUpload(u.id);
      }
    }

    // Re-run notifications for the submission.
    if (sub.batch_id) {
      await deliverForBatch(sub.batch_id);
    } else if (completed[0]) {
      await deliverForUpload(completed[0].id);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[submissions retry] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
