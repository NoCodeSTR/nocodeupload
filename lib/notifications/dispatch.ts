/**
 * Notification dispatch — the single place where "an upload/batch completed"
 * fans out to channels, and the single place that logs every attempt.
 *
 * Flow for an event (single upload OR a bundled batch):
 *   1. Default destinations (back-compat): owner email (respects notify_email)
 *      + the link's webhook. Always attempted, now always logged.
 *   2. Routing rules: each rule whose condition matches the upload's context
 *      (custom-field values, file type) fans out to its destinations
 *      (email addresses today; Slack/Quo as they land) + optionally the owner.
 *   3. De-dupe so the same email address isn't hit twice for one event.
 *
 * Every send returns a NotifyResult that we write to notification_deliveries.
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { fileCategory } from "@/lib/upload-validation";
import {
  sendUploadNotification,
  sendBatchUploadNotification,
  sendUploadEmailTo,
  sendBatchEmailTo,
} from "@/lib/email";
import { sendUploadWebhook, sendBatchUploadWebhook } from "@/lib/webhook";
import { sendSlackForUpload, sendSlackForBatch, type SlackTarget } from "@/lib/notifications/slack";
import { sendQuoForUpload, sendQuoForBatch, type QuoCreds } from "@/lib/notifications/quo";
import { logDelivery } from "@/lib/notifications/deliveries";
import { getJobs, jobsEnabled } from "@/lib/jobs";
import {
  getDestinationsByIds,
  getSlackBotToken,
  decryptQuoCreds,
} from "@/lib/notifications/destinations";
import { getSubmissionSourceValues } from "@/lib/airtable/record-prefill";
import { evalCondition } from "@/lib/conditional";
import { prefillKey } from "@/lib/filename";
import type { NotifyResult } from "@/lib/notifications/types";
import type { NotificationRule, RuleCondition } from "@/lib/db-types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Senders {
  email: (addr: string, includeFiles: boolean) => Promise<NotifyResult>;
  slack: (target: SlackTarget, message: string | undefined, includeFiles: boolean) => Promise<NotifyResult>;
  quo: (creds: QuoCreds, message: string | undefined, includeFiles: boolean) => Promise<NotifyResult>;
}

interface DispatchData {
  userId: string;
  uploadLinkId: string;
  ownerEmail: string | null;
  notifyEmail: boolean;
  rules: NotificationRule[];
  customData: Record<string, string>;
  categories: string[];
}

// --- Condition evaluation ----------------------------------------------------

function conditionMatches(
  c: RuleCondition,
  customData: Record<string, string>,
  categories: string[],
): boolean {
  let fieldVal: string;
  if (c.field === "__fileType") {
    fieldVal = categories.join(", ");
  } else {
    const key = Object.keys(customData).find((k) => k.toLowerCase() === c.field.toLowerCase());
    fieldVal = key ? customData[key] : "";
  }
  // Use the shared operator evaluator (same set as field visibility). Legacy
  // rules carried a single `value`; treat it as the first comparison value.
  const values = c.values?.length ? c.values : c.value != null ? [c.value] : [];
  return evalCondition(c.op, fieldVal, values);
}

function ruleMatches(
  rule: NotificationRule,
  customData: Record<string, string>,
  categories: string[],
): boolean {
  const conds = rule.conditions ?? [];
  if (conds.length === 0) return true; // "always"
  const results = conds.map((c) => conditionMatches(c, customData, categories));
  return rule.matchMode === "any" ? results.some(Boolean) : results.every(Boolean);
}

// --- Loaders -----------------------------------------------------------------

async function loadLinkDispatch(
  uploadLinkId: string,
): Promise<{ userId: string; ownerEmail: string | null; notifyEmail: boolean; rules: NotificationRule[] } | null> {
  const admin = getSupabaseAdmin();
  const { data: linkData } = await admin
    .from("upload_links")
    .select("user_id, notify_email, notification_rules")
    .eq("id", uploadLinkId)
    .maybeSingle();
  const link = linkData as
    | { user_id: string; notify_email: boolean; notification_rules: NotificationRule[] | null }
    | null;
  if (!link) return null;
  const { data: profileData } = await admin
    .from("profiles")
    .select("email")
    .eq("id", link.user_id)
    .maybeSingle();
  return {
    userId: link.user_id,
    ownerEmail: (profileData as { email: string | null } | null)?.email ?? null,
    notifyEmail: link.notify_email,
    rules: Array.isArray(link.notification_rules) ? link.notification_rules : [],
  };
}

// --- Rule fan-out (shared by single + batch) ---------------------------------

async function dispatchRules(
  data: DispatchData,
  alreadyEmailed: Set<string>,
  senders: Senders,
  ids: { uploadId?: string | null; batchId?: string | null },
  sourceValues: Record<string, string>,
): Promise<void> {
  const matched = data.rules.filter((r) => ruleMatches(r, data.customData, data.categories));
  if (matched.length === 0) return;

  // Needed destinations include those referenced by dynamic SMS recipients for
  // their Quo credentials (only the recipient number is dynamic).
  const neededIds = Array.from(
    new Set([
      ...matched.flatMap((r) => r.destinationIds ?? []),
      ...matched.flatMap((r) =>
        (r.dynamicRecipients ?? []).map((dr) => dr.viaDestinationId).filter(Boolean) as string[],
      ),
    ]),
  );
  const destinations = await getDestinationsByIds(data.userId, neededIds);
  const destById = new Map(destinations.map((d) => [d.id, d]));

  // Process rules in order so each destination gets the message from the FIRST
  // matching rule that targets it; de-dupe per destination across rules.
  const sentSlack = new Set<string>();
  const sentQuo = new Set<string>();

  for (const rule of matched) {
    const message = rule.messageTemplate?.trim() || undefined;
    // Undefined = legacy rule → include files (back-compat). Only an explicit
    // false suppresses file/submission links in this rule's messages.
    const includeFiles = rule.includeFiles !== false;

    // Email (custom message intentionally not applied — email keeps its rich
    // formatted layout). Owner-email opt-in routes to the account address.
    const emailAddrs: string[] = [];
    for (const id of rule.destinationIds ?? []) {
      const dest = destById.get(id);
      if (dest?.type === "email") {
        const addr = (dest.config as { address?: string }).address;
        if (addr) emailAddrs.push(addr);
      }
    }
    if (rule.ownerEmail && data.ownerEmail) emailAddrs.push(data.ownerEmail);
    for (const addr of emailAddrs) {
      if (alreadyEmailed.has(addr)) continue;
      alreadyEmailed.add(addr);
      const result = await senders.email(addr, includeFiles);
      await logDelivery({ userId: data.userId, uploadLinkId: data.uploadLinkId, channel: "email", result, uploadId: ids.uploadId, batchId: ids.batchId });
    }

    // Slack — post via the workspace bot token to the chosen channel, with an
    // optional @mention; custom message becomes the lead text when present.
    for (const id of rule.destinationIds ?? []) {
      const dest = destById.get(id);
      if (!dest || dest.type !== "slack" || sentSlack.has(id)) continue;
      sentSlack.add(id);
      const cfg = dest.config as {
        slack_connection_id?: string;
        channel_id?: string;
        channel_name?: string;
        mention_user_id?: string | null;
      };
      const channelLabel = cfg.channel_name ? `#${cfg.channel_name}` : "slack";
      let result: NotifyResult;
      const token =
        cfg.slack_connection_id && cfg.channel_id
          ? await getSlackBotToken({ userId: data.userId, connectionId: cfg.slack_connection_id })
          : null;
      if (!token || !cfg.channel_id) {
        result = { status: "skipped", target: channelLabel, detail: "Slack not connected — reconnect in Settings" };
      } else {
        result = {
          ...(await senders.slack(
            { token, channelId: cfg.channel_id, mentionUserId: cfg.mention_user_id ?? null },
            message,
            includeFiles,
          )),
          target: channelLabel,
        };
      }
      await logDelivery({ userId: data.userId, uploadLinkId: data.uploadLinkId, channel: "slack", result, uploadId: ids.uploadId, batchId: ids.batchId });
    }

    // A dynamic SMS recipient that reuses a Quo account OVERRIDES that account's
    // fixed number for this rule — so the connection texts the dynamic recipient
    // (e.g. the cleaner) instead of the account's default to-number.
    const quoOverridden = new Set(
      (rule.dynamicRecipients ?? [])
        .filter((dr) => dr.channel === "sms" && dr.viaDestinationId)
        .map((dr) => dr.viaDestinationId as string),
    );

    // Quo SMS — custom message becomes the text body when present.
    for (const id of rule.destinationIds ?? []) {
      const dest = destById.get(id);
      if (!dest || dest.type !== "quo" || sentQuo.has(id)) continue;
      sentQuo.add(id);
      if (quoOverridden.has(id)) continue; // a dynamic recipient replaces this default
      const to = (dest.config as { to?: string }).to ?? "sms";
      const creds = decryptQuoCreds(dest.config);
      const result: NotifyResult = creds
        ? await senders.quo(creds, message, includeFiles)
        : { status: "skipped", target: to, detail: "Quo credentials unavailable — re-add in Settings" };
      await logDelivery({ userId: data.userId, uploadLinkId: data.uploadLinkId, channel: "quo", result, uploadId: ids.uploadId, batchId: ids.batchId });
    }

    // Dynamic recipients — SMS/email to a value pulled from a connected record
    // (e.g. the cleaner's phone, the owner's email). The recipient comes from
    // the submission's connected-record values; for SMS the Quo credentials come
    // from the chosen Quo destination (only the to-number is dynamic).
    for (const dr of rule.dynamicRecipients ?? []) {
      const recipient = (sourceValues[`${dr.source}.${prefillKey(dr.field)}`] ?? "").trim();
      const channel = dr.channel === "sms" ? "quo" : "email";
      if (!recipient) {
        await logDelivery({
          userId: data.userId,
          uploadLinkId: data.uploadLinkId,
          channel,
          result: { status: "skipped", target: `${dr.source}.${dr.field}`, detail: "No recipient value on the connected record" },
          uploadId: ids.uploadId,
          batchId: ids.batchId,
        });
        continue;
      }
      if (dr.channel === "email") {
        if (!EMAIL_RE.test(recipient) || alreadyEmailed.has(recipient)) continue;
        alreadyEmailed.add(recipient);
        const result = { ...(await senders.email(recipient, includeFiles)), target: recipient };
        await logDelivery({ userId: data.userId, uploadLinkId: data.uploadLinkId, channel: "email", result, uploadId: ids.uploadId, batchId: ids.batchId });
      } else {
        const credDest = dr.viaDestinationId ? destById.get(dr.viaDestinationId) : undefined;
        const baseCreds = credDest?.type === "quo" ? decryptQuoCreds(credDest.config) : null;
        const result: NotifyResult = baseCreds
          ? { ...(await senders.quo({ ...baseCreds, to: recipient }, message, includeFiles)), target: recipient }
          : { status: "skipped", target: recipient, detail: "Pick a Quo account for this SMS recipient" };
        await logDelivery({ userId: data.userId, uploadLinkId: data.uploadLinkId, channel: "quo", result, uploadId: ids.uploadId, batchId: ids.batchId });
      }
    }
  }
}

// --- Public entry points -----------------------------------------------------

export async function deliverForUpload(uploadId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("uploads")
    .select("user_id, upload_link_id, custom_data, mime_type")
    .eq("id", uploadId)
    .maybeSingle();
  const upload = data as
    | { user_id: string; upload_link_id: string; custom_data: Record<string, string> | null; mime_type: string | null }
    | null;
  if (!upload) return;

  const linkDispatch = await loadLinkDispatch(upload.upload_link_id);
  if (!linkDispatch) return;

  const ctx: DispatchData = {
    userId: linkDispatch.userId,
    uploadLinkId: upload.upload_link_id,
    ownerEmail: linkDispatch.ownerEmail,
    notifyEmail: linkDispatch.notifyEmail,
    rules: linkDispatch.rules,
    customData: upload.custom_data ?? {},
    categories: [fileCategory(upload.mime_type)],
  };

  const emailed = new Set<string>();

  // Default owner email (self-gates on notify_email + recipient).
  const emailResult = await sendUploadNotification(uploadId);
  if (emailResult.status === "sent" && ctx.ownerEmail) emailed.add(ctx.ownerEmail);
  await logDelivery({ userId: ctx.userId, uploadLinkId: ctx.uploadLinkId, channel: "email", result: emailResult, uploadId });

  // Default webhook. Jobs path: durable + retried; the handler logs the
  // delivery (with job_id). Legacy path: one-shot inline, logged here.
  // enqueue() only throws BEFORE a job row exists (validation/insert), so the
  // legacy fallback in the catch can never double-send.
  if (jobsEnabled()) {
    try {
      await getJobs().enqueue({
        type: "webhook.deliver",
        payload: { v: 1, mode: "single", uploadId },
        idempotencyKey: `webhook.deliver:upload:${uploadId}`,
        userId: ctx.userId,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[dispatch] webhook enqueue failed, falling back to inline:", err);
      const webhookResult = await sendUploadWebhook(uploadId);
      await logDelivery({ userId: ctx.userId, uploadLinkId: ctx.uploadLinkId, channel: "webhook", result: webhookResult, uploadId });
    }
  } else {
    const webhookResult = await sendUploadWebhook(uploadId);
    await logDelivery({ userId: ctx.userId, uploadLinkId: ctx.uploadLinkId, channel: "webhook", result: webhookResult, uploadId });
  }

  // Connected-record values for {{alias.Field}} message tokens + dynamic recipients.
  const sourceValues = await getSubmissionSourceValues(uploadId);

  await dispatchRules(
    ctx,
    emailed,
    {
      email: (addr, includeFiles) => sendUploadEmailTo(addr, uploadId, includeFiles),
      slack: (target, message, includeFiles) => sendSlackForUpload(target, uploadId, message, sourceValues, includeFiles),
      quo: (creds, message, includeFiles) => sendQuoForUpload(creds, uploadId, message, sourceValues, includeFiles),
    },
    { uploadId },
    sourceValues,
  );
}

export async function deliverForBatch(batchId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("uploads")
    .select("id, user_id, upload_link_id, custom_data, mime_type")
    .eq("batch_id", batchId)
    .eq("status", "complete");
  const uploads = (data ?? []) as Array<{
    id: string;
    user_id: string;
    upload_link_id: string;
    custom_data: Record<string, string> | null;
    mime_type: string | null;
  }>;
  if (uploads.length === 0) return;

  const rep = uploads[0];
  const linkDispatch = await loadLinkDispatch(rep.upload_link_id);
  if (!linkDispatch) return;

  const ctx: DispatchData = {
    userId: linkDispatch.userId,
    uploadLinkId: rep.upload_link_id,
    ownerEmail: linkDispatch.ownerEmail,
    notifyEmail: linkDispatch.notifyEmail,
    rules: linkDispatch.rules,
    customData: rep.custom_data ?? {},
    categories: Array.from(new Set(uploads.map((u) => fileCategory(u.mime_type)))),
  };

  const emailed = new Set<string>();

  const emailResult = await sendBatchUploadNotification(batchId);
  if (emailResult.status === "sent" && ctx.ownerEmail) emailed.add(ctx.ownerEmail);
  await logDelivery({ userId: ctx.userId, uploadLinkId: ctx.uploadLinkId, channel: "email", result: emailResult, batchId });

  // Batch webhook — same flag semantics as the single path above.
  if (jobsEnabled()) {
    try {
      await getJobs().enqueue({
        type: "webhook.deliver",
        payload: { v: 1, mode: "batch", batchId },
        idempotencyKey: `webhook.deliver:batch:${batchId}`,
        userId: ctx.userId,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[dispatch] batch webhook enqueue failed, falling back to inline:", err);
      const webhookResult = await sendBatchUploadWebhook(batchId);
      await logDelivery({ userId: ctx.userId, uploadLinkId: ctx.uploadLinkId, channel: "webhook", result: webhookResult, batchId });
    }
  } else {
    const webhookResult = await sendBatchUploadWebhook(batchId);
    await logDelivery({ userId: ctx.userId, uploadLinkId: ctx.uploadLinkId, channel: "webhook", result: webhookResult, batchId });
  }

  // Connected-record values (same across the batch) — from any row's submission.
  const sourceValues = await getSubmissionSourceValues(rep.id);

  await dispatchRules(
    ctx,
    emailed,
    {
      email: (addr, includeFiles) => sendBatchEmailTo(addr, batchId, includeFiles),
      slack: (target, message, includeFiles) => sendSlackForBatch(target, batchId, message, sourceValues, includeFiles),
      quo: (creds, message, includeFiles) => sendQuoForBatch(creds, batchId, message, sourceValues, includeFiles),
    },
    { batchId },
    sourceValues,
  );
}
