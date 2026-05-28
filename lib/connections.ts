/**
 * Server-side helpers for querying and managing storage_connections rows.
 *
 * Everything in this file uses the SERVICE-ROLE Supabase client — which
 * bypasses RLS — so it can read encrypted token columns. Callers are
 * responsible for passing the authenticated user id and only acting on
 * rows that belong to that user.
 *
 * Public selection of safe metadata fields uses the standard server client
 * so RLS guards against any logic mistakes.
 */
import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { encryptString, decryptString } from "@/lib/crypto/tokens";
import { getAdapter } from "@/lib/providers/registry";
import type {
  StorageConnectionRow,
  StorageProvider,
} from "@/lib/db-types";
import type { OAuthExchangeResult } from "@/lib/providers/types";

/**
 * Safe-for-UI projection of a connection — never includes token ciphertext.
 */
export interface ConnectionSummary {
  id: string;
  provider: StorageProvider;
  provider_email: string | null;
  status: "active" | "revoked" | "error";
  connected_at: string;
  last_refreshed_at: string | null;
  provider_metadata: Record<string, unknown>;
}

const SAFE_COLUMNS =
  "id, provider, provider_email, status, connected_at, last_refreshed_at, provider_metadata";

/**
 * List the current user's active storage connections, ordered most-recent first.
 * Uses the regular server client so RLS guards the query.
 */
export async function listUserConnections(
  userId: string,
): Promise<ConnectionSummary[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("storage_connections")
    .select(SAFE_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "active")
    .order("connected_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list connections: ${error.message}`);
  }
  return (data ?? []) as ConnectionSummary[];
}

/**
 * Count of active connections for a given user (used by the dashboard banner).
 */
export async function countUserActiveConnections(userId: string): Promise<number> {
  const supabase = createSupabaseServerClient();
  const { count, error } = await supabase
    .from("storage_connections")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "active");

  if (error) {
    throw new Error(`Failed to count connections: ${error.message}`);
  }
  return count ?? 0;
}

/**
 * Persist a newly-completed OAuth exchange as a storage_connections row.
 * Uses upsert so re-connecting the same provider account updates the row
 * in place (token refresh) rather than failing on the unique constraint.
 */
export async function upsertConnection(args: {
  userId: string;
  provider: StorageProvider;
  result: OAuthExchangeResult;
}): Promise<{ id: string }> {
  const accessBlob = encryptString(args.result.accessToken);
  const refreshBlob = encryptString(args.result.refreshToken);

  const row = {
    user_id: args.userId,
    provider: args.provider,
    provider_account_id: args.result.providerAccountId,
    provider_email: args.result.providerEmail,
    access_token_ciphertext: accessBlob.ciphertext,
    access_token_iv: accessBlob.iv,
    access_token_auth_tag: accessBlob.authTag,
    refresh_token_ciphertext: refreshBlob.ciphertext,
    refresh_token_iv: refreshBlob.iv,
    refresh_token_auth_tag: refreshBlob.authTag,
    token_expires_at: args.result.expiresAt.toISOString(),
    scopes: args.result.scopes,
    provider_metadata: args.result.providerMetadata,
    status: "active",
    connected_at: new Date().toISOString(),
    last_refreshed_at: null,
  };

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("storage_connections")
    // Supabase typegen isn't wired up yet (M11 will). Cast to silence the
    // overly-broad default generic.
    .upsert(row as never, { onConflict: "user_id,provider,provider_account_id" })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to upsert connection: ${error.message}`);
  }
  return { id: (data as { id: string }).id };
}

/**
 * Load a single connection by id, scoped to the calling user. Returns the
 * full row including (still-encrypted) token columns.
 */
export async function getConnectionForUser(args: {
  userId: string;
  connectionId: string;
}): Promise<StorageConnectionRow | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("storage_connections")
    .select("*")
    .eq("id", args.connectionId)
    .eq("user_id", args.userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load connection: ${error.message}`);
  }
  return (data ?? null) as StorageConnectionRow | null;
}

/**
 * Disconnect a connection: best-effort provider revoke, then delete the row.
 * Returns ok=false with an `errorCode` on FK violation (active upload links
 * pointing at this connection).
 */
export async function disconnectConnection(args: {
  userId: string;
  connectionId: string;
}): Promise<
  | { ok: true }
  | { ok: false; errorCode: "not_found" | "has_links" | "internal"; message: string }
> {
  const connection = await getConnectionForUser(args);
  if (!connection) {
    return { ok: false, errorCode: "not_found", message: "Connection not found." };
  }

  // Best-effort revoke at the provider. If decrypt or revoke fails we still
  // delete the row — a user must always be able to disconnect from our side.
  try {
    const refreshToken = decryptString({
      ciphertext: connection.refresh_token_ciphertext,
      iv: connection.refresh_token_iv,
      authTag: connection.refresh_token_auth_tag,
    });
    const adapter = await getAdapter(connection.provider);
    await adapter.oauth.revoke(refreshToken);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[disconnectConnection] provider revoke failed (continuing to delete row):",
      err,
    );
  }

  const admin = getSupabaseAdmin();
  const { error: deleteErr } = await admin
    .from("storage_connections")
    .delete()
    .eq("id", args.connectionId)
    .eq("user_id", args.userId);

  if (deleteErr) {
    // 23503 = foreign_key_violation — there are upload_links still pointing
    // at this connection (ON DELETE RESTRICT).
    if (deleteErr.code === "23503") {
      return {
        ok: false,
        errorCode: "has_links",
        message:
          "This connection has active upload links. Delete those links first.",
      };
    }
    return { ok: false, errorCode: "internal", message: deleteErr.message };
  }

  return { ok: true };
}
