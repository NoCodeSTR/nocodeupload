import { describe, it, expect } from "vitest";
import { classifyHttpFailure, parseRetryAfterMs } from "@/lib/webhook-classify";

describe("classifyHttpFailure", () => {
  it("5xx / 408 / 429 are retryable", () => {
    expect(classifyHttpFailure(500).retryable).toBe(true);
    expect(classifyHttpFailure(503).retryable).toBe(true);
    expect(classifyHttpFailure(408).retryable).toBe(true);
    expect(classifyHttpFailure(429).retryable).toBe(true);
  });
  it("other 4xx are permanent", () => {
    for (const s of [400, 401, 403, 404, 410, 422]) {
      expect(classifyHttpFailure(s).retryable).toBe(false);
    }
  });
  it("passes Retry-After through on 429", () => {
    expect(classifyHttpFailure(429, "30").retryAfterMs).toBe(30_000);
  });
});

describe("parseRetryAfterMs", () => {
  it("parses seconds", () => {
    expect(parseRetryAfterMs("15")).toBe(15_000);
  });
  it("parses an HTTP date in the future", () => {
    const future = new Date(Date.now() + 60_000).toUTCString();
    const ms = parseRetryAfterMs(future)!;
    expect(ms).toBeGreaterThan(50_000);
    expect(ms).toBeLessThanOrEqual(61_000);
  });
  it("ignores garbage and past dates", () => {
    expect(parseRetryAfterMs("soon")).toBeUndefined();
    expect(parseRetryAfterMs(new Date(Date.now() - 60_000).toUTCString())).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
  });
});
