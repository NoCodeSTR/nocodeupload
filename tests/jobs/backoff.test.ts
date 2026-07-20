import { describe, it, expect } from "vitest";
import { backoffDelayMs, DEFAULT_BACKOFF } from "@/lib/engine/jobs/backoff";

describe("backoffDelayMs", () => {
  it("doubles per attempt around the midpoint (rng=0.5 → exact exponential)", () => {
    const rng = () => 0.5;
    expect(backoffDelayMs(1, DEFAULT_BACKOFF, undefined, rng)).toBe(30_000);
    expect(backoffDelayMs(2, DEFAULT_BACKOFF, undefined, rng)).toBe(60_000);
    expect(backoffDelayMs(3, DEFAULT_BACKOFF, undefined, rng)).toBe(120_000);
  });

  it("caps at capMs regardless of attempt and jitter", () => {
    expect(backoffDelayMs(20, DEFAULT_BACKOFF, undefined, () => 1)).toBe(DEFAULT_BACKOFF.capMs);
  });

  it("jitter stays within [0.5x, 1.5x] of the exponential", () => {
    for (const r of [0, 0.25, 0.75, 0.999]) {
      const d = backoffDelayMs(2, DEFAULT_BACKOFF, undefined, () => r);
      expect(d).toBeGreaterThanOrEqual(30_000);
      expect(d).toBeLessThanOrEqual(90_000);
    }
  });

  it("honors retryAfterMs, clamped to [1s, cap]", () => {
    expect(backoffDelayMs(1, DEFAULT_BACKOFF, 5_000)).toBe(5_000);
    expect(backoffDelayMs(1, DEFAULT_BACKOFF, 10)).toBe(1_000);
    expect(backoffDelayMs(1, DEFAULT_BACKOFF, 10 ** 9)).toBe(DEFAULT_BACKOFF.capMs);
  });
});
