/**
 * Job handler registry — the ONLY place product code meets the Jobs Engine
 * (ADR-22). Handlers live in this folder and may import product domain modules;
 * lib/engine/jobs/ must never import from here or from any product code.
 *
 * Phase 1 adds the first handler (webhook delivery). The registry existing
 * empty in Phase 0 is intentional: the engine deploys inert.
 */
import type { JobHandler } from "@/lib/engine/jobs/types";

export function allJobHandlers(): JobHandler[] {
  return [];
}
