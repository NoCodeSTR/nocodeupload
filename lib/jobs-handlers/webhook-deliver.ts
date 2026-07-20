/**
 * webhook.deliver — the first production job handler (Jobs Engine Phase 1).
 *
 * Wraps the existing classified webhook senders. Idempotency layers:
 *   - enqueue key (webhook.deliver:{upload|batch}:{id}) ⇒ one job per event
 *   - entry-check: a 'sent' delivery row for THIS job ⇒ success without
 *     re-POSTing (crash-after-send guard)
 *   - X-NoCodeUpload-Job-Id header ⇒ receiver-side dedupe for the residual
 *     at-least-once window
 *
 * Classification: sent ⇒ success · skipped ⇒ success (nothing to do), except
 * the fire-time SSRF rejection which is PERMANENT (customer-actionable
 * config) · failed ⇒ retry/permanent per lib/webhook-classify.ts.
 *
 * Dependencies are injected so tests exercise the contract without Supabase;
 * production wiring lives in index.ts.
 */
import { z } from "zod";
import type { JobHandler } from "@/lib/engine/jobs/types";
import type { ClassifiedWebhookResult } from "@/lib/webhook";
import type { NotifyResult } from "@/lib/notifications/types";

export const webhookDeliverPayloadSchema = z
  .object({
    v: z.literal(1),
    mode: z.enum(["single", "batch"]),
    uploadId: z.string().uuid().optional(),
    batchId: z.string().uuid().optional(),
  })
  .refine((p) => (p.mode === "single" ? !!p.uploadId : !!p.batchId), {
    message: "uploadId required for single, batchId for batch",
  });

export type WebhookDeliverPayload = z.infer<typeof webhookDeliverPayloadSchema>;

export interface WebhookDeliverDeps {
  sendSingle(uploadId: string, jobId: string): Promise<ClassifiedWebhookResult>;
  sendBatch(batchId: string, jobId: string): Promise<ClassifiedWebhookResult>;
  /** Owner + link for the deliveries ledger. Null ⇒ entity vanished (permanent). */
  loadOwner(p: WebhookDeliverPayload): Promise<{ userId: string; uploadLinkId: string } | null>;
  logDelivery(args: {
    userId: string;
    uploadLinkId: string;
    result: NotifyResult;
    uploadId?: string | null;
    batchId?: string | null;
    jobId: string;
  }): Promise<void>;
  /** True if a 'sent' webhook delivery row already exists for this job. */
  hasSentDelivery(jobId: string): Promise<boolean>;
}

export function createWebhookDeliverHandler(deps: WebhookDeliverDeps): JobHandler {
  return {
    type: "webhook.deliver",
    payloadSchema: webhookDeliverPayloadSchema,
    defaults: { maxAttempts: 5 },

    async run(ctx) {
      // Entry-check (constitution rule 7): if a prior attempt sent but died
      // before acknowledging, do NOT repeat the external effect.
      if (await deps.hasSentDelivery(ctx.jobId)) {
        ctx.log("already sent (delivery row present) — acknowledging");
        return { kind: "success" };
      }

      const p = ctx.payload as WebhookDeliverPayload; // engine validated via payloadSchema

      const owner = await deps.loadOwner(p);
      if (!owner) {
        return { kind: "permanent", error: "upload/batch no longer exists" };
      }

      const classified =
        p.mode === "single"
          ? await deps.sendSingle(p.uploadId!, ctx.jobId)
          : await deps.sendBatch(p.batchId!, ctx.jobId);

      // Every attempt lands in the domain ledger (no silent side effects).
      await deps.logDelivery({
        userId: owner.userId,
        uploadLinkId: owner.uploadLinkId,
        result: classified.result,
        uploadId: p.uploadId ?? null,
        batchId: p.batchId ?? null,
        jobId: ctx.jobId,
      });

      const r = classified.result;
      if (r.status === "sent") return { kind: "success" };

      if (r.status === "skipped") {
        if (classified.unsafeUrl) {
          return {
            kind: "permanent",
            error: "webhook URL rejected by fire-time safety check",
            customerMessage:
              "Your webhook URL points at a private or unsafe address and was not called. Update the webhook URL on this link.",
          };
        }
        return { kind: "success" }; // no webhook configured / nothing to send
      }

      if (classified.retry.retryable) {
        return {
          kind: "retry",
          error: r.detail ?? "webhook delivery failed",
          retryAfterMs: classified.retry.retryAfterMs,
        };
      }
      return {
        kind: "permanent",
        error: r.detail ?? "webhook rejected the delivery",
        customerMessage:
          "Your webhook endpoint rejected this delivery. Check the endpoint's logs and configuration, then retry from the submission page.",
      };
    },
  };
}
