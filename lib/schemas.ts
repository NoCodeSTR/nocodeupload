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
});
export type CustomFieldInput = z.infer<typeof customFieldSchema>;

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
  customFields: z.array(customFieldSchema).max(3).optional(),
  filenameTemplate: z.string().max(200).optional().nullable(),
  descriptionTemplate: z.string().max(2000).optional().nullable(),
  notifyEmail: z.boolean().default(true),
  bundleNotifications: z.boolean().default(true),
  brandingLogoUrl: z.string().url().optional().nullable(),
  brandingColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  webhookUrl: z.string().url().optional().nullable(),
  successMessage: z.string().max(500).optional().nullable(),
  successRedirectUrl: z.string().url().optional().nullable(),
});

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
  // Visible custom-field values, keyed by field id. Hidden fields are
  // injected server-side and never accepted from the browser.
  customValues: z.record(z.string().max(500)).optional(),
  // Batch grouping: the browser sets a shared id (and the count) when more than
  // one file is uploaded in a single submission.
  batchId: z.string().uuid().optional().nullable(),
  batchSize: z.number().int().positive().max(1000).optional().nullable(),
});

export type UploadInitiateInput = z.infer<typeof uploadInitiateSchema>;

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
