/**
 * Server-side helpers for the upload_links table (the core product object).
 *
 * All owner-facing reads/writes use the cookie-aware authenticated client so
 * RLS scopes everything to auth.uid(). We additionally verify that the chosen
 * storage_connection belongs to the user before create/update — RLS on
 * upload_links only checks user_id, so without this a user could craft a link
 * pointing at a connection id that isn't theirs.
 */
import "server-only";
import { randomBytes } from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { generateSlug } from "@/lib/slug";
import { formatPgError } from "@/lib/pg-error";
import { getConnectionForUser } from "@/lib/connections";
import { setLinkTags, getTagsForLink } from "@/lib/tags";
import type { UploadLinkRow, UploadLinkPublicRow } from "@/lib/db-types";
import type { UploadLinkCreateInput, UploadLinkUpdateInput } from "@/lib/schemas";

/**
 * Read the PUBLIC projection of a link by slug (the upload_links_public view).
 * Safe for anonymous visitors — excludes folder_id / provider / owner. Shared
 * by the public upload page (/u/[slug]) and the embeddable page (/embed/[slug]).
 * Returns null for unknown / inactive / expired links.
 */
export async function getPublicLinkBySlug(
  slug: string,
): Promise<UploadLinkPublicRow | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("upload_links_public")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[getPublicLinkBySlug] query failed:", error.message);
    return null;
  }
  return (data ?? null) as UploadLinkPublicRow | null;
}

export interface UploadLinkWithStats extends UploadLinkRow {
  completed_count: number;
}

/**
 * List the user's upload links (newest first) with their completed-upload count.
 */
export async function listLinksWithStats(
  userId: string,
): Promise<UploadLinkWithStats[]> {
  const supabase = createSupabaseServerClient();

  const { data: links, error } = await supabase
    .from("upload_links")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(formatPgError("Failed to list upload links", error));
  }

  const rows = (links ?? []) as UploadLinkRow[];
  if (rows.length === 0) return [];

  // Completed-upload counts from the stats view (keyed by link + user).
  const { data: stats, error: statsErr } = await supabase
    .from("upload_link_stats")
    .select("upload_link_id, completed_count")
    .eq("user_id", userId);

  if (statsErr) {
    // Non-fatal: show links with a 0 count rather than failing the whole page.
    // eslint-disable-next-line no-console
    console.warn("[listLinksWithStats] stats query failed:", formatPgError("stats", statsErr));
    return rows.map((r) => ({ ...r, completed_count: 0 }));
  }

  const countById = new Map<string, number>();
  for (const s of (stats ?? []) as Array<{ upload_link_id: string; completed_count: number }>) {
    countById.set(s.upload_link_id, Number(s.completed_count) || 0);
  }

  return rows.map((r) => ({ ...r, completed_count: countById.get(r.id) ?? 0 }));
}

/**
 * Load one link by id, scoped to the user (RLS + explicit user_id filter).
 */
export async function getLinkForUser(args: {
  userId: string;
  linkId: string;
}): Promise<UploadLinkRow | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("upload_links")
    .select("*")
    .eq("id", args.linkId)
    .eq("user_id", args.userId)
    .maybeSingle();

  if (error) {
    throw new Error(formatPgError("Failed to load link", error));
  }
  return (data ?? null) as UploadLinkRow | null;
}

/**
 * Load the FULL link row by slug using the service-role client. Used by the
 * anonymous /api/upload/* routes — the public view intentionally hides
 * folder_id / storage_connection_id / user_id, but the server needs them to
 * route the upload. Never return this row shape to the browser.
 */
export async function getLinkBySlugAdmin(slug: string): Promise<UploadLinkRow | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("upload_links")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    throw new Error(formatPgError("Failed to load link by slug", error));
  }
  return (data ?? null) as UploadLinkRow | null;
}

/**
 * Create a new upload link. Generates a secure slug (retries once on the
 * astronomically unlikely unique collision). Verifies connection ownership.
 */
