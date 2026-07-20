import { describe, it, expect } from "vitest";
import { redactError, assertPayloadSafe } from "@/lib/engine/jobs/redact";

describe("redactError", () => {
  it("strips bearer tokens and authorization headers", () => {
    const out = redactError('failed: Authorization: Bearer abc.def-123 sent to host');
    expect(out).not.toContain("abc.def-123");
  });
  it("strips query-string credentials", () => {
    const out = redactError("GET https://x.test/hook?token=supersecret&x=1 failed");
    expect(out).not.toContain("supersecret");
    expect(out).toContain("token=[redacted]");
  });
  it("strips secret-shaped JSON fields", () => {
    const out = redactError('body: {"api_key": "sk-12345", "ok": true}');
    expect(out).not.toContain("sk-12345");
  });
  it("truncates to 1000 chars", () => {
    expect(redactError("x".repeat(5000)).length).toBeLessThanOrEqual(1001);
  });
});

describe("assertPayloadSafe", () => {
  it("accepts entity-reference payloads", () => {
    expect(() => assertPayloadSafe({ v: 1, uploadId: "u1", nested: { batchId: "b1" } })).not.toThrow();
  });
  it("rejects secret-shaped keys at any depth", () => {
    expect(() => assertPayloadSafe({ v: 1, accessToken: "x" })).toThrow(/secret-shaped/);
    expect(() => assertPayloadSafe({ v: 1, cfg: { webhook_secret: "x" } })).toThrow(/secret-shaped/);
  });
});
