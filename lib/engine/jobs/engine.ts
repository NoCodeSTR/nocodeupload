/**
 * Jobs Engine core (Phase 0).
 *
 * Execution model (ADR-19): inline-first — enqueue attempts the job in the
 * same request when it's immediately due; the sweeper (runSweep, invoked by
 * cron) is the durability guarantee, handling retries, delayed jobs, and
 * stale-claim recovery. Guarantee (ADR-18): at-least-once; handlers make side
 * effects effectively-once via entry-checks and checkpoints.
 *
 * This module imports NOTHING from product code and nothing server-bound —
 * persistence is behind the JobsStore seam (types.ts) so the logic is fully
 * unit-testable. Production wiring lives in lib/jobs.ts.
 */
import { backoffDelayMs, DEFAULT_BACKOFF } from "./backoff";
import { redactError, assertPayloadSafe } from "./redact";
import type {
  EnqueueInput,
  EnqueueResult,
  JobContext,
  JobHandler,
  JobRow,
  JobsStore,
  SweepStats,
} from "./types";

export interface JobsEngineOptions {
  store: JobsStore;
  handlers: JobHandler[];
  /** Attempt immediately-due jobs in-request after enqueue. */
  inlineExecution: boolean;
  /**
   * INVARIANT: must exceed every route's maxDuration (currently 60s in
   * app/api/upload/chunk/route.ts). A claim older than this is PROOF of a dead
   * invocation, not a guess — Vercel functions cannot outlive maxDuration.
   */
  visibilityTimeoutMs: number;
  now?: () => Date;
}

const ROUTE_MAX_DURATION_MS = 60_000;

