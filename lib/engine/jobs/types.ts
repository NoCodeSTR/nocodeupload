/**
 * Jobs Engine — public contract (Phase 0).
 *
 * The engine executes OPAQUE durable work. It must never import product code
 * or understand uploads, Airtable, notifications, etc. Handlers are registered
 * at bootstrap (lib/jobs.ts) and give payloads their meaning — the same
 * registry pattern as lib/providers/registry.ts (ADR-22).
 *
 * Guarantee (ADR-18): at-least-once execution. External side effects become
 * effectively-once through idempotency keys, handler entry-checks, and
 * checkpoints — never claim "exactly once".
 */
import type { z } from "zod";

export type JobStatus = "pending" | "claimed" | "succeeded" | "dead" | "cancelled";

export interface JobRow {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  state: Record<string, unknown>;
  idempotency_key: string;
  user_id: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_after: string; // ISO
  claimed_at: string | null;
  claimed_by: string | null;
  last_error: string | null;
  correlation_id: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface EnqueueInput {
  type: string;
  /** Entity references only — never secrets, never denormalized values (ADR-20/25). Must include v: number. */
  payload: Record<string, unknown>;
  idempotencyKey: string;
  userId: string;
  correlationId?: string;
  runAfter?: Date;
  maxAttempts?: number;
}

export interface EnqueueResult {
  jobId: string;
  /** false ⇒ an identical intent already existed; that is success, not an error. */
  created: boolean;
}

export type JobOutcome =
  | { kind: "success" }
  | { kind: "retry"; error: string; retryAfterMs?: number }
  | { kind: "permanent"; error: string; customerMessage?: string };

export interface JobContext {
  jobId: string;
  /** 1-based attempt number for this execution. */
  attempt: number;
  userId: string;
  payload: Record<string, unknown>;
  /** Last persisted checkpoint (empty object on first attempt). */
  state: Record<string, unknown>;
  /** Merge + persist a checkpoint NOW — call immediately after an irreversible external effect. */
  checkpoint(patch: Record<string, unknown>): Promise<void>;
  /** Enqueue a follow-up job (inherits correlation id unless overridden). */
  enqueue(input: EnqueueInput): Promise<EnqueueResult>;
  log(message: string): void;
}

export interface BackoffPolicy {
  baseMs: number;
  capMs: number;
}

export interface JobHandler {
  type: string;
  /** Validated before run(); invalid payload ⇒ permanent failure (never retried). */
  payloadSchema: z.ZodType<unknown>;
  defaults?: { maxAttempts?: number; backoff?: BackoffPolicy };
  run(ctx: JobContext): Promise<JobOutcome>;
}

export interface SweepStats {
  recovered: number;
  claimed: number;
  succeeded: number;
  retried: number;
  dead: number;
}

export type JobEventName =
  | "enqueued"
  | "claimed"
  | "succeeded"
  | "retry_scheduled"
  | "failed_permanent"
  | "recovered_stale"
  | "cancelled"
  | "manual_retry";

/**
 * Storage seam. Production uses the Supabase implementation (store.ts); tests
 * use an in-memory implementation. This is deliberately the ONLY abstraction
 * added beyond the approved design: the design's engine×DB tests assume a local
 * database, which CI here doesn't have. Atomicity of claims lives in the SQL
 * itself (guarded updates + claim_due_jobs SKIP LOCKED RPC), not in this
 * interface.
 */
export interface JobsStore {
  insert(row: {
    type: string;
    payload: Record<string, unknown>;
    idempotency_key: string;
    user_id: string;
    correlation_id: string | null;
    run_after: string;
    max_attempts: number;
  }): Promise<EnqueueResult>;
  /** Guarded claim of one specific due pending job. Increments attempts. Null if lost. */
  claimById(id: string, worker: string): Promise<JobRow | null>;
  /** Sweeper batch claim via claim_due_jobs RPC (SKIP LOCKED). Increments attempts. */
  claimDue(worker: string, limit: number): Promise<JobRow[]>;
  /** Return timed-out claimed jobs to pending. Returns recovered ids. */
  recoverStale(cutoffIso: string): Promise<string[]>;
  markSucceeded(id: string): Promise<void>;
  scheduleRetry(id: string, runAfterIso: string, lastError: string): Promise<void>;
  markDead(id: string, lastError: string): Promise<void>;
  mergeState(id: string, patch: Record<string, unknown>): Promise<void>;
  cancelPending(id: string): Promise<boolean>;
  resetForManualRetry(id: string): Promise<void>;
  getById(id: string): Promise<JobRow | null>;
  insertEvent(jobId: string, event: JobEventName, detail?: Record<string, unknown>): Promise<void>;
}
