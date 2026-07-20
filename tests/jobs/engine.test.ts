import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { createJobsEngine, type JobsEngine } from "@/lib/engine/jobs/engine";
import type { JobHandler, JobOutcome } from "@/lib/engine/jobs/types";
import { createMemoryStore, type MemoryJobsStore } from "./memory-store";

// Controllable clock so retry scheduling and staleness are deterministic.
let clock = new Date("2026-07-20T00:00:00Z");
const now = () => clock;
const advance = (ms: number) => { clock = new Date(clock.getTime() + ms); };

function testHandler(type: string, impl: () => Promise<JobOutcome> | JobOutcome): JobHandler {
  return {
    type,
    payloadSchema: z.object({ v: z.number(), ref: z.string().optional() }),
    run: async () => impl(),
  };
}

function build(store: MemoryJobsStore, handlers: JobHandler[], inline = true): JobsEngine {
  return createJobsEngine({ store, handlers, inlineExecution: inline, visibilityTimeoutMs: 120_000, now });
}

let store: MemoryJobsStore;
beforeEach(() => {
  clock = new Date("2026-07-20T00:00:00Z");
  store = createMemoryStore(now);
});

const base = { payload: { v: 1 }, userId: "user-1" };

describe("enqueue idempotency", () => {
  it("same key twice ⇒ one job; second call reports created:false", async () => {
    const eng = build(store, [testHandler("t", () => ({ kind: "success" }))], false);
    const a = await eng.enqueue({ ...base, type: "t", idempotencyKey: "t:1" });
    const b = await eng.enqueue({ ...base, type: "t", idempotencyKey: "t:1" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.jobId).toBe(a.jobId);
    expect(store.jobs.size).toBe(1);
  });

  it("rejects payloads without v and secret-shaped payloads", async () => {
    const eng = build(store, [], false);
    await expect(eng.enqueue({ type: "t", payload: {}, idempotencyKey: "k", userId: "u" })).rejects.toThrow(/numeric v/);
    await expect(
      eng.enqueue({ type: "t", payload: { v: 1, token: "x" }, idempotencyKey: "k2", userId: "u" }),
    ).rejects.toThrow(/secret-shaped/);
  });
});

describe("inline execution", () => {
  it("runs an immediately-due job in-request and records the event trail", async () => {
    let ran = 0;
    const eng = build(store, [testHandler("t", () => { ran++; return { kind: "success" }; })]);
    const { jobId } = await eng.enqueue({ ...base, type: "t", idempotencyKey: "t:1" });
    expect(ran).toBe(1);
    expect(store.jobs.get(jobId)!.status).toBe("succeeded");
    expect(store.events.filter((e) => e.jobId === jobId).map((e) => e.event)).toEqual([
      "enqueued", "claimed", "succeeded",
    ]);
  });

  it("does NOT run future-scheduled jobs inline", async () => {
    let ran = 0;
    const eng = build(store, [testHandler("t", () => { ran++; return { kind: "success" }; })]);
    await eng.enqueue({ ...base, type: "t", idempotencyKey: "t:1", runAfter: new Date(clock.getTime() + 60_000) });
    expect(ran).toBe(0);
  });

  it("inline handler crash never propagates to the caller (intake protection)", async () => {
    const eng = build(store, [testHandler("t", () => { throw new Error("boom"); })]);
    await expect(eng.enqueue({ ...base, type: "t", idempotencyKey: "t:1" })).resolves.toBeTruthy();
  });
});

describe("claiming", () => {
  it("two claimers on one job: exactly one wins", async () => {
    const eng = build(store, [testHandler("t", () => ({ kind: "success" }))], false);
    const { jobId } = await eng.enqueue({ ...base, type: "t", idempotencyKey: "t:1" });
    const first = await store.claimById(jobId, "w1");
    const second = await store.claimById(jobId, "w2");
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(store.jobs.get(jobId)!.attempts).toBe(1);
  });
});

describe("retry and dead-letter", () => {
  it("retry outcome ⇒ pending with future run_after and incremented attempt", async () => {
    const eng = build(store, [testHandler("t", () => ({ kind: "retry", error: "503" }))]);
    const { jobId } = await eng.enqueue({ ...base, type: "t", idempotencyKey: "t:1" });
    const j = store.jobs.get(jobId)!;
    expect(j.status).toBe("pending");
    expect(j.attempts).toBe(1);
    expect(j.run_after > clock.toISOString()).toBe(true);
    expect(j.last_error).toBe("503");
  });

  it("exhausted attempts ⇒ dead with exhausted marker", async () => {
    const eng = build(store, [testHandler("t", () => ({ kind: "retry", error: "always down" }))], false);
    const { jobId } = await eng.enqueue({ ...base, type: "t", idempotencyKey: "t:1", maxAttempts: 2 });
    await eng.runSweep("w");            // attempt 1 → retry scheduled
    advance(60 * 60_000);               // past any backoff
    await eng.runSweep("w");            // attempt 2 = max → dead
    const j = store.jobs.get(jobId)!;
    expect(j.status).toBe("dead");
    const deadEvent = store.events.find((e) => e.event === "failed_permanent");
    expect(deadEvent?.detail?.exhausted).toBe(true);
  });

  it("permanent outcome on attempt 1 ⇒ dead immediately, attempts=1", async () => {
    const eng = build(store, [testHandler("t", () => ({ kind: "permanent", error: "bad config" }))]);
    const { jobId } = await eng.enqueue({ ...base, type: "t", idempotencyKey: "t:1" });
    const j = store.jobs.get(jobId)!;
    expect(j.status).toBe("dead");
    expect(j.attempts).toBe(1);
    expect(store.events.filter((e) => e.event === "retry_scheduled")).toHaveLength(0);
  });

  it("unknown type ⇒ dead, never retried", async () => {
    const eng = build(store, [], false);
    const { jobId } = await eng.enqueue({ ...base, type: "ghost", idempotencyKey: "g:1" });
    await eng.runSweep("w");
    expect(store.jobs.get(jobId)!.status).toBe("dead");
  });

  it("invalid payload ⇒ dead permanent (schema is the gate)", async () => {
    const strict: JobHandler = {
      type: "strict",
      payloadSchema: z.object({ v: z.number(), mustHave: z.string() }),
      run: async () => ({ kind: "success" }),
    };
    const eng = build(store, [strict]);
    const { jobId } = await eng.enqueue({ ...base, type: "strict", idempotencyKey: "s:1" });
    expect(store.jobs.get(jobId)!.status).toBe("dead");
    expect(store.jobs.get(jobId)!.last_error).toMatch(/invalid payload/);
  });
});

describe("stale recovery", () => {
  it("recovers a timed-out claim; fresh claims are untouched", async () => {
    const eng = build(store, [testHandler("t", () => ({ kind: "success" }))], false);
    const { jobId } = await eng.enqueue({ ...base, type: "t", idempotencyKey: "t:1" });
    await store.claimById(jobId, "dying-worker");   // simulate claim, then crash
    advance(121_000);                                // past visibility timeout
    const stats = await eng.runSweep("sweeper");
    expect(stats.recovered).toBe(1);
    expect(store.jobs.get(jobId)!.status).toBe("succeeded"); // re-claimed + run in same sweep
    expect(store.events.some((e) => e.event === "recovered_stale")).toBe(true);
  });

  it("does not recover a claim inside the visibility window", async () => {
    const eng = build(store, [testHandler("t", () => ({ kind: "success" }))], false);
    const { jobId } = await eng.enqueue({ ...base, type: "t", idempotencyKey: "t:1" });
    await store.claimById(jobId, "live-worker");
    advance(30_000);
    const stats = await eng.runSweep("sweeper");
    expect(stats.recovered).toBe(0);
    expect(store.jobs.get(jobId)!.status).toBe("claimed");
  });
});

describe("checkpoints and chaining", () => {
  it("checkpoint persists mid-run; retry sees prior state", async () => {
    const seen: unknown[] = [];
    const h: JobHandler = {
      type: "ck",
      payloadSchema: z.object({ v: z.number() }),
      run: async (ctx) => {
        seen.push(ctx.state.recordId ?? null);
        if (!ctx.state.recordId) {
          await ctx.checkpoint({ recordId: "rec123" });
          return { kind: "retry", error: "crashed after external effect" };
        }
        return { kind: "success" };
      },
    };
    const eng = build(store, [h]);
    const { jobId } = await eng.enqueue({ ...base, type: "ck", idempotencyKey: "ck:1" });
    advance(60 * 60_000);
    await eng.runSweep("w");
    expect(seen).toEqual([null, "rec123"]);
    expect(store.jobs.get(jobId)!.status).toBe("succeeded");
  });

  it("follow-up enqueue inherits correlation id", async () => {
    const h: JobHandler = {
      type: "parent",
      payloadSchema: z.object({ v: z.number() }),
      run: async (ctx) => {
        await ctx.enqueue({ type: "child", payload: { v: 1 }, idempotencyKey: "child:1", userId: ctx.userId });
        return { kind: "success" };
      },
    };
    const eng = build(store, [h, testHandler("child", () => ({ kind: "success" }))]);
    await eng.enqueue({ ...base, type: "parent", idempotencyKey: "p:1", correlationId: "11111111-1111-1111-1111-111111111111" });
    const child = [...store.jobs.values()].find((j) => j.type === "child")!;
    expect(child.correlation_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(child.status).toBe("succeeded");
  });
});

describe("manual retry + cancel + ownership", () => {
  it("owner can retry a dead job; non-owner cannot; non-dead cannot", async () => {
    const eng = build(store, [testHandler("t", () => ({ kind: "permanent", error: "cfg" }))]);
    const { jobId } = await eng.enqueue({ ...base, type: "t", idempotencyKey: "t:1" });
    await expect(eng.retryDeadJob(jobId, "someone-else")).rejects.toThrow("job_not_found");
    await eng.retryDeadJob(jobId, "user-1");
    const j = store.jobs.get(jobId)!;
    expect(j.status).toBe("pending");
    expect(j.attempts).toBe(0);
    await expect(eng.retryDeadJob(jobId, "user-1")).rejects.toThrow("job_not_dead");
    expect(store.events.some((e) => e.event === "manual_retry")).toBe(true);
  });

  it("cancel works on pending only", async () => {
    const eng = build(store, [testHandler("t", () => ({ kind: "success" }))], false);
    const { jobId } = await eng.enqueue({ ...base, type: "t", idempotencyKey: "t:1" });
    expect(await eng.cancel(jobId)).toBe(true);
    expect(await eng.cancel(jobId)).toBe(false);
    expect(store.jobs.get(jobId)!.status).toBe("cancelled");
  });
});

describe("configuration invariants", () => {
  it("refuses a visibility timeout at or below route maxDuration", () => {
    expect(() =>
      createJobsEngine({ store, handlers: [], inlineExecution: true, visibilityTimeoutMs: 60_000, now }),
    ).toThrow(/visibilityTimeoutMs/);
  });

  it("refuses duplicate handler types", () => {
    const h = testHandler("t", () => ({ kind: "success" }));
    expect(() =>
      createJobsEngine({ store, handlers: [h, h], inlineExecution: true, visibilityTimeoutMs: 120_000, now }),
    ).toThrow(/duplicate/);
  });
});
