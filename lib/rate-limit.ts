/**
 * DB-based rate limiting for the public upload endpoint — no external infra.
 *
 * We count rows in the `uploads` table (each initiate creates one) within a
 * time window, by uploader IP-hash and by link. Limits are deliberately
 * GENEROUS so legitimate bulk uploads (a cleaner sending 100 before/after
 * photos) sail through, while runaway automation or a flooded link gets
 * capped.
 *
 * Tuning: adjust the constants below. A future enhancement is per-link
 * configurable limits (stored on upload_links) and an index on
 * uploads(uploader_ip_hash, created_at) once volume grows.
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// Per visitor (IP-hash): generous enough for a large photo batch.
const PER_IP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const PER_IP_MAX = 150;

// Per link: stops a single link being flooded across many IPs.
const PER_LINK_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const PER_LINK_MAX = 500;

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: "ip" | "link"; retryAfterSeconds: number };

export async function checkUploadAllowed(args: {
  ipHash: string;
  linkId: string;
}): Promise<RateLimitResult> {
  const admin = getSupabaseAdmin();

  // Per-IP window.
  const sinceIp = new Date(Date.now() - PER_IP_WINDOW_MS).toISOString();
  const { count: ipCount, error: ipErr } = await admin
    .from("uploads")
    .select("id", { count: "exact", head: true })
    .eq("uploader_ip_hash", args.ipHash)
    .gte("created_at", sinceIp);

  // Fail OPEN on a counting error — never block a legit upload because the
  // limiter query hiccuped (log-and-allow). Abuse protection shouldn't become
  // an availability risk.
  if (ipErr) {
    // eslint-disable-next-line no-console
    console.warn("[rate-limit] ip count failed, allowing:", ipErr.message);
    return { allowed: true };
  }
  if ((ipCount ?? 0) >= PER_IP_MAX) {
    return { allowed: false, reason: "ip", retryAfterSeconds: Math.ceil(PER_IP_WINDOW_MS / 1000) };
  }

  // Per-link window.
  const sinceLink = new Date(Date.now() - PER_LINK_WINDOW_MS).toISOString();
  const { count: linkCount, error: linkErr } = await admin
    .from("uploads")
    .select("id", { count: "exact", head: true })
    .eq("upload_link_id", args.linkId)
    .gte("created_at", sinceLink);

  if (linkErr) {
    // eslint-disable-next-line no-console
    console.warn("[rate-limit] link count failed, allowing:", linkErr.message);
    return { allowed: true };
  }
  if ((linkCount ?? 0) >= PER_LINK_MAX) {
    return { allowed: false, reason: "link", retryAfterSeconds: Math.ceil(PER_LINK_WINDOW_MS / 1000) };
  }

  return { allowed: true };
}
