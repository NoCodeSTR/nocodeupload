/**
 * Retry backoff: min(base · 2^(attempt-1), cap) with full ±50% jitter, or the
 * handler-supplied retryAfterMs (Retry-After passthrough) clamped to [1s, cap].
 * Pure — no clock, no randomness source of its own beyond the injectable rng.
 */
import type { BackoffPolicy } from "./types";

export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 30_000, capMs: 30 * 60_000 };

export function backoffDelayMs(
  attempt: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
  retryAfterMs?: number,
  rng: () => number = Math.random,
): number {
  if (retryAfterMs !== undefined) {
    return Math.min(Math.max(retryAfterMs, 1_000), policy.capMs);
  }
  const exp = Math.min(policy.baseMs * 2 ** Math.max(attempt - 1, 0), policy.capMs);
  // Full jitter around the midpoint: uniform in [0.5·exp, 1.5·exp], capped.
  const jittered = exp * (0.5 + rng());
  return Math.min(Math.round(jittered), policy.capMs);
}
