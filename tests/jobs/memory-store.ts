/**
 * In-memory JobsStore for tests. Mirrors the SQL semantics of store.ts:
 * unique idempotency_key, guarded status transitions, attempts increment on
 * claim. Synchronous under the hood, so "concurrent" claim tests exercise the
 * guarded-update logic deterministically. (True Postgres atomicity lives in
 * the SQL and is validated in the manual staging pass, not here.)
 */
import type { EnqueueResult, JobEventName, JobRow, JobsStore } from "@/lib/engine/jobs/types";

export interface MemoryJobsStore extends JobsStore {
  jobs: Map<string, JobRow>;
  events: Array<{ jobId: string; event: JobEventName; detail?: Record<string, unknown> }>;
  now: () => Date;
}

let seq = 0;

export function createMemoryStore(now: () => Date = () => new Date()): MemoryJobsStore {
  const jobs = new Map<string, JobRow>();
  const byKey = new Map<string, string>();
  const events: MemoryJobsStore["events"] = [];

  return {
    jobs,
    events,
    now,

    async insert(row): Promise<EnqueueResult> {
      const existing = byKey.get(row.idempotency_key);
      if (existing) return { jobId: existing, created: false };
      const id = `job-${++seq}`;
      jobs.set(id, {
        id,
        type: row.type,
        payload: row.payload,
        state: {},
        idempotency_key: row.idempotency_key,
        user_id: row.user_id,
        status: "pending",
        attempts: 0,
        max_attempts: row.max_attempts,
        run_after: row.run_after,
        claimed_at: null,
        claimed_by: null,
        last_error: null,
        correlation_id: row.correlation_id,
        created_at: now().toISOString(),
        finished_at: null,
      });
      byKey.set(row.idempotency_key, id);
      return { jobId: id, created: true };
    },

    async claimById(id, worker) {
      const j = jobs.get(id);
      if (!j || j.status !== "pending" || j.run_after > now().toISOString()) return null;
      j.status = "claimed";
      j.claimed_at = now().toISOString();
      j.claimed_by = worker;
      j.attempts += 1;
      return { ...j };
    },

    async claimDue(worker, limit) {
      const due = [...jobs.values()]
        .filter((j) => j.status === "pending" && j.run_after <= now().toISOString())
        .sort((a, b) => a.run_after.localeCompare(b.run_after))
        .slice(0, limit);
      for (const j of due) {
        j.status = "claimed";
        j.claimed_at = now().toISOString();
        j.claimed_by = worker;
        j.attempts += 1;
      }
      return due.map((j) => ({ ...j }));
    },

    async recoverStale(cutoffIso) {
      const stale = [...jobs.values()].filter(
        (j) => j.status === "claimed" && (j.claimed_at ?? "") < cutoffIso,
      );
      for (const j of stale) {
        j.status = "pending";
        j.run_after = now().toISOString();
        j.last_error = "stale claim recovered";
        j.claimed_at = null;
        j.claimed_by = null;
      }
      return stale.map((j) => j.id);
    },

    async markSucceeded(id) {
      const j = jobs.get(id)!;
      j.status = "succeeded";
      j.finished_at = now().toISOString();
    },

    async scheduleRetry(id, runAfterIso, lastError) {
      const j = jobs.get(id)!;
      j.status = "pending";
      j.run_after = runAfterIso;
      j.last_error = lastError;
      j.claimed_at = null;
      j.claimed_by = null;
    },

    async markDead(id, lastError) {
      const j = jobs.get(id)!;
      j.status = "dead";
      j.last_error = lastError;
      j.finished_at = now().toISOString();
    },

    async mergeState(id, patch) {
      const j = jobs.get(id)!;
      j.state = { ...j.state, ...patch };
    },

    async cancelPending(id) {
      const j = jobs.get(id);
      if (!j || j.status !== "pending") return false;
      j.status = "cancelled";
      j.finished_at = now().toISOString();
      return true;
    },

    async resetForManualRetry(id) {
      const j = jobs.get(id)!;
      if (j.status !== "dead") return;
      j.status = "pending";
      j.attempts = 0;
      j.run_after = now().toISOString();
      j.finished_at = null;
      j.claimed_at = null;
      j.claimed_by = null;
    },

    async getById(id) {
      const j = jobs.get(id);
      return j ? { ...j } : null;
    },

    async insertEvent(jobId, event, detail) {
      events.push({ jobId, event, detail });
    },
  };
}
