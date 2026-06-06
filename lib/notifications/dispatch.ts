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
import {
  getDestinationsByIds,
  getSlackBotToken,
  decryptQuoCreds,
} from "@/lib/notifications/destinations";
import type { NotifyResult } from "@/lib/notifications/types";
import type { NotificationRule, RuleCondition } from "@/lib/db-types";

interface Senders {
  email: (addr: string) => Promise<NotifyResult>;
  slack: (target: SlackTarget, message?: string) => Promise<NotifyResult>;
  quo: (creds: QuoCreds, message?: string) => Promise<NotifyResult>;
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
  const a = fieldVal.toLowerCase();
  const b = (c.value ?? "").trim().toLowerCase();
  if (!b) return false;
  if (c.op === "equals") {
    // Treat comma-joined values (multiselect, file-type list) as sets.
    const parts = a.split(",").map((s) => s.trim());
    return a === b || parts.includes(b);
  }
  return a.includes(b); // contains
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
): Promise<void> {
  const matched = data.rules.filter((r) => ruleMatches(r, data.customData, data.categories));
  if (matched.length === 0) return;

  const neededIds = Array.from(new Set(matched.flatMap((r) => r.destinationIds ?? [])));
  const destinations = await getDestinationsByIds(data.userId, neededIds);
  const destById = new Map(destinations.map((d) => [d.id, d]));

  // Process rules in order so each destination gets the message from the FIRST
  // matching rule that targets it; de-dupe per destination across rules.
  const sentSlack = new Set<string>();
  const sentQuo = new Set<string>();

  for (const rule of matched) {
    const message = rule.messageTemplate?.trim() || undefined;

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
      const result = await senders.email(addr);
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
          )),
          target: channelLabel,
        };
      }
      await logDelivery({ userId: data.userId, uploadLinkId: data.uploadLinkId, channel: "slack", result, uploadId: ids.uploadId, batchId: ids.batchId });
    }

    // Quo SMS — custom message becomes the text body when present.
    for (const id of rule.destinationIds ?? []) {
      const dest = destById.get(id);
      if (!dest || dest.type !== "quo" || sentQuo.has(id)) continue;
      sentQuo.add(id);
      const to = (dest.config as { to?: string }).to ?? "sms";
      const creds = decryptQuoCreds(dest.config);
      const result: NotifyResult = creds
        ? await senders.quo(creds, message)
        : { status: "skipped", target: to, detail: "Quo credentials unavailable — re-add in Settings" };
      await logDelivery({ userId: data.userId, uploadLinkId: data.uploadLinkId, channel: "quo", result, uploadId: ids.uploadId, batchId: ids.batchId });
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

  // Default webhook.
  const webhookResult = await sendUploadWebhook(uploadId);
  await logDelivery({ userId: ctx.userId, uploadLinkId: ctx.uploadLinkId, channel: "webhook", result: webhookResult, uploadId });

  await dispatchRules(
    ctx,
    emailed,
    {
      email: (addr) => sendUploadEmailTo(addr, uploadId),
      slack: (target, message) => sendSlackForUpload(target, uploadId, message),
      quo: (creds, message) => sendQuoForUpload(creds, uploadId, message),
    },
    { uploadId },
  );
}

export async function deliverForBatch(batchId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("uploads")
    .select("user_id, upload_link_id, custom_data, mime_type")
    .eq("batch_id", batchId)
    .eq("status", "complete");
  const uploads = (data ?? []) as Array<{
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

  const webhookResult = await sendBatchUploadWebhook(batchId);
  await logDelivery({ userId: ctx.userId, uploadLinkId: ctx.uploadLinkId, channel: "webhook", result: webhookResult, batchId });

  await dispatchRules(
    ctx,
    emailed,
    {
      email: (addr) => sendBatchEmailTo(addr, batchId),
      slack: (target, message) => sendSlackForBatch(target, batchId, message),
      quo: (creds, message) => sendQuoForBatch(creds, batchId, message),
    },
    { batchId },
  );
}
