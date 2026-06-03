/**
 * Token freshness helper — used by every code path that needs to call a
 * storage provider's API on behalf of a user.
 *
 * Flow:
 *   1. Load the connection row (service-role) and verify it belongs to userId.
 *   2. If status !== 'active', refuse — caller should send the user back to
 *      Settings to reconnect.
 *   3. If token_expires_at > now() + 60s, decrypt and return the stored
 *      access token directly.
 *   4. Otherwise: decrypt the refresh token, call adapter.refreshAccessToken,
 *      encrypt the new access token with a fresh IV + auth tag, update the
 *      row (access_token columns + token_expires_at + last_refreshed_at).
 *      Decrypt and return the new token.
 *   5. On refresh failure (revoked, network error): set status='error' on
 *      the connection row and throw a typed `TokenError` so the caller can
 *      surface a clear "reconnect needed" message to the user.
 *
 * Consumers: picker-token route, the upload-initiate route (resumable upload).
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { encryptString, decryptString } from "@/lib/crypto/tokens";
import { getAdapter } from "@/lib/providers/registry";
import type { StorageConnectionRow } from "@/lib/db-types";

/** Safety buffer applied when checking expiry — never hand out a token
 *  that's about to expire mid-API-call. */
const EXPIRY_BUFFER_MS = 60 * 1000;

export type TokenErrorCode =
  | "not_found"
  | "not_active"
  | "refresh_failed";

export class TokenError extends Error {
  code: TokenErrorCode;
  constructor(code: TokenErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "TokenError";
  }
}

export interface ValidAccessToken {
  accessToken: string;
  expiresAt: Date;
  connection: StorageConnectionRow;
}

/**
 * Return a known-good access token for a connection. Refreshes via the
 * provider adapter if the stored token is within EXPIRY_BUFFER_MS of expiry.
 * Persists the refreshed token before returning.
 *
 * Always pass the authenticated user's id from requireUser() — this helper
 * verifies ownership before returning anything.
 */
export async function getValidAccessToken(args: {
  userId: string;
  connectionId: string;
}): Promise<ValidAccessToken> {
  const admin = getSupabaseAdmin();

  // 1. Load the row (service role bypasses RLS so we can read token columns).
  const { data, error } = await admin
    .from("storage_connections")
    .select("*")
    .eq("id", args.connectionId)
    .eq("user_id", args.userId)
    .maybeSingle();

  if (error) {
    throw new TokenError("not_found", `Failed to load connection: ${error.message}`);
  }
  if (!data) {
    throw new TokenError("not_found", "Connection not found.");
  }

  const connection = data as unknown as StorageConnectionRow;

  if (connection.status !== "active") {
    throw new TokenError(
      "not_active",
      `Connection is ${connection.status}. Reconnect from Settings.`,
    );
  }

  // 2. Fast path: stored token is still good.
  const expiresAt = new Date(connection.token_expires_at);
  const now = Date.now();
  if (expiresAt.getTime() > now + EXPIRY_BUFFER_MS) {
    const accessToken = decryptString({
      ciphertext: connection.access_token_ciphertext,
      iv: connection.access_token_iv,
      authTag: connection.access_token_auth_tag,
    });
    return { accessToken, expiresAt, connection };
  }

  // 3. Slow path: refresh via the provider adapter.
  const refreshToken = decryptString({
    ciphertext: connection.refresh_token_ciphertext,
    iv: connection.refresh_token_iv,
    authTag: connection.refresh_token_auth_tag,
  });

  const adapter = await getAdapter(connection.provider);

  let refreshResult;
  try {
    refreshResult = await adapter.oauth.refreshAccessToken(refreshToken);
  } catch (err) {
    // Mark the row 'error' so Settings can show "Reconnect needed".
    await admin
      .from("storage_connections")
      .update({ status: "error" } as never)
      .eq("id", connection.id);

    const message = err instanceof Error ? err.message : "Refresh failed.";
    throw new TokenError("refresh_failed", message);
  }

  // 4. Persist the refreshed access token. Fresh IV + auth tag per encryption.
  const newAccessBlob = encryptString(refreshResult.accessToken);

  const update: Record<string, unknown> = {
    access_token_ciphertext: newAccessBlob.ciphertext,
    access_token_iv: newAccessBlob.iv,
    access_token_auth_tag: newAccessBlob.authTag,
    token_expires_at: refreshResult.expiresAt.toISOString(),
    last_refreshed_at: new Date().toISOString(),
  };

  // Some providers rotate refresh tokens; persist if so.
  if (refreshResult.newRefreshToken) {
    const newRefreshBlob = encryptString(refreshResult.newRefreshToken);
    update.refresh_token_ciphertext = newRefreshBlob.ciphertext;
    update.refresh_token_iv = newRefreshBlob.iv;
    update.refresh_token_auth_tag = newRefreshBlob.authTag;
  }

  const { error: updateErr } = await admin
    .from("storage_connections")
    .update(update as never)
    .eq("id", connection.id);

  if (updateErr) {
    // The token works but we couldn't persist. Still return it — the next
    // call will refresh again, which is wasteful but not broken.
    // eslint-disable-next-line no-console
    console.warn(
      "[getValidAccessToken] Failed to persist refreshed token:",
      updateErr,
    );
  }

  return {
    accessToken: refreshResult.accessToken,
    expiresAt: refreshResult.expiresAt,
    connection: { ...connection, ...(update as Partial<StorageConnectionRow>) },
  };
}
