/**
 * Jobs Engine production wiring.
 *
 * Call sites use `jobsEnabled()` to branch between legacy inline behavior and
 * the engine — the flag lives at the CALL SITES, not inside the engine, so
 * flipping JOBS_ENGINE_ENABLED=false restores exact production behavior with
 * no engine code in the path.
 */
import "server-only";
import { createJobsEngine, type JobsEngine } from "@/lib/engine/jobs/engine";
import { createSupabaseJobsStore } from "@/lib/engine/jobs/store";
import { allJobHandlers } from "@/lib/jobs-handlers";

export function jobsEnabled(): boolean {
  return process.env.JOBS_ENGINE_ENABLED === "true";
}

let engine: JobsEngine | null = null;

/** Lazy singleton (mirrors the env-access idiom in lib/env.ts). */
export function getJobs(): JobsEngine {
  engine ??= createJobsEngine({
    store: createSupabaseJobsStore(),
    handlers: allJobHandlers(),
    // Inline-first (ADR-19); set JOBS_INLINE_EXECUTION=false to force
    // sweeper-only execution (useful when diagnosing an inline-path issue).
    inlineExecution: process.env.JOBS_INLINE_EXECUTION !== "false",
    // INVARIANT: > longest route maxDuration (60s). See engine.ts assertion.
    visibilityTimeoutMs: 120_000,
  });
  return engine;
}