export async function createLink(
  userId: string,
  input: UploadLinkCreateInput,
): Promise<UploadLinkRow> {
  // Form-only links need no storage; multi-box links self-describe per box
  // (validated at upload time via getValidAccessToken's ownership check). For a
  // single drive/youtube link, the chosen connection must belong to this user.
  const destinationType = input.destinationType ?? "drive";
  if (destinationType !== "form" && destinationType !== "multi") {
    if (!input.storageConnectionId) {
      throw new Error("CONNECTION_NOT_FOUND");
    }
    const connection = await getConnectionForUser({
      userId,
      connectionId: input.storageConnectionId,
    });
    if (!connection) {
      throw new Error("CONNECTION_NOT_FOUND");
    }
  }

  const supabase = createSupabaseServerClient();

  for (let attempt = 0; attempt < 2; attempt++) {
    const slug = generateSlug();
    const row = {
      user_id: userId,
      storage_connection_id: input.storageConnectionId ?? null,
      destination_type: destinationType,
      slug,
      name: input.name,
      description: input.description ?? null,
      folder_id: input.folderId ?? null,
      folder_name: input.folderName ?? null,
      is_active: input.isActive ?? true,
      expires_at: input.expiresAt ?? null,
      max_file_size_mb: input.maxFileSizeMb ?? 1024,
      allowed_mime_types: input.allowedMimeTypes ?? null,
      require_name: input.requireName ?? false,
      require_email: input.requireEmail ?? false,
      show_message_field: input.showMessageField ?? true,
      prefill_name: input.prefillName ?? null,
      prefill_email: input.prefillEmail ?? null,
      hide_name: input.hideName ?? false,
      hide_email: input.hideEmail ?? false,
      allow_empty_submission: input.allowEmptySubmission ?? false,
      hide_title: input.hideTitle ?? false,
      subfolder_per_submission: input.subfolderPerSubmission ?? false,
      subfolder_template: input.subfolderTemplate ?? null,
      property_folder_alias: input.propertyFolderAlias ?? null,
      property_folder_id_field: input.propertyFolderIdField ?? null,
      property_folder_template: input.propertyFolderTemplate ?? null,
      multibox_own_folders: input.multiboxOwnFolders ?? false,
      public_files: input.publicFiles ?? false,
      share_page_mode: input.sharePageMode ?? "off",
      custom_fields: input.customFields ?? [],
      filename_template: input.filenameTemplate ?? null,
      description_template: input.descriptionTemplate ?? null,
      notify_email: input.notifyEmail ?? true,
      bundle_notifications: input.bundleNotifications ?? true,
      notification_rules: input.notificationRules ?? [],
      branding_logo_url: input.brandingLogoUrl ?? null,
      branding_color: input.brandingColor ?? null,
      webhook_url: input.webhookUrl ?? null,
      // Always provision a signing secret so it's ready when a webhook is added.
      webhook_secret: randomBytes(24).toString("hex"),
      success_message: input.successMessage ?? null,
      success_redirect_url: input.successRedirectUrl ?? null,
      upload_password: input.uploadPassword?.trim() || null,
      project_id: input.projectId ?? null,
      airtable_config: input.airtableConfig ?? null,
      upload_boxes: input.uploadBoxes ?? null,
      content_blocks: input.contentBlocks ?? null,
      sections: input.sections ?? null,
    };

    const { data, error } = await supabase
      .from("upload_links")
      .insert(row as never)
      .select("*")
      .single();

    if (!error) {
      const created = data as unknown as UploadLinkRow;
      try {
        await setLinkTags(userId, created.id, input.tags ?? []);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[createLink] setLinkTags failed (link saved):", e);
      }
      return created;
    }

    // 23505 = unique_violation (slug). Retry once with a fresh slug.
    if (error.code === "23505" && attempt === 0) continue;
    throw new Error(formatPgError("Failed to create link", error));
  }

  throw new Error("Failed to create link after slug retry");
}

/**
 * Duplicate an existing link into a new one the user can tweak. Copies every
 * configuration field but gives the copy a fresh slug, a fresh webhook signing
 * secret, and a "Copy of …" name. The original is never modified. Returns the
 * new link so the caller can redirect straight to its edit page.
 */
