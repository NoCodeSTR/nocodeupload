/**
 * airtable_connections — one encrypted Personal Access Token per user.
 *
 * Owner CRUD uses the cookie-aware client (RLS scopes to auth.uid()); the
 * upload pipeline resolves the token with the service-role client because it
 * runs in the anonymous upload context (mirrors getSlackBotToken).
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { encryptString, decryptString } from "@/lib/crypto/tokens";
import { formatPgError } from "@/lib/pg-error";

/** Safe-for-UI summary — never includes the token. */
export interface AirtableConnectionSummary {
  id: string;
  connectedAt: string;
}

/** Upsert the user's PAT (encrypted). One per user. */
export async function saveAirtableToken(userId: string, token: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  const blob = encryptString(token);
  const row = {
    user_id: userId,
    token_ciphertext: blob.ciphertext,
    token_iv: blob.iv,
    token_auth_tag: blob.authTag,
  };
  const { error } = await supabase
    .from("airtable_connections")
    .upsert(row as never, { onConflict: "user_id" });
  if (error) throw new Error(formatPgError("Failed to save Airtable connection", error));
}

/** Owner-facing: is Airtable connected? Returns a safe summary or null. */
export async function getAirtableConnection(
  userId: string,
): Promise<AirtableConnectionSummary | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("airtable_connections")
    .select("id, created_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(formatPgError("Failed to load Airtable connection", error));
  const row = data as { id: string; created_at: string } | null;
  return row ? { id: row.id, connectedAt: row.created_at } : null;
}

export async function deleteAirtableConnection(userId: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("airtable_connections")
    .delete()
    .eq("user_id", userId);
  if (error) throw new Error(formatPgError("Failed to disconnect Airtable", error));
}

/**
 * Resolve + decrypt the user's PAT for server use. Cookie-aware by default (owner
 * routes like the base/table pickers); pass admin:true for the anonymous upload
 * pipeline (record creation). Returns null if not connected or undecryptable.
 */
export async function getAirtableToken(
  userId: string,
  opts?: { admin?: boolean },
): Promise<string | null> {
  const client = opts?.admin ? getSupabaseAdmin() : createSupabaseServerClient();
  const { data } = await client
    .from("airtable_connections")
    .select("token_ciphertext, token_iv, token_auth_tag")
    .eq("user_id", userId)
    .maybeSingle();
  const row = data as
    | { token_ciphertext: string; token_iv: string; token_auth_tag: string }
    | null;
  if (!row) return null;
  try {
    return decryptString({
      ciphertext: row.token_ciphertext,
      iv: row.token_iv,
      authTag: row.token_auth_tag,
    });
  } catch {
    return null;
  }
}
