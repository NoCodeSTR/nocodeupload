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
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { generateSlug } from "@/lib/slug";
import { formatPgError } from "@/lib/pg-error";
import { getConnectionForUser } from "@/lib/connections";
import type { UploadLinkRow } from "@/lib/db-types";
import type { UploadLinkCreateInput, UploadLinkUpdateInput } from "@/lib/schemas";

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
  // Defense in depth: the chosen connection must belong to this user.
  const connection = await getConnectionForUser({
    userId,
    connectionId: input.storageConnectionId,
  });
  if (!connection) {
    throw new Error("CONNECTION_NOT_FOUND");
  }

  const supabase = createSupabaseServerClient();

  for (let attempt = 0; attempt < 2; attempt++) {
    const slug = generateSlug();
    const row = {
      user_id: userId,
      storage_connection_id: input.storageConnectionId,
      slug,
      name: input.name,
      description: input.description ?? null,
      folder_id: input.folderId,
      folder_name: input.folderName ?? null,
      is_active: input.isActive ?? true,
      expires_at: input.expiresAt ?? null,
      max_file_size_mb: input.maxFileSizeMb ?? 1024,
      allowed_mime_types: input.allowedMimeTypes ?? null,
      require_name: input.requireName ?? false,
      require_email: input.requireEmail ?? false,
      show_message_field: input.showMessageField ?? true,
      branding_logo_url: input.brandingLogoUrl ?? null,
      branding_color: input.brandingColor ?? null,
    };

    const { data, error } = await supabase
      .from("upload_links")
      .insert(row as never)
      .select("*")
      .single();

    if (!error) return data as unknown as UploadLinkRow;

    // 23505 = unique_violation (slug). Retry once with a fresh slug.
    if (error.code === "23505" && attempt === 0) continue;
    throw new Error(formatPgError("Failed to create link", error));
  }

  throw new Error("Failed to create link after slug retry");
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
  if (i.brandingLogoUrl !== undefined) patch.branding_logo_url = i.brandingLogoUrl;
  if (i.brandingColor !== undefined) patch.branding_color = i.brandingColor;

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