export async function duplicateLink(args: {
  userId: string;
  linkId: string;
}): Promise<UploadLinkRow> {
  const src = await getLinkForUser({ userId: args.userId, linkId: args.linkId });
  if (!src) {
    throw new Error("LINK_NOT_FOUND");
  }

  const supabase = createSupabaseServerClient();

  for (let attempt = 0; attempt < 2; attempt++) {
    const slug = generateSlug();
    const row = {
      user_id: args.userId,
      storage_connection_id: src.storage_connection_id,
      destination_type: src.destination_type,
      slug,
      name: `Copy of ${src.name}`.slice(0, 120),
      description: src.description,
      folder_id: src.folder_id,
      folder_name: src.folder_name,
      is_active: true,
      expires_at: src.expires_at,
      max_file_size_mb: src.max_file_size_mb,
      allowed_mime_types: src.allowed_mime_types,
      require_name: src.require_name,
      require_email: src.require_email,
      show_message_field: src.show_message_field,
      prefill_name: src.prefill_name,
      prefill_email: src.prefill_email,
      hide_name: src.hide_name,
      hide_email: src.hide_email,
      allow_empty_submission: src.allow_empty_submission,
      hide_title: src.hide_title,
      subfolder_per_submission: src.subfolder_per_submission,
      subfolder_template: src.subfolder_template,
      property_folder_alias: src.property_folder_alias,
      property_folder_id_field: src.property_folder_id_field,
      property_folder_template: src.property_folder_template,
      multibox_own_folders: src.multibox_own_folders,
      public_files: src.public_files,
      share_page_mode: src.share_page_mode,
      custom_fields: src.custom_fields,
      filename_template: src.filename_template,
      description_template: src.description_template,
      notify_email: src.notify_email,
      bundle_notifications: src.bundle_notifications,
      notification_rules: src.notification_rules ?? [],
      branding_logo_url: src.branding_logo_url,
      branding_color: src.branding_color,
      webhook_url: src.webhook_url,
      // Fresh secret — never reuse the original's signing key for a new link.
      webhook_secret: randomBytes(24).toString("hex"),
      success_message: src.success_message,
      success_redirect_url: src.success_redirect_url,
      upload_password: src.upload_password,
      project_id: src.project_id,
      airtable_config: src.airtable_config,
      upload_boxes: src.upload_boxes,
      content_blocks: src.content_blocks,
      sections: src.sections,
    };

    const { data, error } = await supabase
      .from("upload_links")
      .insert(row as never)
      .select("*")
      .single();

    if (!error) {
      const created = data as unknown as UploadLinkRow;
      try {
        const srcTags = await getTagsForLink(args.userId, src.id);
        if (srcTags.length) await setLinkTags(args.userId, created.id, srcTags);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[duplicateLink] tag copy failed:", e);
      }
      return created;
    }

    // 23505 = unique_violation (slug). Retry once with a fresh slug.
    if (error.code === "23505" && attempt === 0) continue;
    throw new Error(formatPgError("Failed to duplicate link", error));
  }

  throw new Error("Failed to duplicate link after slug retry");
}

/**
 * Update an existing link. Verifies ownership of the link and (if the
 * connection is being changed) the new connection.
 */
