/**
 * webhook.deliver handler contract tests — deps injected, no Supabase.
 * Run through the real engine + memory store so the outcomes' effects
 * (retry scheduling, dead-lettering) are asserted end to end.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createJobsEngine } from "@/lib/engine/jobs/engine";
import { createWebhookDeliverHandler, type WebhookDeliverDeps } from "@/lib/jobs-handlers/webhook-deliver";
import type { ClassifiedWebhookResult } from "@/lib/webhook";
import { createMemoryStore, type MemoryJobsStore } from "./memory-store";

const UPLOAD_ID = "11111111-1111-4111-8111-111111111111";

let clock = new Date("2026-07-20T00:00:00Z");
const now = () => clock;

function sent(): ClassifiedWebhookResult {
  return { result: { status: "sent", target: "hooks.test" }, retry: { retryable: false } };
}
function failed(detail: string, retryable: boolean, retryAfterMs?: number): ClassifiedWebhookResult {
  return { result: { status: "failed", target: "hooks.test", detail }, retry: { retryable, retryAfterMs } };
}

interface Harness {
  store: MemoryJobsStore;
  logged: Array<{ status: string; jobId: string }>;
  calls: number;
}

function makeHarness(sendImpl: (h: Harness) => ClassifiedWebhookResult, opts?: { alreadySent?: boolean; ownerMissing?: boolean }) {
  const h: Harness = { store: createMemoryStore(now), logged: [], calls: 0 };
  const deps: WebhookDeliverDeps = {
    sendSingle: async (_u, _jobId) => { h.calls++; return sendImpl(h); },
    sendBatch: async () => { throw new Error("not under test"); },
    loadOwner: async () => (opts?.ownerMissing ? null : { userId: "user-1", uploadLinkId: "link-1" }),
    logDelivery: async (args) => { h.logged.push({ status: args.result.status, jobId: args.jobId }); },
    hasSentDelivery: async () => Boolean(opts?.alreadySent),
  };
  const engine = createJobsEngine({
    store: h.store,
    handlers: [createWebhookDeliverHandler(deps)],
    inlineExecution: true,
    visibilityTimeoutMs: 120_000,
    now,
  });
  return { h, engine };
}

const enqueueArgs = {
  type: "webhook.deliver",
  payload: { v: 1, mode: "single", uploadId: UPLOAD_ID },
  idempotencyKey: `webhook.deliver:upload:${UPLOAD_ID}`,
  userId: "user-1",
};

beforeEach(() => { clock = new Date("2026-07-20T00:00:00Z"); });

describe("webhook.deliver handler", () => {
  it("sent ⇒ job succeeds, delivery logged with job id", async () => {
    const { h, engine } = makeHarness(() => sent());
    const { jobId } = await engine.enqueue(enqueueArgs);
    expect(h.store.jobs.get(jobId)!.status).toBe("succeeded");
    expect(h.logged).toEqual([{ status: "sent", jobId }]);
  });

  it("503 ⇒ retry scheduled; endpoint recovery ⇒ succeeds on sweep", async () => {
    let healthy = false;
    const { h, engine } = makeHarness(() => (healthy ? sent() : failed("responded 503", true)));
    const { jobId } = await engine.enqueue(enqueueArgs);
    expect(h.store.jobs.get(jobId)!.status).toBe("pending"); // retry scheduled
    healthy = true;
    clock = new Date(clock.getTime() + 60 * 60_000);
    await engine.runSweep("w");
    expect(h.store.jobs.get(jobId)!.status).toBe("succeeded");
    expect(h.calls).toBe(2);
    expect(h.logged.map((l) => l.status)).toEqual(["failed", "sent"]);
  });

  it("400 ⇒ permanent dead after one attempt, no retry", async () => {
    const { h, engine } = makeHarness(() => failed("responded 400", false));
    const { jobId } = await engine.enqueue(enqueueArgs);
    const j = h.store.jobs.get(jobId)!;
    expect(j.status).toBe("dead");
    expect(j.attempts).toBe(1);
  });

  it("429 Retry-After is honored in scheduling", async () => {
    const { h, engine } = makeHarness(() => failed("responded 429", true, 45_000));
    const { jobId } = await engine.enqueue(enqueueArgs);
    const j = h.store.jobs.get(jobId)!;
    const delayMs = Date.parse(j.run_after) - clock.getTime();
    expect(delayMs).toBe(45_000);
  });

  it("unsafe URL ⇒ permanent with customer-facing message", async () => {
    const { h, engine } = makeHarness(() => ({
      result: { status: "skipped", target: "internal", detail: "unsafe webhook URL" },
      retry: { retryable: false },
      unsafeUrl: true,
    }));
    const { jobId } = await engine.enqueue(enqueueArgs);
    expect(h.store.jobs.get(jobId)!.status).toBe("dead");
    expect(h.store.jobs.get(jobId)!.last_error).toMatch(/fire-time safety/);
  });

  it("ordinary skip (no webhook configured) ⇒ success, nothing to retry", async () => {
    const { h, engine } = makeHarness(() => ({
      result: { status: "skipped", detail: "no webhook configured" },
      retry: { retryable: false },
    }));
    const { jobId } = await engine.enqueue(enqueueArgs);
    expect(h.store.jobs.get(jobId)!.status).toBe("succeeded");
  });

  it("crash-after-send guard: prior 'sent' delivery ⇒ success WITHOUT re-POSTing", async () => {
    const { h, engine } = makeHarness(() => sent(), { alreadySent: true });
    const { jobId } = await engine.enqueue(enqueueArgs);
    expect(h.store.jobs.get(jobId)!.status).toBe("succeeded");
    expect(h.calls).toBe(0); // the external effect was NOT repeated
  });

  it("vanished upload ⇒ permanent", async () => {
    const { h, engine } = makeHarness(() => sent(), { ownerMissing: true });
    const { jobId } = await engine.enqueue(enqueueArgs);
    expect(h.store.jobs.get(jobId)!.status).toBe("dead");
    expect(h.calls).toBe(0);
  });

  it("duplicate enqueue (chunk-finalize vs batch-complete race) ⇒ one job, one send", async () => {
    const { h, engine } = makeHarness(() => sent());
    await engine.enqueue(enqueueArgs);
    await engine.enqueue(enqueueArgs);
    expect(h.store.jobs.size).toBe(1);
    expect(h.calls).toBe(1);
  });
});
