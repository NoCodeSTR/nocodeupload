/**
 * Zod schemas — runtime validation for form inputs, route handler bodies,
 * and database row shapes. Single source of truth used on both client and
 * server.
 */
import { z } from "zod";

export const storageProviderSchema = z.enum([
  "google_drive",
  "youtube",
  "dropbox",
  "box",
  "onedrive",
]);
export type StorageProviderId = z.infer<typeof storageProviderSchema>;

export const customFieldSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1, "Label is required").max(60),
  value: z.string().max(500).default(""),
  visible: z.boolean().default(true),
  required: z.boolean().default(false),
  type: z
    .enum(["text", "checkbox", "select", "multiselect", "currency", "number", "phone", "email"])
    .default("text"),
  // Choices for select / multiselect. Capped to keep the public payload sane.
  options: z.array(z.string().min(1).max(80)).max(20).optional(),
});
export type CustomFieldInput = z.infer<typeof customFieldSchema>;

export const ruleConditionSchema = z.object({
  field: z.string().min(1).max(80),
  op: z.enum(["equals", "contains"]),
  value: z.string().max(200).default(""),
});

export const notificationRuleSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(80).default(""),
  matchMode: z.enum(["all", "any"]).default("all"),
  conditions: z.array(ruleConditionSchema).max(5).default([]),
  destinationIds: z.array(z.string().uuid()).max(20).default([]),
  ownerEmail: z.boolean().default(false),
  messageTemplate: z.string().max(1000).optional().nullable(),
});
export type NotificationRuleInput = z.infer<typeof notificationRuleSchema>;

/**
 * Create a notification destination via the API:
 *  - email: { address }
 *  - quo:   { apiKey, fromNumber, toNumber } (Slack is created via OAuth, not here)
 */
const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, "Use E.164 format, e.g. +15555550123");
export const destinationCreateSchema = z
  .object({
    type: z.enum(["email", "slack", "quo"]),
    label: z.string().min(1, "Label is required").max(80),
    address: z.string().email().optional().nullable(),
    apiKey: z.string().min(10).max(200).optional().nullable(),
    fromNumber: e164.optional().nullable(),
    toNumber: e164.optional().nullable(),
    // Slack channel destination (references a connected workspace).
    slackConnectionId: z.string().uuid().optional().nullable(),
    channelId: z.string().min(1).max(40).optional().nullable(),
    channelName: z.string().min(1).max(120).optional().nullable(),
    mentionUserId: z.string().min(1).max(40).optional().nullable(),
    mentionUserName: z.string().max(120).optional().nullable(),
  })
  .refine((d) => d.type !== "email" || Boolean(d.address), {
    message: "An email address is required for email destinations",
    path: ["address"],
  })
  .refine((d) => d.type !== "quo" || Boolean(d.apiKey && d.fromNumber && d.toNumber), {
    message: "Quo needs an API key, a from-number, and a to-number",
    path: ["apiKey"],
  })
  .refine((d) => d.type !== "slack" || Boolean(d.slackConnectionId && d.channelId && d.channelName), {
    message: "Slack needs a connected workspace and a channel",
    path: ["channelId"],
  });
export type DestinationCreateInput = z.infer<typeof destinationCreateSchema>;

export const uploadLinkCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  description: z.string().max(2000).optional().nullable(),
  storageConnectionId: z.string().uuid(),
  folderId: z.string().min(1, "Folder is required"),
  folderName: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  expiresAt: z.string().datetime().optional().nullable(),
  maxFileSizeMb: z.number().int().positive().max(50 * 1024).default(1024),
  allowedMimeTypes: z.array(z.string()).optional().nullable(),
  requireName: z.boolean().default(false),
  requireEmail: z.boolean().default(false),
  showMessageField: z.boolean().default(true),
  prefillName: z.string().max(120).optional().nullable(),
  prefillEmail: z.string().max(255).optional().nullable(),
  hideName: z.boolean().default(false),
  hideEmail: z.boolean().default(false),
  customFields: z.array(customFieldSchema).max(10).optional(),
  filenameTemplate: z.string().max(200).optional().nullable(),
  descriptionTemplate: z.string().max(2000).optional().nullable(),
  notifyEmail: z.boolean().default(true),
  bundleNotifications: z.boolean().default(true),
  notificationRules: z.array(notificationRuleSchema).max(10).optional(),
  brandingLogoUrl: z.string().url().optional().nullable(),
  brandingColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  webhookUrl: z.string().url().optional().nullable(),
  successMessage: z.string().max(500).optional().nullable(),
  successRedirectUrl: z.string().url().optional().nullable(),
  // Optional upload gate. Owner-chosen; any value (e.g. a 4-digit code).
  uploadPassword: z.string().max(100).optional().nullable(),
  // Optional project assignment.
  projectId: z.string().uuid().optional().nullable(),
  // Reusable cross-cutting labels (tag names; created on save if new).
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
});

export const projectCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(80),
});
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;

export type UploadLinkCreateInput = z.infer<typeof uploadLinkCreateSchema>;

export const uploadLinkUpdateSchema = uploadLinkCreateSchema.partial();
export type UploadLinkUpdateInput = z.infer<typeof uploadLinkUpdateSchema>;

export const uploadInitiateSchema = z.object({
  slug: z.string().min(8).max(64),
  filename: z.string().min(1).max(512),
  size: z.number().int().nonnegative(),
  mimeType: z.string().min(1).max(255),
  uploaderName: z.string().max(120).optional().nullable(),
  // Not .email() here — this is optional metadata. When the link sets
  // require_email, the initiate route enforces a valid format server-side.
  uploaderEmail: z.string().max(255).optional().nullable(),
  uploaderMessage: z.string().max(2000).optional().nullable(),
  // Visible custom-field values, keyed by field id.
  customValues: z.record(z.string().max(500)).optional(),
  // Raw URL-prefill values, keyed by each field's prefill key (slug of its
  // label). Used to populate hidden fields server-side (owner-generated links).
  prefillValues: z.record(z.string().max(500)).optional(),
  // Batch grouping: the browser sets a shared id (and the count) when more than
  // one file is uploaded in a single submission.
  batchId: z.string().uuid().optional().nullable(),
  batchSize: z.number().int().positive().max(1000).optional().nullable(),
  // Password the uploader entered, when the link is password-protected.
  password: z.string().max(100).optional().nullable(),
});

export type UploadInitiateInput = z.infer<typeof uploadInitiateSchema>;

/** Verify a link's password before the upload form (and its fields) are shown. */
export const uploadUnlockSchema = z.object({
  slug: z.string().min(8).max(64),
  password: z.string().max(100),
});
export type UploadUnlockInput = z.infer<typeof uploadUnlockSchema>;

/**
 * Finalize an upload — either success (providerFileId set) or failure
 * (errorMessage set). The browser calls this after the direct-to-provider
 * upload finishes or errors.
 */
export const uploadFinalizeSchema = z
  .object({
    uploadId: z.string().uuid(),
    providerFileId: z.string().min(1).optional(),
    errorMessage: z.string().max(500).optional(),
  })
  .refine((v) => Boolean(v.providerFileId) || Boolean(v.errorMessage), {
    message: "Either providerFileId (success) or errorMessage (failure) is required",
  });

export type UploadFinalizeInput = z.infer<typeof uploadFinalizeSchema>;