export async function updateLink(args: {
  userId: string;
  linkId: string;
  input: UploadLinkUpdateInput;
}): Promise<UploadLinkRow> {
  const existing = await getLinkForUser({ userId: args.userId, linkId: args.linkId });
  if (!existing) {
    throw new Error("LINK_NOT_FOUND");
  }

  if (
    args.input.storageConnectionId &&
    args.input.storageConnectionId !== existing.storage_connection_id
  ) {
    const connection = await getConnectionForUser({
      userId: args.userId,
      connectionId: args.input.storageConnectionId,
    });
    if (!connection) throw new Error("CONNECTION_NOT_FOUND");
  }

  // Map camelCase input → snake_case columns, only including provided fields.
  const patch: Record<string, unknown> = {};
  const i = args.input;
  if (i.name !== undefined) patch.name = i.name;
  if (i.description !== undefined) patch.description = i.description;
  if (i.destinationType !== undefined) patch.destination_type = i.destinationType;
  if (i.storageConnectionId !== undefined) patch.storage_connection_id = i.storageConnectionId;
  if (i.folderId !== undefined) patch.folder_id = i.folderId;
  if (i.folderName !== undefined) patch.folder_name = i.folderName;
  if (i.isActive !== undefined) patch.is_active = i.isActive;
  if (i.expiresAt !== undefined) patch.expires_at = i.expiresAt;
  if (i.maxFileSizeMb !== undefined) patch.max_file_size_mb = i.maxFileSizeMb;
  if (i.allowedMimeTypes !== undefined) patch.allowed_mime_types = i.allowedMimeTypes;
  if (i.requireName !== undefined) patch.require_name = i.requireName;
  if (i.requireEmail !== undefined) patch.require_email = i.requireEmail;
  if (i.showMessageField !== undefined) patch.show_message_field = i.showMessageField;
  if (i.prefillName !== undefined) patch.prefill_name = i.prefillName;
  if (i.prefillEmail !== undefined) patch.prefill_email = i.prefillEmail;
  if (i.hideName !== undefined) patch.hide_name = i.hideName;
  if (i.hideEmail !== undefined) patch.hide_email = i.hideEmail;
  if (i.allowEmptySubmission !== undefined) patch.allow_empty_submission = i.allowEmptySubmission;
  if (i.hideTitle !== undefined) patch.hide_title = i.hideTitle;
  if (i.subfolderPerSubmission !== undefined) patch.subfolder_per_submission = i.subfolderPerSubmission;
  if (i.subfolderTemplate !== undefined) patch.subfolder_template = i.subfolderTemplate;
  if (i.propertyFolderAlias !== undefined) patch.property_folder_alias = i.propertyFolderAlias;
  if (i.propertyFolderIdField !== undefined) patch.property_folder_id_field = i.propertyFolderIdField;
  if (i.propertyFolderTemplate !== undefined) patch.property_folder_template = i.propertyFolderTemplate;
  if (i.multiboxOwnFolders !== undefined) patch.multibox_own_folders = i.multiboxOwnFolders;
  if (i.publicFiles !== undefined) patch.public_files = i.publicFiles;
  if (i.sharePageMode !== undefined) patch.share_page_mode = i.sharePageMode;
  if (i.customFields !== undefined) patch.custom_fields = i.customFields;
  if (i.filenameTemplate !== undefined) patch.filename_template = i.filenameTemplate;
  if (i.descriptionTemplate !== undefined) patch.description_template = i.descriptionTemplate;
  if (i.notifyEmail !== undefined) patch.notify_email = i.notifyEmail;
  if (i.bundleNotifications !== undefined) patch.bundle_notifications = i.bundleNotifications;
  if (i.notificationRules !== undefined) patch.notification_rules = i.notificationRules;
  if (i.brandingLogoUrl !== undefined) patch.branding_logo_url = i.brandingLogoUrl;
  if (i.brandingColor !== undefined) patch.branding_color = i.brandingColor;
  if (i.webhookUrl !== undefined) {
    patch.webhook_url = i.webhookUrl;
    // Backfill a secret for older links that don't have one yet.
    if (i.webhookUrl && !existing.webhook_secret) {
      patch.webhook_secret = randomBytes(24).toString("hex");
    }
  }
  if (i.successMessage !== undefined) patch.success_message = i.successMessage;
  if (i.successRedirectUrl !== undefined) patch.success_redirect_url = i.successRedirectUrl;
  if (i.uploadPassword !== undefined) patch.upload_password = i.uploadPassword?.trim() || null;
  if (i.projectId !== undefined) patch.project_id = i.projectId;
  if (i.airtableConfig !== undefined) patch.airtable_config = i.airtableConfig;
  if (i.uploadBoxes !== undefined) patch.upload_boxes = i.uploadBoxes;
  if (i.contentBlocks !== undefined) patch.content_blocks = i.contentBlocks;
  if (i.sections !== undefined) patch.sections = i.sections;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("upload_links")
    .update(patch as never)
    .eq("id", args.linkId)
    .eq("user_id", args.userId)
    .select("*")
    .single();

  if (error) {
    throw new Error(formatPgError("Failed to update link", error));
  }
  if (args.input.tags !== undefined) {
    try {
      await setLinkTags(args.userId, args.linkId, args.input.tags);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[updateLink] setLinkTags failed:", e);
    }
  }
  return data as unknown as UploadLinkRow;
}

/**
 * Delete a link. Uploads cascade (FK on uploads → upload_links is ON DELETE
 * CASCADE), so history for a deleted link is removed too.
 */
export async function deleteLink(args: {
  userId: string;
  linkId: string;
}): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("upload_links")
    .delete()
    .eq("id", args.linkId)
    .eq("user_id", args.userId);

  if (error) {
    throw new Error(formatPgError("Failed to delete link", error));
  }
}
