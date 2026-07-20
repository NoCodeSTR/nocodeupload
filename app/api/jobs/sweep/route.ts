/**
 * GET /api/jobs/sweep — the Jobs Engine recovery sweeper (ADR-19).
 *
 * Invoked by Vercel Cron every minute (vercel.json). Recovers stale claims,
 * then claims and executes due jobs (retries + delayed work). The inline path
 * handles the happy case; this endpoint is the durability guarantee.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically
 * when the CRON_SECRET env var is set. Fail closed: no secret configured ⇒ 503.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getJobs, jobsEnabled } from "@/lib/jobs";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!jobsEnabled()) {
    return NextResponse.json({ ok: true, skipped: "jobs_engine_disabled" });
  }

  try {
    const worker = `sweep:${Date.now().toString(36)}`;
    const stats = await getJobs().runSweep(worker);
    // eslint-disable-next-line no-console
    console.log(
      `[jobs] sweep worker=${worker} recovered=${stats.recovered} claimed=${stats.claimed} succeeded=${stats.succeeded} retried=${stats.retried} dead=${stats.dead}`,
    );
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[jobs] sweep failed:", err);
    return NextResponse.json({ error: "sweep_failed" }, { status: 500 });
  }
}
