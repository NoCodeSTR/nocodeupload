/**
 * Supabase implementation of the JobsStore seam. Service-role only — the jobs
 * tables have RLS enabled with no policies. Claim atomicity comes from guarded
 * UPDATEs (single job) and the claim_due_jobs RPC (FOR UPDATE SKIP LOCKED) for
 * sweeper batches — the same guarded-update idiom as claimBatchNotification.
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { EnqueueResult, JobEventName, JobRow, JobsStore } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

export function createSupabaseJobsStore(): JobsStore {
  const admin = () => getSupabaseAdmin();

  return {
    async insert(row): Promise<EnqueueResult> {
      // ON CONFLICT DO NOTHING via upsert(ignoreDuplicates). A conflicted
      // insert returns no rows — that's the "already exists" signal.
      const { data, error } = await admin()
        .from("jobs")
        .upsert(row as never, { onConflict: "idempotency_key", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(`jobs insert failed: ${error.message} code=${error.code ?? ""}`);
      const inserted = (data ?? []) as Array<{ id: string }>;
      if (inserted.length > 0) return { jobId: inserted[0].id, created: true };
      const { data: existing, error: selErr } = await admin()
        .from("jobs")
        .select("id")
        .eq("idempotency_key", row.idempotency_key)
        .single();
      if (selErr || !existing) throw new Error(`jobs dedupe lookup failed: ${selErr?.message ?? "missing"}`);
      return { jobId: (existing as { id: string }).id, created: false };
    },

    async claimById(id, worker): Promise<JobRow | null> {
      const { data, error } = await admin()
        .from("jobs")
        .update({ status: "claimed", claimed_at: nowIso(), claimed_by: worker } as never)
        .eq("id", id)
        .eq("status", "pending")
        .lte("run_after", nowIso())
        .select("*");
      if (error) throw new Error(`claimById failed: ${error.message}`);
      const rows = (data ?? []) as unknown as JobRow[];
      if (rows.length === 0) return null;
      // attempts increments with the claim; PostgREST can't express
      // attempts=attempts+1 in an update, so bump it in a follow-up write tied
      // to our claim (we own the row now — no race).
      const attempts = rows[0].attempts + 1;
      await admin().from("jobs").update({ attempts } as never).eq("id", id);
      return { ...rows[0], attempts };
    },

    async claimDue(worker, limit): Promise<JobRow[]> {
      // Untyped client (no generated DB types in this repo) — same `as never`
      // idiom used for updates throughout the codebase.
      const { data, error } = await admin().rpc(
        "claim_due_jobs" as never,
        { p_worker: worker, p_limit: limit } as never,
      );
      if (error) throw new Error(`claim_due_jobs failed: ${error.message}`);
      return (data ?? []) as JobRow[];
    },

    async recoverStale(cutoffIso): Promise<string[]> {
      const { data, error } = await admin()
        .from("jobs")
        .update({
          status: "pending",
          run_after: nowIso(),
          last_error: "stale claim recovered",
          claimed_at: null,
          claimed_by: null,
        } as never)
        .eq("status", "claimed")
        .lt("claimed_at", cutoffIso)
        .select("id");
      if (error) throw new Error(`recoverStale failed: ${error.message}`);
      return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    },

    async markSucceeded(id): Promise<void> {
      const { error } = await admin()
        .from("jobs")
        .update({ status: "succeeded", finished_at: nowIso() } as never)
        .eq("id", id);
      if (error) throw new Error(`markSucceeded failed: ${error.message}`);
    },

    async scheduleRetry(id, runAfterIso, lastError): Promise<void> {
      const { error } = await admin()
        .from("jobs")
        .update({
          status: "pending",
          run_after: runAfterIso,
          last_error: lastError,
          claimed_at: null,
          claimed_by: null,
        } as never)
        .eq("id", id);
      if (error) throw new Error(`scheduleRetry failed: ${error.message}`);
    },

    async markDead(id, lastError): Promise<void> {
      const { error } = await admin()
        .from("jobs")
        .update({ status: "dead", last_error: lastError, finished_at: nowIso() } as never)
        .eq("id", id);
      if (error) throw new Error(`markDead failed: ${error.message}`);
    },

    async mergeState(id, patch): Promise<void> {
      // Read-merge-write is safe: exactly one claimant owns a claimed job.
      const { data, error } = await admin().from("jobs").select("state").eq("id", id).single();
      if (error) throw new Error(`mergeState read failed: ${error.message}`);
      const state = { ...((data as { state: Record<string, unknown> }).state ?? {}), ...patch };
      const { error: upErr } = await admin().from("jobs").update({ state } as never).eq("id", id);
      if (upErr) throw new Error(`mergeState write failed: ${upErr.message}`);
    },

    async cancelPending(id): Promise<boolean> {
      const { data, error } = await admin()
        .from("jobs")
        .update({ status: "cancelled", finished_at: nowIso() } as never)
        .eq("id", id)
        .eq("status", "pending")
        .select("id");
      if (error) throw new Error(`cancelPending failed: ${error.message}`);
      return ((data ?? []) as unknown[]).length > 0;
    },

    async resetForManualRetry(id): Promise<void> {
      const { error } = await admin()
        .from("jobs")
        .update({
          status: "pending",
          attempts: 0,
          run_after: nowIso(),
          finished_at: null,
          claimed_at: null,
          claimed_by: null,
        } as never)
        .eq("id", id)
        .eq("status", "dead");
      if (error) throw new Error(`resetForManualRetry failed: ${error.message}`);
    },

    async getById(id): Promise<JobRow | null> {
      const { data, error } = await admin().from("jobs").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(`getById failed: ${error.message}`);
      return (data as JobRow | null) ?? null;
    },

    async insertEvent(jobId, event: JobEventName, detail): Promise<void> {
      const { error } = await admin()
        .from("job_events")
        .insert({ job_id: jobId, event, detail: detail ?? null } as never);
      if (error) {
        // Event-log failures must never fail the job itself — log and move on.
        // eslint-disable-next-line no-console
        console.error(`[jobs] event write failed for ${jobId}/${event}: ${error.message}`);
      }
    },
  };
}