export function createJobsEngine(opts: JobsEngineOptions) {
  if (opts.visibilityTimeoutMs <= ROUTE_MAX_DURATION_MS) {
    throw new Error(
      `visibilityTimeoutMs (${opts.visibilityTimeoutMs}) must exceed the longest route maxDuration (${ROUTE_MAX_DURATION_MS}); raise both together`,
    );
  }
  const now = opts.now ?? (() => new Date());
  const registry = new Map<string, JobHandler>();
  for (const h of opts.handlers) {
    if (registry.has(h.type)) throw new Error(`duplicate job handler type "${h.type}"`);
    registry.set(h.type, h);
  }

  async function enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    if (typeof input.payload.v !== "number") {
      throw new Error(`job payload for "${input.type}" must carry a numeric v (ADR-20)`);
    }
    assertPayloadSafe(input.payload);
    const handler = registry.get(input.type);
    const runAfter = input.runAfter ?? now();
    const result = await opts.store.insert({
      type: input.type,
      payload: input.payload,
      idempotency_key: input.idempotencyKey,
      user_id: input.userId,
      correlation_id: input.correlationId ?? null,
      run_after: runAfter.toISOString(),
      max_attempts: input.maxAttempts ?? handler?.defaults?.maxAttempts ?? 5,
    });
    if (result.created) {
      await opts.store.insertEvent(result.jobId, "enqueued", { type: input.type });
      if (opts.inlineExecution && runAfter.getTime() <= now().getTime()) {
        // Inline attempt — errors here must never propagate to the caller
        // (constitution rule 6: intake never fails because processing failed).
        try {
          await executeById(result.jobId, "inline");
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`[jobs] inline execution error for ${result.jobId}:`, err);
        }
      }
    }
    return result;
  }

  async function executeById(id: string, worker: string): Promise<void> {
    const job = await opts.store.claimById(id, worker);
    if (!job) return; // lost the claim, someone else has it — that's success
    await run(job, worker);
  }

  async function run(job: JobRow, worker: string): Promise<"succeeded" | "retried" | "dead"> {
    await opts.store.insertEvent(job.id, "claimed", { attempt: job.attempts, worker });

    const handler = registry.get(job.type);
    if (!handler) {
      // Deploy-skew symptom, not a retry case: fail loudly and permanently.
      const msg = `no handler registered for type "${job.type}"`;
      // eslint-disable-next-line no-console
      console.error(`[jobs] ${msg} (job ${job.id})`);
      await opts.store.markDead(job.id, msg);
      await opts.store.insertEvent(job.id, "failed_permanent", { error: msg });
      return "dead";
    }

    const parsed = handler.payloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      const msg = `invalid payload: ${redactError(parsed.error.message)}`;
      await opts.store.markDead(job.id, msg);
      await opts.store.insertEvent(job.id, "failed_permanent", { error: msg });
      return "dead";
    }

    const ctx: JobContext = {
      jobId: job.id,
      attempt: job.attempts,
      userId: job.user_id,
      payload: job.payload,
      state: job.state ?? {},
      checkpoint: (patch) => opts.store.mergeState(job.id, patch),
      enqueue: (input) =>
        enqueue({ ...input, correlationId: input.correlationId ?? job.correlation_id ?? undefined }),
      log: (message) => {
        // eslint-disable-next-line no-console
        console.log(`[jobs] type=${job.type} id=${job.id} attempt=${job.attempts} ${message}`);
      },
    };

    let outcome;
    try {
      outcome = await handler.run(ctx);
    } catch (err) {
      // Thrown ⇒ transient by contract (handlers classify known-permanent
      // failures explicitly; the engine never swallows).
      outcome = {
        kind: "retry" as const,
        error: err instanceof Error ? err.message : "handler threw",
      };
    }

    if (outcome.kind === "success") {
      await opts.store.markSucceeded(job.id);
      await opts.store.insertEvent(job.id, "succeeded", { attempt: job.attempts });
      return "succeeded";
    }

    const error = redactError(outcome.error);

    if (outcome.kind === "permanent" || job.attempts >= job.max_attempts) {
      await opts.store.markDead(job.id, error);
      await opts.store.insertEvent(job.id, "failed_permanent", {
        error,
        attempt: job.attempts,
        exhausted: outcome.kind !== "permanent",
      });
      return "dead";
    }

    const delay = backoffDelayMs(
      job.attempts,
      handler.defaults?.backoff ?? DEFAULT_BACKOFF,
      outcome.kind === "retry" ? outcome.retryAfterMs : undefined,
    );
    const runAfter = new Date(now().getTime() + delay).toISOString();
    await opts.store.scheduleRetry(job.id, runAfter, error);
    await opts.store.insertEvent(job.id, "retry_scheduled", {
      error,
      attempt: job.attempts,
      backoff_ms: delay,
    });
    return "retried";
  }

  async function runSweep(worker: string, batchSize = 10): Promise<SweepStats> {
    const stats: SweepStats = { recovered: 0, claimed: 0, succeeded: 0, retried: 0, dead: 0 };

    const cutoff = new Date(now().getTime() - opts.visibilityTimeoutMs).toISOString();
    const recovered = await opts.store.recoverStale(cutoff);
    stats.recovered = recovered.length;
    for (const id of recovered) {
      await opts.store.insertEvent(id, "recovered_stale", { worker });
    }

    // Claim → run until the due set is drained (bounded batches).
    for (;;) {
      const batch = await opts.store.claimDue(worker, batchSize);
      if (batch.length === 0) break;
      stats.claimed += batch.length;
      for (const job of batch) {
        const result = await run(job, worker);
        stats[result === "succeeded" ? "succeeded" : result === "retried" ? "retried" : "dead"] += 1;
      }
      if (batch.length < batchSize) break;
    }
    return stats;
  }

  async function retryDeadJob(jobId: string, requestingUserId: string): Promise<void> {
    const job = await opts.store.getById(jobId);
    if (!job || job.user_id !== requestingUserId) throw new Error("job_not_found");
    if (job.status !== "dead") throw new Error("job_not_dead");
    await opts.store.resetForManualRetry(jobId);
    await opts.store.insertEvent(jobId, "manual_retry", { by: requestingUserId });
  }

  async function cancel(jobId: string): Promise<boolean> {
    const cancelled = await opts.store.cancelPending(jobId);
    if (cancelled) await opts.store.insertEvent(jobId, "cancelled", {});
    return cancelled;
  }

  return { enqueue, runSweep, retryDeadJob, cancel, executeById };
}

export type JobsEngine = ReturnType<typeof createJobsEngine>;
